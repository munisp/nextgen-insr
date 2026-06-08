# Router Patterns

Standard tRPC router patterns in the InsurePortal POS platform.

## CRUD Router

Standard list/getById/create/update/delete pattern with pagination.

## Transaction Processing

Pipeline-based processing with validation, fraud screening, and ledger entry.

## Protected vs Public

Most routes use `protectedProcedure`. Login, register, and heartbeat use `publicProcedure`.

## Fraud Scoring

Real-time fraud scoring using ML models and rule-based thresholds integrated into the transaction pipeline.
