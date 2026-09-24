/**
 * Consumes USDC_CONVERSION queue: when MintEvent is received, process USDC → basket allocation.
 * Updates transaction and reserve history; basket weight distribution uses BasketService.
 *
 * Idempotency (Pi-Defi-world/acbu-backend#981): the job processes each
 * conversion exactly once per source transaction. The payload may be
 * redelivered (at-least-once queue semantics) or the same mint effect may be
 * observed twice, so processing is gated by an atomic claim on the matched
 * transaction (pending → processing). Reserve history rows are always linked
 * to the claimed transaction so reserve accounting stays reconcilable.
 */
import type { ConsumeMessage } from "amqplib";
import { connectRabbitMQ, QUEUES, assertQueueWithDLQ } from "../config/rabbitmq";
import { getQueueMaxRetries } from "./queueConfig";
import { logger } from "../config/logger";
import { prisma } from "../config/database";
import { basketService } from "../services/basket";
import { getFintechRouter } from "../services/fintech";
import { Decimal } from "@prisma/client/runtime/library";

const QUEUE = QUEUES.USDC_CONVERSION;
const MAX_RETRIES = getQueueMaxRetries(QUEUE);

export interface UsdcConversionPayload {
  usdcAmount: string;
  recipient: string;
  txHash: string;
  transactionId?: string;
}

/**
 * Atomically claim a pending transaction for conversion.
 * Returns true when this consumer owns the claim; false when the
 * transaction was already claimed or completed by another delivery.
 */
async function claimTransaction(transactionId: string): Promise<boolean> {
  const claim = await prisma.transaction.updateMany({
    where: { id: transactionId, status: "pending" },
    data: { status: "processing" },
  });
  return claim.count === 1;
}

/**
 * Release a claim so a redelivered message can be retried from "pending".
 * The claim is a temporary state and is deliberately not modelled by the
 * transaction state machine (processing → pending is not a normal
 * lifecycle transition).
 */
async function releaseClaim(transactionId: string): Promise<void> {
  await prisma.transaction.updateMany({
    where: { id: transactionId, status: "processing" },
    data: { status: "pending" },
  });
}

export async function startUsdcConversionConsumer(): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.prefetch(1);
  ch.consume(
    QUEUE,
    async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      const headers = msg.properties.headers ?? {};
      const retries = typeof headers["x-retries"] === "number" ? headers["x-retries"] : 0;
      let claimedTransactionId: string | null = null;
      try {
        const body = JSON.parse(msg.content.toString()) as UsdcConversionPayload;
        const { usdcAmount, recipient, txHash, transactionId } = body;
        const usdcNum = Number(usdcAmount);
        if (!(usdcNum > 0)) {
          ch.ack(msg);
          return;
        }

        // Idempotency gate (Pi-Defi-world/acbu-backend#981): without a
        // matched transaction there is no claim to make and no deposit to
        // correlate the conversion to — writing reserve history here would
        // create orphan entries that inflate reserves. Skip the message.
        if (!transactionId) {
          logger.warn(
            "USDC conversion skipped: no matching transaction for txHash — reserve history not written",
            { usdcAmount, recipient, txHash },
          );
          ch.ack(msg);
          return;
        }

        // Atomic claim: pending → processing. A redelivered or concurrent
        // duplicate of the same source txHash loses the claim and is dropped.
        const claimed = await claimTransaction(transactionId);
        if (!claimed) {
          logger.info("USDC conversion skipped: transaction already claimed or completed", {
            txHash,
            transactionId,
          });
          ch.ack(msg);
          return;
        }
        claimedTransactionId = transactionId;

        const basket = await basketService.getCurrentBasket();
        for (const { currency, weight } of basket) {
          const weightFrac = weight / 100;
          const amountLocal = usdcNum * weightFrac;
          try {
            const router = getFintechRouter();
            const provider = await router.getProvider(currency);
            await provider.convertCurrency(usdcNum * weightFrac, "USD", currency);
          } catch (e) {
            logger.warn("USDC conversion: FX skip", { currency, error: e });
          }
          // Reserve history is linked to the claimed transaction so reserve
          // accounting stays reconcilable (Pi-Defi-world/acbu-backend#981).
          await prisma.reserveHistory.create({
            data: {
              currency,
              amountChange: new Decimal(amountLocal),
              reason: "conversion",
              newAmount: null,
              transactionId,
            },
          });
        }

        await prisma.transaction.update({
          where: { id: transactionId },
          data: {
            status: "completed",
            blockchainTxHash: txHash,
            completedAt: new Date(),
          },
        });
        claimedTransactionId = null;

        logger.info("USDC conversion processed", {
          usdcAmount,
          recipient,
          txHash,
          transactionId,
        });
        ch.ack(msg);
      } catch (e) {
        // Release the claim so a redelivered copy of this message can be
        // processed again from the pending state.
        if (claimedTransactionId) {
          await releaseClaim(claimedTransactionId).catch((releaseError) => {
            logger.error("USDC conversion: failed to release transaction claim", {
              transactionId: claimedTransactionId,
              error: e,
            });
          });
          claimedTransactionId = null;
        }
        logger.error("USDC conversion job failed", { error: e });
        if (retries >= MAX_RETRIES) {
          logger.error("USDC conversion job failed permanently, sending to DLQ", { retries });
          ch.nack(msg, false, false);
          return;
        }
        ch.sendToQueue(QUEUE, msg.content, {
          persistent: true,
          headers: { ...headers, "x-retries": retries + 1 },
        });
        ch.ack(msg);
      }
    },
    { noAck: false },
  );
  logger.info("USDC conversion consumer started", { queue: QUEUE });
}

/**
 * Enqueue a USDC conversion job (call from MintEvent handler).
 */
export async function enqueueUsdcConversion(payload: UsdcConversionPayload): Promise<void> {
  const ch = await connectRabbitMQ();
  await assertQueueWithDLQ(QUEUE);
  ch.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), {
    persistent: true,
  });
  logger.info("USDC conversion enqueued", { txHash: payload.txHash });
}
