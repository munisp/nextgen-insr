/**
 * RoleOnboarding — First-time guided onboarding flow for each of the 16 insurance roles.
 * Shows a multi-step modal on first login, stored in localStorage per user.
 */
import { useState, useEffect } from "react";
import { useAuth } from "@/_core/auth";
import {
  Shield, ClipboardList, TrendingUp, Users, Scale, Landmark,
  Activity, Receipt, Heart, BookOpen, Home, CheckCircle, X,
  ChevronRight, ChevronLeft,
} from "lucide-react";

interface OnboardingStep {
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  action?: { label: string; href: string };
}

const ROLE_ONBOARDING: Record<string, { headline: string; steps: OnboardingStep[] }> = {
  underwriter: {
    headline: "Welcome, Underwriter",
    steps: [
      { title: "Review Applications", description: "Your queue shows all pending policy applications awaiting risk assessment. Approve, decline, or refer each one.", icon: ClipboardList, color: "var(--role-underwriter)", action: { label: "Go to Queue", href: "/underwriting-queue" } },
      { title: "Risk Scoring", description: "Use the AI-assisted risk scoring engine to evaluate applicants against your product's underwriting criteria.", icon: Shield, color: "var(--risk-high)" },
      { title: "Product Configuration", description: "Configure coverage limits, exclusions, and pricing rules for each insurance product you manage.", icon: TrendingUp, color: "var(--insurance-primary)", action: { label: "View Products", href: "/insurance-products" } },
    ],
  },
  actuary: {
    headline: "Welcome, Actuary",
    steps: [
      { title: "IFRS 17 Dashboard", description: "Monitor BEL, Risk Adjustment, and CSM balances in real time. Run reserve calculations on demand.", icon: BookOpen, color: "var(--role-actuary)", action: { label: "Open IFRS17", href: "/ifrs17-dashboard" } },
      { title: "Pricing Models", description: "Build and calibrate mortality tables, morbidity rates, and pricing models using the actuarial engine.", icon: TrendingUp, color: "var(--insurance-primary)" },
      { title: "Reserve Calculations", description: "Schedule automated reserve runs or trigger manual calculations. Results feed directly into the Lakehouse.", icon: Activity, color: "var(--risk-low)", action: { label: "Run Reserves", href: "/reserve-calculations" } },
    ],
  },
  "claims-adjuster": {
    headline: "Welcome, Claims Adjuster",
    steps: [
      { title: "FNOL Intake", description: "Log First Notice of Loss events from any channel — web, mobile, USSD, or WhatsApp.", icon: ClipboardList, color: "var(--role-claims-adjuster)", action: { label: "New FNOL", href: "/fnol-submission" } },
      { title: "Claims Queue", description: "Work through your assigned claims. Each claim shows full policy context, coverage limits, and fraud flags.", icon: Shield, color: "var(--insurance-primary)" },
      { title: "Settlement", description: "Approve settlements and trigger payment via TigerBeetle ledger. Payments are processed in real time.", icon: CheckCircle, color: "var(--risk-low)", action: { label: "View Claims", href: "/claims-management" } },
    ],
  },
  broker: {
    headline: "Welcome, Broker",
    steps: [
      { title: "Client Portfolio", description: "Manage your book of business. View all clients, their active policies, and upcoming renewals.", icon: Users, color: "var(--role-broker)", action: { label: "My Clients", href: "/client-portfolio" } },
      { title: "Quote Engine", description: "Generate instant quotes for any insurance product. Submit applications directly from the quote.", icon: TrendingUp, color: "var(--insurance-primary)", action: { label: "New Quote", href: "/quote-engine" } },
      { title: "Commissions", description: "Track earned commissions, view payment schedules, and download statements.", icon: Receipt, color: "var(--risk-low)", action: { label: "Commissions", href: "/commission-management" } },
    ],
  },
  policyholder: {
    headline: "Welcome to Your Insurance Portal",
    steps: [
      { title: "Your Policies", description: "View all your active insurance policies, coverage details, and premium schedules in one place.", icon: Home, color: "var(--role-policyholder)", action: { label: "My Policies", href: "/my-policies" } },
      { title: "File a Claim", description: "Report an incident and track your claim status in real time — from FNOL through to settlement.", icon: ClipboardList, color: "var(--insurance-primary)", action: { label: "File Claim", href: "/my-claims" } },
      { title: "Pay Premium", description: "Pay your premiums via card, bank transfer, or mobile money. Set up auto-pay to never miss a due date.", icon: Receipt, color: "var(--risk-low)", action: { label: "Pay Now", href: "/premium-payment" } },
    ],
  },
  "compliance-officer": {
    headline: "Welcome, Compliance Officer",
    steps: [
      { title: "AML/KYC Alerts", description: "Review flagged transactions and customer profiles. Escalate or clear alerts with full audit trail.", icon: Shield, color: "var(--role-compliance-officer)", action: { label: "AML/KYC", href: "/aml-kyc-management" } },
      { title: "Regulatory Filings", description: "Manage NAICOM, CBN, and NDIC filings. Track submission deadlines and filing status.", icon: BookOpen, color: "var(--insurance-primary)" },
      { title: "Audit Trail", description: "Full immutable audit log of every action on the platform. Export for regulatory review.", icon: ClipboardList, color: "var(--risk-low)", action: { label: "Audit Trail", href: "/audit-trail" } },
    ],
  },
  regulator: {
    headline: "Welcome, Regulator",
    steps: [
      { title: "Market Overview", description: "View aggregated market data across all licensed insurers — GWP, claims ratios, and solvency margins.", icon: Landmark, color: "var(--role-regulator)", action: { label: "Market Reports", href: "/regulatory-reports" } },
      { title: "Solvency Monitoring", description: "Monitor individual insurer solvency ratios against regulatory minimums in real time.", icon: TrendingUp, color: "var(--insurance-primary)" },
      { title: "Read-Only Access", description: "Your role is strictly read-only. All data is as-of the last reporting period with no ability to modify records.", icon: Shield, color: "var(--risk-low)" },
    ],
  },
  reinsurer: {
    headline: "Welcome, Reinsurer",
    steps: [
      { title: "Treaty Management", description: "View and manage your reinsurance treaties — proportional, XL, and facultative arrangements.", icon: Scale, color: "var(--role-reinsurer)", action: { label: "Treaties", href: "/reinsurance-treaties" } },
      { title: "RI Claims", description: "Review inward reinsurance claims and approve recoveries. Payments are processed via the TigerBeetle ledger.", icon: ClipboardList, color: "var(--insurance-primary)" },
      { title: "Premium Accounting", description: "Track ceded premiums, earned premiums, and net retention by treaty and period.", icon: Receipt, color: "var(--risk-low)", action: { label: "Premiums", href: "/reinsurance-premiums" } },
    ],
  },
  "billing-admin": {
    headline: "Welcome, Billing Admin",
    steps: [
      { title: "Platform Ledger", description: "View all platform-level billing entries — revenue, fees, and tenant payouts.", icon: Receipt, color: "var(--role-billing-admin)", action: { label: "Ledger", href: "/billing-ledger" } },
      { title: "Reconciliation", description: "Run daily reconciliation to match platform ledger entries against TigerBeetle and bank statements.", icon: Activity, color: "var(--insurance-primary)", action: { label: "Reconcile", href: "/reconciliation" } },
      { title: "Revenue Analytics", description: "Drill into revenue by product, tenant, channel, and period. Export to the Lakehouse for deeper analysis.", icon: TrendingUp, color: "var(--risk-low)", action: { label: "Revenue", href: "/revenue-analytics" } },
    ],
  },
  supervisor: {
    headline: "Welcome, Supervisor",
    steps: [
      { title: "Agent Oversight", description: "Monitor all agents in your branch — transaction volumes, float balances, and SLA compliance.", icon: Users, color: "var(--role-supervisor)", action: { label: "Agents", href: "/agent-management" } },
      { title: "Float Management", description: "Approve float top-ups, monitor utilization, and set branch-level float limits.", icon: Activity, color: "var(--insurance-primary)", action: { label: "Float", href: "/float-management" } },
      { title: "SLA Monitoring", description: "Track SLA compliance across all service types. Escalate breaches and review root causes.", icon: Shield, color: "var(--risk-low)", action: { label: "SLA", href: "/sla-monitoring" } },
    ],
  },
  beneficiary: {
    headline: "Welcome, Beneficiary",
    steps: [
      { title: "Your Coverage", description: "View the policies on which you are named as a beneficiary, including coverage amounts and conditions.", icon: Heart, color: "var(--role-beneficiary)", action: { label: "My Policies", href: "/my-policies" } },
      { title: "Claim Status", description: "Track the status of any open claims where you are the designated beneficiary.", icon: ClipboardList, color: "var(--insurance-primary)", action: { label: "My Claims", href: "/my-claims" } },
      { title: "Documents", description: "Download policy certificates, claim letters, and payment advices.", icon: BookOpen, color: "var(--risk-low)", action: { label: "Documents", href: "/my-documents" } },
    ],
  },
};

export function RoleOnboarding() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);

  const role = (user as any)?.platformRole ?? "user";
  const config = ROLE_ONBOARDING[role];
  const storageKey = `onboarding-done-${user?.id}-${role}`;

  useEffect(() => {
    if (!user || !config) return;
    const done = localStorage.getItem(storageKey);
    if (!done) setVisible(true);
  }, [user, config, storageKey]);

  const dismiss = () => {
    localStorage.setItem(storageKey, "1");
    setVisible(false);
  };

  if (!visible || !config) return null;

  const currentStep = config.steps[step];
  const StepIcon = currentStep.icon;
  const total = config.steps.length;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
      aria-label={config.headline}
    >
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
      >
        {/* Progress bar */}
        <div className="h-1 w-full" style={{ background: "var(--card-border)" }}>
          <div
            className="h-1 transition-all duration-300"
            style={{
              width: `${((step + 1) / total) * 100}%`,
              background: currentStep.color,
            }}
          />
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
                {config.headline} · Step {step + 1} of {total}
              </p>
              <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                {currentStep.title}
              </h2>
            </div>
            <button
              onClick={dismiss}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: "var(--card-border)", color: "var(--text-secondary)" }}
              aria-label="Skip onboarding"
            >
              <X size={14} />
            </button>
          </div>

          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center mb-4"
            style={{ background: `${currentStep.color}18`, color: currentStep.color }}
          >
            <StepIcon size={24} />
          </div>

          <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--text-secondary)" }}>
            {currentStep.description}
          </p>

          {/* Actions */}
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              className="flex items-center gap-1 text-sm px-3 py-2 rounded-lg disabled:opacity-30"
              style={{ color: "var(--text-secondary)" }}
            >
              <ChevronLeft size={15} />
              Back
            </button>

            <div className="flex items-center gap-2">
              {currentStep.action && (
                <a
                  href={currentStep.action.href}
                  onClick={dismiss}
                  className="text-sm font-medium px-4 py-2 rounded-lg"
                  style={{
                    background: `${currentStep.color}18`,
                    color: currentStep.color,
                    border: `1px solid ${currentStep.color}40`,
                  }}
                >
                  {currentStep.action.label}
                </a>
              )}
              {step < total - 1 ? (
                <button
                  onClick={() => setStep((s) => s + 1)}
                  className="flex items-center gap-1 text-sm font-medium px-4 py-2 rounded-lg text-white"
                  style={{ background: currentStep.color }}
                >
                  Next
                  <ChevronRight size={15} />
                </button>
              ) : (
                <button
                  onClick={dismiss}
                  className="flex items-center gap-1 text-sm font-medium px-4 py-2 rounded-lg text-white"
                  style={{ background: currentStep.color }}
                >
                  <CheckCircle size={15} />
                  Get started
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pb-4">
          {config.steps.map((_, i) => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className="rounded-full transition-all duration-200"
              style={{
                width: i === step ? "20px" : "6px",
                height: "6px",
                background: i === step ? currentStep.color : "var(--card-border)",
              }}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default RoleOnboarding;
