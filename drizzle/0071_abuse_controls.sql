-- F5 abuse controls (audit wave F5) — additive only, re-runnable.
-- Platform-DB statements ONLY.
--
-- AB-7: claim_document_hashes — global dedup of claim document hashes so the
-- same document bytes cannot be reused across claims.
--
-- NOTE (restructure, 2026-09-18): the AB-14 coupon tables
-- (coupon_redemptions + promotions."perCustomerLimit") moved to
-- insureportal/drizzle/0044_abuse_controls.sql. They belong to the
-- insureportal schema side; keeping them here aborted this file mid-way on
-- platform-only databases (no promotions table), which could roll back
-- claim_document_hashes when the runner wraps files in a transaction.

CREATE TABLE IF NOT EXISTS claim_document_hashes (
    id SERIAL PRIMARY KEY,
    "claimId" INTEGER NOT NULL,
    "docHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP DEFAULT NOW() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cdh_docHash_unique ON claim_document_hashes("docHash");
CREATE INDEX IF NOT EXISTS cdh_claim_idx ON claim_document_hashes("claimId");
