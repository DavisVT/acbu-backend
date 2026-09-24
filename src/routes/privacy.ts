import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../config/database";
import { computeAddressHash } from "../pii/pgcryptoEncryption";
import { consentPreferenceSchema } from "../validation/schemas";
import { AppError } from "../middleware/errorHandler";
import { ErrorCodes } from "../types/errorCodes";
import { isValidStellarAddress } from "../utils/stellar";

const router: ReturnType<typeof Router> = Router();

/**
 * @notice PUT /api/privacy/consent or /api/v1/privacy/consent
 * @dev Records CCPA/BIPA consent preferences (analytics_optout, marketing_optout, sale_optout, biometric_consent)
 *      keyed on the hashed Stellar address. Performs an idempotent last-write-wins update with an updated_at timestamp.
 * @param req Express request object containing address and consent flag booleans
 * @param res Express response object
 * @param next NextFunction error dispatcher
 */
router.put("/consent", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = consentPreferenceSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMessages = parseResult.error.errors.map((e) => e.message).join(", ");
      throw new AppError(`Validation failed: ${errorMessages}`, 400, ErrorCodes.BAD_REQUEST);
    }

    const validated = parseResult.data;
    const addressHash = computeAddressHash(validated.address);

    const consent = await prisma.privacyConsent.upsert({
      where: { addressHash },
      update: {
        analyticsOptout: validated.analytics_optout,
        marketingOptout: validated.marketing_optout,
        saleOptout: validated.sale_optout,
        biometricConsent: validated.biometric_consent,
        updatedAt: new Date(),
      },
      create: {
        addressHash,
        analyticsOptout: validated.analytics_optout,
        marketingOptout: validated.marketing_optout,
        saleOptout: validated.sale_optout,
        biometricConsent: validated.biometric_consent,
      },
    });

    res.status(200).json({
      success: true,
      message: "Consent preferences updated successfully",
      data: {
        address_hash: consent.addressHash,
        analytics_optout: consent.analyticsOptout,
        marketing_optout: consent.marketingOptout,
        sale_optout: consent.saleOptout,
        biometric_consent: consent.biometricConsent,
        updated_at: consent.updatedAt,
        created_at: consent.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @notice GET /api/privacy/consent/:address or /api/v1/privacy/consent/:address
 * @dev Retrieves CCPA/BIPA consent preferences by Stellar address or address hash.
 *      Checks preference state without requiring plaintext address in database query.
 * @param req Express request object containing :address parameter
 * @param res Express response object
 * @param next NextFunction error dispatcher
 */
router.get(
  "/consent/:address",
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { address } = req.params;

      if (!address || typeof address !== "string") {
        throw new AppError("Address parameter is required", 400, ErrorCodes.BAD_REQUEST);
      }

      let addressHash: string;
      if (isValidStellarAddress(address)) {
        addressHash = computeAddressHash(address);
      } else if (/^[a-fA-F0-9]{64}$/.test(address)) {
        addressHash = address.toLowerCase();
      } else {
        throw new AppError(
          "Invalid Stellar address or address hash format. Must be a valid 56-char G-address or 64-char hex hash.",
          400,
          ErrorCodes.BAD_REQUEST,
        );
      }

      const consent = await prisma.privacyConsent.findUnique({
        where: { addressHash },
      });

      if (!consent) {
        throw new AppError(
          "Consent record not found for the specified address",
          404,
          ErrorCodes.NOT_FOUND,
        );
      }

      res.status(200).json({
        success: true,
        data: {
          address_hash: consent.addressHash,
          analytics_optout: consent.analyticsOptout,
          marketing_optout: consent.marketingOptout,
          sale_optout: consent.saleOptout,
          biometric_consent: consent.biometricConsent,
          updated_at: consent.updatedAt,
          created_at: consent.createdAt,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
