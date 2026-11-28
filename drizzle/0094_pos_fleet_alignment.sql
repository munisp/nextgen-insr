-- 0094 (2026-11-28, C3 consolidate/insureportal-merge): POS fleet alignment —
-- additive, nullable columns on pos_terminals required by the ported
-- KEEP-class posTerminalFleet + posFirmwareOTA routers (ip's enhanced fleet
-- schema: soft-delete, SIM identity, app version, command tracking).
-- Root tables are canonical; these columns extend them without altering
-- existing data. Idempotent: safe to re-apply (IF NOT EXISTS).
-- NOTE: an earlier draft of 0094 added ecommerce alignment columns for the
-- ported ecommerce routers; those routers are DECON REMOVE-class
-- (classification.md §A/line 772) and were excluded on 2026-11-28, so the
-- ecommerce columns were dropped before this migration ever landed.

ALTER TABLE "pos_terminals" ADD COLUMN IF NOT EXISTS "imei" varchar(20);
ALTER TABLE "pos_terminals" ADD COLUMN IF NOT EXISTS "simIccid" varchar(22);
ALTER TABLE "pos_terminals" ADD COLUMN IF NOT EXISTS "appVersion" varchar(64);
ALTER TABLE "pos_terminals" ADD COLUMN IF NOT EXISTS "lastSeenAt" timestamp;
ALTER TABLE "pos_terminals" ADD COLUMN IF NOT EXISTS "lastCommand" varchar(256);
ALTER TABLE "pos_terminals" ADD COLUMN IF NOT EXISTS "lastCommandAt" timestamp;
ALTER TABLE "pos_terminals" ADD COLUMN IF NOT EXISTS "deletedAt" timestamp;
CREATE INDEX IF NOT EXISTS "pos_deletedAt_idx" ON "pos_terminals" ("deletedAt");
