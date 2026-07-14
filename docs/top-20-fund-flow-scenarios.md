# Top 20 Flow-of-Funds Scenarios — NextGen Insurance Platform

## Stakeholder Fund Flows

### Customer/Policyholder
1. **Premium Payment (Card/Bank)** — Customer pays premium via Paystack/Flutterwave → GL credit → policy activation
2. **Premium Payment (USSD/Mobile Money)** — Low-tech payment via *919# or MTN MoMo → GL credit → policy activation
3. **Wallet Top-up** — Customer funds InsurePortal wallet from bank → wallet balance credit
4. **Wallet Premium Payment** — Customer pays premium from wallet balance → debit wallet → credit GL
5. **Claims Payout** — Approved claim → debit Claims Reserve → credit customer bank account
6. **Premium Refund** — Policy cancellation/overpayment → debit Premium Revenue → credit customer

### Agent
7. **Agent Cash Collection** — Agent collects premium cash from customer → records in system → reconciles
8. **Commission Payout** — Policy sold → calculate commission → debit Commission Expense → credit agent bank
9. **Agent Wallet Settlement** — Agent's collected premiums settled to InsurePortal → net of commission

### Underwriter/Finance
10. **Premium Allocation** — Received premium split: Risk Premium + Commission + Admin Fee + Statutory Levy
11. **Reserve Movement** — Premium → Unearned Premium Reserve → earned over policy period
12. **Investment Income** — Reserve funds invested → interest/dividend → credit Investment Income

### Reinsurance
13. **Cession Premium** — Cede portion of premium to reinsurer → debit Reinsurance Premium → credit Reinsurer
14. **Reinsurance Recovery** — Large claim → recover from reinsurer → debit Reinsurer → credit Claims Reserve
15. **Bordereaux Settlement** — Quarterly bordereau → net premium/claims settled with reinsurer

### Compliance/Regulatory
16. **NAICOM Levy Payment** — 1% of gross premium → debit Statutory Levy → credit NAICOM
17. **Tax Remittance** — VAT/WHT on premiums → debit Tax Payable → credit Tax Authority

### Multi-Currency/Cross-Border
18. **Cross-Border Premium (Multi-Currency)** — Pan-African customer pays in GHS/KES → FX conversion → NGN GL entry
19. **Mojaloop Mobile Money Transfer** — Interoperable payment → Mojaloop hub → settlement

### System Operations
20. **End-of-Day Reconciliation** — Match gateway transactions vs GL entries → flag discrepancies → auto-correct

## Atomicity Requirements

Every scenario MUST have:
- **Idempotency Key** — SHA-256 hash preventing duplicate processing
- **Database Transaction** — All related writes in a single PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK)
- **Double-Entry Ledger** — Every fund movement has equal debit and credit entries
- **Kafka Event** — Every fund movement publishes an event for audit trail and downstream systems
- **Compensation Logic** — If any step fails, all previous steps are rolled back or compensated
- **TigerBeetle Sync** — Financial ledger entries synced to TigerBeetle for immutable audit

## Middleware Integration Matrix

| Middleware | Role in Fund Flows |
|-----------|-------------------|
| **PostgreSQL** | Primary transactional store — BEGIN/COMMIT/ROLLBACK |
| **TigerBeetle** | Immutable double-entry financial ledger — source of truth for balances |
| **Kafka** | Event bus — fund.movement.*, payment.*, claim.payout.* topics |
| **Temporal** | Saga orchestration for multi-step flows (claims payout, reinsurance settlement) |
| **Redis** | Idempotency key store (TTL 24h), rate limiting, distributed locks |
| **Fluvio** | Real-time streaming for fraud detection on payment events |
| **Dapr** | Service-to-service invocation, pub/sub, state store |
| **Mojaloop** | Interoperable payment hub for mobile money transfers |
| **OpenSearch** | Payment/transaction search and analytics |
| **APISIX** | API gateway — rate limiting, auth, request routing |
| **Keycloak** | Authentication — JWT tokens for API access |
| **Permify** | Authorization — fine-grained RBAC for financial operations |
| **OpenAppSec** | WAF — protect payment endpoints from injection/tampering |
| **Lakehouse** | Financial data warehouse — IFRS17, actuarial analytics |
