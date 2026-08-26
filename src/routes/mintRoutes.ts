import { Router, type IRouter } from "express";
import { mintFromUsdc, depositFromBasketCurrency } from "../controllers/mintController";
import { validateApiKey } from "../middleware/auth";
import { apiKeyRateLimiter } from "../middleware/rateLimiter";

export function createMintRoutes(): ReturnType<typeof Router> {
  const router: IRouter = Router();
  router.use(validateApiKey);
  router.use(apiKeyRateLimiter);

  /**
   * @swagger
   * tags:
   *   - name: Mint
   *     description: Asset minting and deposits
   */

  /**
   * @swagger
   * /v1/mint/usdc:
   *   post:
   *     tags:
   *       - Mint
   *     summary: Mint ACBU from USDC
   *     description: Accept USDC deposit, convert to XLM in backend, and mint ACBU.
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - usdc_amount
   *               - wallet_address
   *             properties:
   *               usdc_amount:
   *                 type: string
   *               wallet_address:
   *                 type: string
   *               currency_preference:
   *                 type: string
   *                 enum: [auto]
   *     responses:
   *       202:
   *         description: Mint request accepted
   */
  router.post("/usdc", mintFromUsdc);

  /**
   * @swagger
   * /v1/mint/deposit:
   *   post:
   *     tags:
   *       - Mint
   *     summary: Deposit basket currency to mint ACBU
   *     description: Deposit local currency (NGN, KES, etc.) to mint ACBU.
   *     security:
   *       - ApiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - currency
   *               - amount
   *               - wallet_address
   *             properties:
   *               currency:
   *                 type: string
   *                 minLength: 3
   *                 maxLength: 3
   *               amount:
   *                 type: string
   *               wallet_address:
   *                 type: string
   *               fintech_tx_id:
   *                 type: string
   *                 description: Optional external payment transaction ID used for idempotency and duplicate detection
   *     responses:
   *       202:
   *         description: Deposit request accepted
   */
  router.post("/deposit", depositFromBasketCurrency);
  return router;
}

const router = createMintRoutes();
export default router;
