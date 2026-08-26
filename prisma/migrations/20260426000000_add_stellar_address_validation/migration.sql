-- B-013: Add validation constraint for stellar_address
-- This ensures no invalid or placeholder Stellar addresses can be stored in the database

-- First, validate existing data (this will fail if there are invalid addresses)
-- Valid Stellar addresses:
-- 1. Must be exactly 56 characters
-- 2. Must start with 'G'
-- 3. Must be valid base32 with checksum (we approximate with pattern matching)
-- 4. Must not be a common placeholder pattern

-- Check for any invalid addresses before adding constraint
DO $$
DECLARE
  invalid_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO invalid_count
  FROM users
  WHERE "stellarAddress" IS NOT NULL
    AND (
      -- Invalid format: wrong length or doesn't start with G
      LENGTH("stellarAddress") != 56
      OR "stellarAddress" NOT LIKE 'G%'
      -- Placeholder patterns
      OR "stellarAddress" ~ '^G[A]{55}$'
      OR "stellarAddress" ~ '^G[B]{55}$'
      OR "stellarAddress" ~ '^G[0]{55}$'
      OR "stellarAddress" LIKE 'GTEST%'
      OR "stellarAddress" LIKE 'GDUMMY%'
      OR "stellarAddress" LIKE 'GPLACEHOLDER%'
      OR "stellarAddress" LIKE 'GXXXXXXXX%'
    );

  IF invalid_count > 0 THEN
    RAISE EXCEPTION 'Found % users with invalid stellarAddress format. Please clean up data before applying constraint.', invalid_count;
  END IF;
END $$;

-- Add CHECK constraint to enforce valid Stellar address format
ALTER TABLE users
ADD CONSTRAINT chk_valid_stellar_address
CHECK (
  "stellarAddress" IS NULL
  OR (
    -- Valid format: 56 characters, starts with G, base32 characters only
    LENGTH("stellarAddress") = 56
    AND "stellarAddress" LIKE 'G%'
    AND "stellarAddress" ~ '^[A-Z2-7]{56}$'
    -- Not a placeholder
    AND "stellarAddress" !~ '^G[A]{55}$'
    AND "stellarAddress" !~ '^G[B]{55}$'
    AND "stellarAddress" !~ '^G[0]{55}$'
    AND "stellarAddress" NOT LIKE 'GTEST%'
    AND "stellarAddress" NOT LIKE 'GDUMMY%'
    AND "stellarAddress" NOT LIKE 'GPLACEHOLDER%'
    AND "stellarAddress" NOT LIKE 'GXXXXXXXX%'
  )
);

-- Add index for faster validation queries
CREATE INDEX IF NOT EXISTS idx_users_stellar_address_not_null
ON users ("stellarAddress")
WHERE "stellarAddress" IS NOT NULL;
