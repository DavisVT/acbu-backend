/**
 * Consumes USDC_CONVERSION queue: when MintEvent is received, process USDC → basket allocation.
 * Updates transaction and reserve history; basket weight distribution uses BasketService.
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
      try {
        const body = JSON.parse(msg.content.toString()) as UsdcConversionPayload;
        const { usdcAmount, recipient, txHash, transactionId } = body;
        const usdcNum = Number(usdcAmount);
        if (!(usdcNum > 0)) {
          ch.ack(msg);
          return;
        }

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
          await prisma.reserveHistory.create({
            data: {
              currency,
              amountChange: new Decimal(amountLocal),
              reason: "conversion",
              newAmount: null,
            },
          });
        }

        if (transactionId) {
          await prisma.transaction.update({
            where: { id: transactionId },
            data: {
              status: "completed",
              blockchainTxHash: txHash,
              completedAt: new Date(),
            },
          });
        }

        logger.info("USDC conversion processed", {
          usdcAmount,
          recipient,
          txHash,
        });
        ch.ack(msg);
      } catch (e) {
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
