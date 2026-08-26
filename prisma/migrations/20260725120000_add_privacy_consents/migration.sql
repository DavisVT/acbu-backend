-- CreateTable
CREATE TABLE "privacy_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "address_hash" VARCHAR(64) NOT NULL,
    "analytics_optout" BOOLEAN NOT NULL DEFAULT false,
    "marketing_optout" BOOLEAN NOT NULL DEFAULT false,
    "sale_optout" BOOLEAN NOT NULL DEFAULT false,
    "biometric_consent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "privacy_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "privacy_consents_address_hash_key" ON "privacy_consents"("address_hash");

-- CreateIndex
CREATE INDEX "idx_privacy_consents_address_hash" ON "privacy_consents"("address_hash");
