-- Better Auth 1.7.3+ identifies accounts by (provider_id, account_id) and
-- stops writing issuer. Keep historical issuer values, but make the legacy
-- column nullable. Refuse the migration if old issuer-separated identities
-- would become ambiguous under the supported provider/account key; operator
-- review must assign distinct provider IDs before retrying.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "account"
    GROUP BY "provider_id", "account_id"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Better Auth account key migration blocked: duplicate (provider_id, account_id) rows require explicit provider-ID remediation';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "account_issuer_account_id_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_id_uq" ON "account" USING btree ("provider_id", "account_id");
