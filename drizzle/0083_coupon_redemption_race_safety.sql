-- 0083 H-wave (adversarial-verifier follow-up, 2026-09): coupon redemption
-- race-safety on the PLATFORM promotions path. redeemCoupon previously
-- incremented promotions."usedCount" with zero limit checks and a
-- check-then-insert per-customer limit (TOCTOU). This migration adds the
-- redemption ledger used by the transaction + pg_advisory_xact_lock
-- (promoId, customerId) guarded per-customer count and the atomic guarded
-- global increment (UPDATE ... WHERE "usageLimit" IS NULL OR "usedCount" <
-- "usageLimit"). See server/routers/promotions.ts redeemCoupon.
CREATE TABLE IF NOT EXISTS "coupon_redemptions" (
  "id" serial PRIMARY KEY,
  "promoId" integer NOT NULL REFERENCES "promotions"("id"),
  "customerId" integer NOT NULL,
  "orderId" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "coupon_redemptions_promo_customer_idx"
  ON "coupon_redemptions" ("promoId", "customerId");
CREATE INDEX IF NOT EXISTS "coupon_redemptions_promo_idx"
  ON "coupon_redemptions" ("promoId");
