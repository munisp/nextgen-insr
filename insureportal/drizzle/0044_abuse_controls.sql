-- F5 abuse controls (audit wave F5) — additive only, re-runnable.
-- Insureportal-schema statements: these tables belong to the insureportal
-- side (promotions / coupon_redemptions) and are queried via the
-- insureportal DB connection (insureportal/server/db.ts getDb).
--
-- AB-14: coupon_redemptions + promotions."perCustomerLimit" — durable
-- per-customer coupon redemption records and cap; the redeem path increments
-- promotions."usageCount" under an atomic WHERE guard and enforces the
-- per-customer limit against coupon_redemptions.
-- (Moved out of platform migration 0071 on 2026-09-18: the promotions ALTER
-- aborted 0071 mid-file on platform-only databases.)

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
