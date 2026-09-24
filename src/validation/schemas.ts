import { z } from "zod";
import { isValidStellarAddress } from "../utils/stellar";

/**
 * Zod schema for CCPA/BIPA consent preference mutations (PUT /api/privacy/consent).
 * Enforces Stellar address validity and normalizes opt-out / consent preference booleans.
 */
export const consentPreferenceSchema = z
  .object({
    address: z.string().min(1, "Stellar address is required").refine(isValidStellarAddress, {
      message: "Invalid Stellar address format. Must be a valid 56-character G-address.",
    }),
    analytics_optout: z.boolean().optional(),
    analyticsOptout: z.boolean().optional(),
    marketing_optout: z.boolean().optional(),
    marketingOptout: z.boolean().optional(),
    sale_optout: z.boolean().optional(),
    saleOptout: z.boolean().optional(),
    biometric_consent: z.boolean().optional(),
    biometricConsent: z.boolean().optional(),
  })
  .transform((data) => ({
    address: data.address,
    analytics_optout: data.analytics_optout ?? data.analyticsOptout ?? false,
    marketing_optout: data.marketing_optout ?? data.marketingOptout ?? false,
    sale_optout: data.sale_optout ?? data.saleOptout ?? false,
    biometric_consent: data.biometric_consent ?? data.biometricConsent ?? false,
  }));

export type ConsentPreferenceInput = z.infer<typeof consentPreferenceSchema>;
