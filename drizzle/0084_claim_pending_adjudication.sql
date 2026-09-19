-- M-wave (W1, 2026-09-19): staff adjudication queue state for the claims
-- lifecycle. Temporal journeys route non-auto-adjudicable claims (above the
-- ₦200,000 auto tier or customer-initiated) to this status; the hardened
-- staff router path (insuranceWorkflows.adjudicateClaim) owns them from here.
-- Enum value addition is append-only and backwards compatible.
ALTER TYPE "claim_status" ADD VALUE IF NOT EXISTS 'pending_adjudication';
