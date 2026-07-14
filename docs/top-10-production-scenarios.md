# Top 10 Production Scenarios & Workflows — NextGen Insurance Platform

## Stakeholders
1. **Policyholder** — Individual customer purchasing/managing insurance
2. **Insurance Agent** — Field agent selling policies and managing clients
3. **Underwriter** — Evaluates applications and sets premium pricing
4. **Claims Adjuster** — Reviews, investigates, and processes claims
5. **Finance Officer** — Manages premium collections, payouts, and reconciliation
6. **Compliance Officer** — Ensures NAICOM regulatory compliance
7. **Reinsurance Manager** — Manages treaty relationships and cessions
8. **Actuarial Analyst** — Calculates reserves and models risk
9. **System Administrator** — Manages users, roles, and system health
10. **Product Manager** — Creates and manages insurance products

---

## Scenario 1: Policyholder — End-to-End Policy Purchase
**Stakeholder:** Policyholder
**Flow:** Login → KYC Verification → Browse Products → Get Quote → Underwriting → Pay Premium → Policy Issued
**Routes:** auth.login → kyc.status → kyc.submit → products.list → premium.calculate → underwriting.evaluate → payments.process → policies.list
**Scale:** 10,000+ concurrent policy purchases/day

## Scenario 2: Policyholder — File and Track a Claim
**Stakeholder:** Policyholder + Claims Adjuster
**Flow:** Login → Select Policy → File Claim → Upload Evidence → Track Status → Receive Payout
**Routes:** auth.login → policies.list → claims.create → claimsEvidence.upload → claims.tracker → claims.timeline
**Scale:** 5,000+ claims/day across all policy types

## Scenario 3: Claims Adjuster — Adjudicate and Pay Claims
**Stakeholder:** Claims Adjuster + Finance Officer
**Flow:** View Queue → Prioritize → Run Adjudication Rules → Approve/Decline → Process Payout → GL Entry
**Routes:** claims.queue → claims.adjudicate → claims.approve → claims.payout → financial.transactions
**Scale:** 500+ adjudications/day per adjuster

## Scenario 4: Insurance Agent — Sell Policy and Earn Commission
**Stakeholder:** Insurance Agent
**Flow:** Login → View Dashboard → Browse Client List → Quote Product → Submit Application → Track Commission
**Routes:** auth.login → agent.dashboard → agent.clients → products.list → premium.calculate → application.create → agents.commissions
**Scale:** 5,000+ agents, 100+ policies/day per agent

## Scenario 5: Underwriter — Evaluate Application with Risk Scoring
**Stakeholder:** Underwriter
**Flow:** View Application Queue → Run Underwriting Rules → Score Risk → Apply Loading/Discount → Decision
**Routes:** application.list → underwriting.evaluate → underwriting.rules → underwriting.decisions → underwriting.stats
**Scale:** 3,000+ evaluations/day

## Scenario 6: Finance Officer — Premium Collection and Reconciliation
**Stakeholder:** Finance Officer
**Flow:** View Collections → Process Payment → Verify Gateway → Reconcile → Generate Trial Balance → P&L Report
**Routes:** financial.collections → payments.process → payments.verify → reconciliation.run → financial.trialBalance → financial.pnl
**Scale:** ₦10B+ premium volume/month

## Scenario 7: Compliance Officer — NAICOM Regulatory Filing
**Stakeholder:** Compliance Officer
**Flow:** View Dashboard → Check Requirements → Run Compliance Scan → Submit Return → View Penalties
**Routes:** naicom.dashboard → naicom.requirements → compliance.run → naicom.submit → naicom.returns → naicom.penalties
**Scale:** Quarterly filings + real-time compliance monitoring

## Scenario 8: Reinsurance Manager — Treaty Management and Cessions
**Stakeholder:** Reinsurance Manager
**Flow:** View Treaties → Create/Update Treaty → Process Cessions → Track Claims → Generate Bordereaux → Settlements
**Routes:** reinsurance.treaties → reinsurance.create → reinsurance.cessions → reinsurance.claims → reinsurance.bordereaux → reinsurance.settlements
**Scale:** 50+ treaty relationships, 1000+ cessions/month

## Scenario 9: System Admin — User Management and System Monitoring
**Stakeholder:** System Administrator
**Flow:** View System Health → Check DB Metrics → Manage Roles → Assign Permissions → View Audit Trail → DR Status
**Routes:** system.health → dbScaling.metrics → rbac.roles → rbac.assignRole → audit.trail → dr.status → performance.metrics
**Scale:** 100+ admin users, 24/7 monitoring

## Scenario 10: Multi-Channel Distribution — USSD + WhatsApp + Agent Portal
**Stakeholder:** Low-tech Policyholder + Agent
**Flow:** USSD Session → Select Product → Microinsurance Enroll → WhatsApp Notification → Agent Follow-up
**Routes:** ussd.simulate → microinsurance.products → microinsurance.enroll → whatsapp.send → agent.clients → notification.list
**Scale:** 50,000+ USSD sessions/day, 100,000+ WhatsApp messages/day
