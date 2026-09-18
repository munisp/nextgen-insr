-- F5 abuse controls (audit wave F5) — additive only, re-runnable.
--
-- AB-7: claim_document_hashes — global dedup of claim document hashes so the
-- same document bytes cannot be reused across claims.
--
-- AB-14: coupon_redemptions + promotions."perCustomerLimit" — durable
-- per-customer coupon redemption records and cap; redeem path increments
-- promotions."usageCount" under an atomic WHERE guard.

CREATE TABLE IF NOT EXISTS claim_document_hashes (
    id SERIAL PRIMARY KEY,
    "claimId" INTEGER NOT NULL,
    "docHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cdh_docHash_unique ON claim_document_hashes("docHash");
CREATE INDEX IF NOT EXISTS cdh_claim_idx ON claim_document_hashes("claimId");

ALTER TABLE promotions ADD COLUMN IF NOT EXISTS "perCustomerLimit" INTEGER DEFAULT 1;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id SERIAL PRIMARY KEY,
    "promoId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS cr_promo_customer_idx ON coupon_redemptions("promoId", "customerId");
CREATE INDEX IF NOT EXISTS cr_promo_idx ON coupon_redemptions("promoId");
