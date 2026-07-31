/**
 * InsurePortal Insurance Platform — Merchant Portal
 * Full CRUD interface for merchant profile, transactions, settlements, and disputes.
 * Includes a multi-step self-service onboarding wizard for new merchants.
 */
import { useState } from "react";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";

const BG = "oklch(0.10 0.015 260)";
const CARD = "oklch(0.14 0.015 260)";
const BORDER = "oklch(0.22 0.015 260)";
const BLUE = "oklch(0.65 0.22 260)";
const GREEN = "oklch(0.65 0.18 160)";
const GOLD = "oklch(0.75 0.18 80)";
const RED = "oklch(0.60 0.22 25)";
const DISP = "'Inter', sans-serif";
const MONO = "'JetBrains Mono', monospace";

function fmt(v: number | string) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

type Tab = "overview" | "transactions" | "settlements" | "disputes";
type PortalMode = "gate" | "register" | "status" | "portal";
type WizardStep = 1 | 2 | 3 | 4;

const BANKS = [
  { code: "044", name: "Access Bank" },
  { code: "023", name: "Citibank Nigeria" },
  { code: "050", name: "Ecobank Nigeria" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "214", name: "First City Monument Bank" },
  { code: "070", name: "Fidelity Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "030", name: "Heritage Bank" },
  { code: "301", name: "Jaiz Bank" },
  { code: "082", name: "Keystone Bank" },
  { code: "526", name: "Parallex Bank" },
  { code: "076", name: "Polaris Bank" },
  { code: "101", name: "ProvidusBank" },
  { code: "221", name: "Stanbic IBTC Bank" },
  { code: "068", name: "Standard Chartered Bank" },
  { code: "232", name: "Sterling Bank" },
  { code: "100", name: "Suntrust Bank" },
  { code: "032", name: "Union Bank of Nigeria" },
  { code: "033", name: "United Bank for Africa" },
  { code: "215", name: "Unity Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "057", name: "Zenith Bank" },
  { code: "120001", name: "OPay" },
  { code: "120002", name: "PalmPay" },
  { code: "090405", name: "Moniepoint MFB" },
  { code: "090267", name: "Kuda MFB" },
];

const CATEGORIES = [
  { value: "retail", label: "Retail / General Trade" },
  { value: "food_beverage", label: "Food & Beverage" },
  { value: "health", label: "Health & Pharmacy" },
  { value: "education", label: "Education" },
  { value: "transport", label: "Transport & Logistics" },
  { value: "utilities", label: "Utilities & Services" },
  { value: "government", label: "Government / Public Sector" },
  { value: "other", label: "Other" },
];

// ── Gate: choose between login or register ────────────────────────────────────
function PortalGate({
  onLogin,
  onRegister,
}: {
  onLogin: () => void;
  onRegister: () => void;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-8 px-4"
      style={{ background: BG, fontFamily: DISP }}
    >
      <div className="flex flex-col items-center gap-2">
        <div className="text-4xl mb-2">🏪</div>
        <div className="text-2xl font-black text-white">Merchant Portal</div>
        <div className="text-sm text-gray-400 text-center max-w-sm">
          Manage your business transactions, settlements, and disputes on the
          InsurePortal Insurance Network.
        </div>
      </div>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={onLogin}
          className="w-full py-3 rounded-xl text-sm font-bold text-white"
          style={{ background: BLUE }}
        >
          Access My Account
        </button>
        <button
          onClick={onRegister}
          className="w-full py-3 rounded-xl text-sm font-bold"
          style={{
            background: "transparent",
            border: `1px solid ${BORDER}`,
            color: BLUE,
          }}
        >
          Register New Business
        </button>
        <button
          onClick={onLogin}
          className="text-xs text-gray-500 text-center mt-1"
        >
          Check application status →
        </button>
      </div>
      <div className="text-xs text-gray-600 text-center">
        <Link href="/privacy">
          <a className="underline" style={{ color: BLUE }}>
            Privacy Policy
          </a>
        </Link>
        {" · "}
        <Link href="/hub">
          <a className="underline text-gray-500">Back to Hub</a>
        </Link>
      </div>
    </div>
  );
}

// ── Status check: look up by email ───────────────────────────────────────────
function StatusCheck({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [searched, setSearched] = useState(false);
  const statusQ = trpc.merchant.checkRegistrationStatus.useQuery(
    { email },
    { enabled: searched && email.includes("@"), retry: 0 }
  );
  const STATUS_COLORS: Record<string, string> = {
    pending: GOLD,
    active: GREEN,
    suspended: RED,
    closed: RED,
  };
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-6 px-4"
      style={{ background: BG, fontFamily: DISP }}
    >
      <div className="w-full max-w-sm flex flex-col gap-4">
        <button onClick={onBack} className="text-xs text-gray-400 self-start">
          ← Back
        </button>
        <div className="text-xl font-black text-white">
          Check Application Status
        </div>
        <div className="text-xs text-gray-400">
          Enter the email address used during registration.
        </div>
        <input
          className="w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
          type="email"
          placeholder="business@example.com"
          value={email}
          onChange={e => {
            setEmail(e.target.value);
            setSearched(false);
          }}
        />
        <button
          onClick={() => setSearched(true)}
          disabled={!email.includes("@")}
          className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
          style={{ background: BLUE, opacity: email.includes("@") ? 1 : 0.5 }}
        >
          Check Status
        </button>
        {statusQ.isLoading && (
          <div className="text-sm text-gray-400">Searching…</div>
        )}
        {statusQ.data && (
          <div
            className="rounded-xl p-4 flex flex-col gap-2"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            {statusQ.data.found ? (
              <>
                <div className="text-sm font-bold text-white">
                  {statusQ.data.businessName}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-semibold"
                    style={{
                      background: `${STATUS_COLORS[statusQ.data.status] ?? BLUE}20`,
                      color: STATUS_COLORS[statusQ.data.status] ?? BLUE,
                    }}
                  >
                    {statusQ.data.status?.toUpperCase()}
                  </span>
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: MONO }}
                  >
                    {statusQ.data.merchantCode}
                  </span>
                </div>
                {statusQ.data.status === "pending" && (
                  <div className="text-xs text-gray-400 mt-1">
                    Your application is under review. Activation typically takes
                    1–3 business days. You will receive an SMS and email
                    notification once approved.
                  </div>
                )}
                {statusQ.data.status === "active" && (
                  <div className="text-xs" style={{ color: GREEN }}>
                    ✓ Your account is active. Use your Merchant ID to access the
                    portal.
                  </div>
                )}
              </>
            ) : (
              <div className="text-sm text-gray-400">
                No application found for this email address.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Multi-step onboarding wizard ──────────────────────────────────────────────
function OnboardingWizard({
  onBack,
  onSuccess,
}: {
  onBack: () => void;
  onSuccess: (code: string) => void;
}) {
  const [step, setStep] = useState<WizardStep>(1);
  const [form, setForm] = useState({
    businessName: "",
    ownerName: "",
    email: "",
    phone: "",
    address: "",
    category: "retail",
    rcNumber: "",
    tinNumber: "",
    settlementAccountNumber: "",
    settlementBankCode: "058",
    settlementBankName: "Guaranty Trust Bank",
    agreed: false,
  });

  const registerMut = trpc.merchant.register.useMutation({
    onSuccess: res => {
      toast.success(res.message);
      onSuccess(res.merchantCode);
    },
    onError: e => toast.error(e.message),
  });

  const STEPS = [
    { n: 1, label: "Business Info" },
    { n: 2, label: "KYC & Tax" },
    { n: 3, label: "Settlement" },
    { n: 4, label: "Review & Submit" },
  ];

  function Field({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">{label}</label>
        {children}
      </div>
    );
  }

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl text-sm text-white outline-none";
  const inputStyle = {
    background: "oklch(0.10 0.015 260)",
    border: `1px solid ${BORDER}`,
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-6 py-4 border-b"
        style={{ borderColor: BORDER, background: CARD }}
      >
        <button onClick={onBack} className="text-xs text-gray-400">
          ← Back
        </button>
        <div className="text-lg font-black text-white">
          Register Your Business
        </div>
      </div>

      {/* Progress */}
      <div
        className="flex items-center gap-0 px-6 py-4 border-b"
        style={{ borderColor: BORDER }}
      >
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-center gap-0 flex-1">
            <div className="flex flex-col items-center gap-1 flex-1">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: step > s.n ? GREEN : step === s.n ? BLUE : BORDER,
                  color: step >= s.n ? "#fff" : "oklch(0.55 0.015 230)",
                }}
              >
                {step > s.n ? "✓" : s.n}
              </div>
              <div
                className="text-xs hidden sm:block"
                style={{ color: step === s.n ? BLUE : "oklch(0.55 0.015 230)" }}
              >
                {s.label}
              </div>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className="h-0.5 flex-1 mx-1"
                style={{ background: step > s.n ? GREEN : BORDER }}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {/* Step 1: Business Info */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-white">
              Business Information
            </div>
            <Field label="Business / Trading Name *">
              <input
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. Ade Superstore"
                value={form.businessName}
                onChange={e =>
                  setForm(f => ({ ...f, businessName: e.target.value }))
                }
              />
            </Field>
            <Field label="Owner / Director Full Name *">
              <input
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. Adewale Okonkwo"
                value={form.ownerName}
                onChange={e =>
                  setForm(f => ({ ...f, ownerName: e.target.value }))
                }
              />
            </Field>
            <Field label="Business Email Address *">
              <input
                className={inputCls}
                style={inputStyle}
                type="email"
                placeholder="business@example.com"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </Field>
            <Field label="Business Phone Number *">
              <input
                className={inputCls}
                style={inputStyle}
                type="tel"
                placeholder="08012345678"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              />
            </Field>
            <Field label="Business Address *">
              <textarea
                className={`${inputCls} resize-none`}
                style={inputStyle}
                rows={2}
                placeholder="Full address including LGA and State"
                value={form.address}
                onChange={e =>
                  setForm(f => ({ ...f, address: e.target.value }))
                }
              />
            </Field>
            <Field label="Business Category *">
              <select
                className={inputCls}
                style={inputStyle}
                value={form.category}
                onChange={e =>
                  setForm(f => ({ ...f, category: e.target.value }))
                }
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <button
              onClick={() => {
                if (
                  !form.businessName ||
                  !form.ownerName ||
                  !form.email ||
                  !form.phone ||
                  !form.address
                ) {
                  toast.error("Please fill all required fields");
                  return;
                }
                if (!form.email.includes("@")) {
                  toast.error("Invalid email address");
                  return;
                }
                if (form.phone.replace(/\D/g, "").length < 10) {
                  toast.error("Invalid phone number");
                  return;
                }
                setStep(2);
              }}
              className="w-full py-3 rounded-xl text-sm font-bold text-white mt-2"
              style={{ background: BLUE }}
            >
              Continue →
            </button>
          </div>
        )}

        {/* Step 2: KYC & Tax */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-white">
              KYC & Tax Information
            </div>
            <div
              className="text-xs text-gray-400 p-3 rounded-xl"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              These details are required for CBN compliance and FIRS reporting.
              All information is encrypted and stored securely.
            </div>
            <Field label="CAC Registration Number (RC Number)">
              <input
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. RC1234567"
                value={form.rcNumber}
                onChange={e =>
                  setForm(f => ({ ...f, rcNumber: e.target.value }))
                }
              />
              <span className="text-xs text-gray-500">
                Required for incorporated businesses. Leave blank for sole
                traders.
              </span>
            </Field>
            <Field label="Tax Identification Number (TIN)">
              <input
                className={inputCls}
                style={inputStyle}
                placeholder="e.g. 12345678-0001"
                value={form.tinNumber}
                onChange={e =>
                  setForm(f => ({ ...f, tinNumber: e.target.value }))
                }
              />
              <span className="text-xs text-gray-500">
                Obtain from FIRS at{" "}
                <span style={{ color: BLUE }}>firs.gov.ng</span> if you don't
                have one.
              </span>
            </Field>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{
                  background: "transparent",
                  border: `1px solid ${BORDER}`,
                  color: "oklch(0.55 0.015 230)",
                }}
              >
                ← Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
                style={{ background: BLUE }}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Settlement Account */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-white">
              Settlement Bank Account
            </div>
            <div
              className="text-xs text-gray-400 p-3 rounded-xl"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              Daily settlements will be credited to this account. Ensure the
              account name matches your business name for compliance.
            </div>
            <Field label="Bank *">
              <select
                className={inputCls}
                style={inputStyle}
                value={form.settlementBankCode}
                onChange={e => {
                  const bank = BANKS.find(b => b.code === e.target.value);
                  setForm(f => ({
                    ...f,
                    settlementBankCode: e.target.value,
                    settlementBankName: bank?.name ?? "",
                  }));
                }}
              >
                {BANKS.map(b => (
                  <option key={b.code} value={b.code}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Account Number *">
              <input
                className={inputCls}
                style={inputStyle}
                placeholder="10-digit NUBAN account number"
                maxLength={10}
                value={form.settlementAccountNumber}
                onChange={e =>
                  setForm(f => ({
                    ...f,
                    settlementAccountNumber: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </Field>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{
                  background: "transparent",
                  border: `1px solid ${BORDER}`,
                  color: "oklch(0.55 0.015 230)",
                }}
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  if (
                    !form.settlementAccountNumber ||
                    form.settlementAccountNumber.length < 10
                  ) {
                    toast.error("Account number must be 10 digits");
                    return;
                  }
                  setStep(4);
                }}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
                style={{ background: BLUE }}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Review & Submit */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-white">Review & Submit</div>
            <div
              className="rounded-xl p-4 flex flex-col gap-2"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              {[
                { label: "Business Name", value: form.businessName },
                { label: "Owner Name", value: form.ownerName },
                { label: "Email", value: form.email },
                { label: "Phone", value: form.phone },
                { label: "Address", value: form.address },
                {
                  label: "Category",
                  value:
                    CATEGORIES.find(c => c.value === form.category)?.label ??
                    form.category,
                },
                { label: "RC Number", value: form.rcNumber || "Not provided" },
                { label: "TIN", value: form.tinNumber || "Not provided" },
                { label: "Settlement Bank", value: form.settlementBankName },
                {
                  label: "Account Number",
                  value: form.settlementAccountNumber,
                },
              ].map(row => (
                <div
                  key={row.label}
                  className="flex justify-between text-xs gap-4"
                >
                  <span className="text-gray-400 flex-shrink-0">
                    {row.label}
                  </span>
                  <span
                    className="text-white text-right"
                    style={{ fontFamily: MONO }}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
            <div
              className="flex items-start gap-2 p-3 rounded-xl"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <input
                type="checkbox"
                id="agree"
                checked={form.agreed}
                onChange={e =>
                  setForm(f => ({ ...f, agreed: e.target.checked }))
                }
                className="mt-0.5"
              />
              <label htmlFor="agree" className="text-xs text-gray-300">
                I confirm that all information provided is accurate and I agree
                to the{" "}
                <Link href="/privacy">
                  <a style={{ color: BLUE }} className="underline">
                    Privacy Policy
                  </a>
                </Link>{" "}
                and the InsurePortal Merchant Terms of Service.
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep(3)}
                className="flex-1 py-3 rounded-xl text-sm font-semibold"
                style={{
                  background: "transparent",
                  border: `1px solid ${BORDER}`,
                  color: "oklch(0.55 0.015 230)",
                }}
              >
                ← Back
              </button>
              <button
                onClick={() => {
                  if (!form.agreed) {
                    toast.error("Please accept the terms to continue");
                    return;
                  }
                  registerMut.mutate({
                    businessName: form.businessName,
                    ownerName: form.ownerName,
                    email: form.email,
                    phone: form.phone,
                    address: form.address,
                    category: form.category as any,
                    rcNumber: form.rcNumber || undefined,
                    tinNumber: form.tinNumber || undefined,
                    settlementAccountNumber: form.settlementAccountNumber,
                    settlementBankCode: form.settlementBankCode,
                    settlementBankName: form.settlementBankName,
                  });
                }}
                disabled={registerMut.isPending || !form.agreed}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
                style={{
                  background: BLUE,
                  opacity: registerMut.isPending || !form.agreed ? 0.6 : 1,
                }}
              >
                {registerMut.isPending ? "Submitting…" : "Submit Application"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Success screen after registration ────────────────────────────────────────
function RegistrationSuccess({
  merchantCode,
  onBack,
}: {
  merchantCode: string;
  onBack: () => void;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-6 px-4"
      style={{ background: BG, fontFamily: DISP }}
    >
      <div className="text-5xl">🎉</div>
      <div className="text-2xl font-black text-white text-center">
        Application Submitted!
      </div>
      <div className="text-sm text-gray-400 text-center max-w-sm">
        Your merchant application has been received. Your Merchant ID is:
      </div>
      <div
        className="px-6 py-3 rounded-xl text-xl font-black"
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          color: GOLD,
          fontFamily: MONO,
        }}
      >
        {merchantCode}
      </div>
      <div className="text-xs text-gray-500 text-center max-w-sm">
        Save this ID. Our compliance team will review your application within
        1–3 business days. You will receive an SMS and email notification once
        your account is activated.
      </div>
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <button
          onClick={onBack}
          className="w-full py-3 rounded-xl text-sm font-bold text-white"
          style={{ background: BLUE }}
        >
          Check Application Status
        </button>
        <Link href="/hub">
          <button
            className="w-full py-3 rounded-xl text-sm font-semibold"
            style={{
              background: "transparent",
              border: `1px solid ${BORDER}`,
              color: "oklch(0.55 0.015 230)",
            }}
          >
            Back to Hub
          </button>
        </Link>
      </div>
    </div>
  );
}

// ── Main portal (authenticated merchant) ─────────────────────────────────────
export default function MerchantPortal() {
  const [mode, setMode] = useState<PortalMode>("gate");
  const [successCode, setSuccessCode] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [disputeForm, setDisputeForm] = useState({
    transactionRef: "",
    reason: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const profileQ = trpc.merchant.getProfile.useQuery(undefined, {
    retry: 0,
    enabled: mode === "portal",
  });
  const dashQ = trpc.merchant.getDashboard.useQuery(undefined, {
    retry: 0,
    enabled: mode === "portal",
  });
  const txQ = trpc.merchant.getTransactions.useQuery(
    { limit: 20 },
    { retry: 0, enabled: mode === "portal" && tab === "transactions" }
  );
  const settleQ = trpc.merchant.getSettlements.useQuery(
    { limit: 10 },
    { retry: 0, enabled: mode === "portal" && tab === "settlements" }
  );

  const raiseMut = trpc.merchant.raiseDispute.useMutation({
    onSuccess: () => {
      toast.success("Dispute submitted successfully");
      setDisputeForm({ transactionRef: "", reason: "" });
    },
    onError: e => toast.error(e.message),
  });

  // ── Gate ──────────────────────────────────────────────────────────────────
  if (mode === "gate") {
    return (
      <PortalGate
        onLogin={() => setMode("status")}
        onRegister={() => setMode("register")}
      />
    );
  }

  // ── Registration wizard ───────────────────────────────────────────────────
  if (mode === "register") {
    return (
      <OnboardingWizard
        onBack={() => setMode("gate")}
        onSuccess={code => {
          setSuccessCode(code);
          setMode("status");
        }}
      />
    );
  }

  // ── Status check / success ────────────────────────────────────────────────
  if (mode === "status") {
    if (successCode) {
      return (
        <RegistrationSuccess
          merchantCode={successCode}
          onBack={() => {
            setSuccessCode("");
            setMode("status");
          }}
        />
      );
    }
    return <StatusCheck onBack={() => setMode("gate")} />;
  }

  // ── Full portal (authenticated) ───────────────────────────────────────────
  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "🏪" },
    { id: "transactions", label: "Transactions", icon: "💳" },
    { id: "settlements", label: "Settlements", icon: "🏦" },
    { id: "disputes", label: "Disputes", icon: "⚖" },
  ];
  const profile = profileQ.data;
  const dash = dashQ.data;

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: BORDER, background: CARD }}
      >
        <div className="flex items-center gap-3">
          <Link href="/hub">
            <button
              className="text-xs px-3 py-1.5 rounded-lg border"
              style={{ borderColor: BORDER, color: BLUE }}
            >
              ← Hub
            </button>
          </Link>
          <div className="text-lg font-black text-white">Merchant Portal</div>
          {profile && (
            <span
              className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{
                background: "oklch(0.65 0.18 160 / 0.15)",
                color: GREEN,
              }}
            >
              {profile.category}
            </span>
          )}
        </div>
        <button
          onClick={() => setMode("gate")}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Sign Out
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
            style={{
              background:
                tab === t.id ? "oklch(0.60 0.22 260 / 0.2)" : "transparent",
              color: tab === t.id ? BLUE : "oklch(0.55 0.015 230)",
              border: `1px solid ${tab === t.id ? BLUE : "transparent"}`,
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-y-auto">
        {/* Overview */}
        {tab === "overview" && (
          <div className="flex flex-col gap-6">
            {profileQ.isLoading && (
              <div className="text-gray-400 text-sm">Loading profile…</div>
            )}
            {profile && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    label: "Business Name",
                    value: profile.businessName,
                    color: BLUE,
                  },
                  { label: "MID", value: profile.merchantCode, color: GOLD },
                  { label: "Category", value: profile.category, color: GREEN },
                  {
                    label: "Status",
                    value: profile.status,
                    color: profile.status === "active" ? GREEN : RED,
                  },
                ].map(kpi => (
                  <div
                    key={kpi.label}
                    className="rounded-xl p-4"
                    style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  >
                    <div className="text-xs text-gray-400 mb-1">
                      {kpi.label}
                    </div>
                    <div
                      className="text-sm font-bold"
                      style={{ color: kpi.color, fontFamily: MONO }}
                    >
                      {kpi.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {dash && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {[
                  {
                    label: "Total Volume",
                    value: fmt(dash.totalVolume),
                    color: GOLD,
                  },
                  {
                    label: "Total Transactions",
                    value: String(dash.totalTransactions),
                    color: BLUE,
                  },
                  {
                    label: "Pending Settlements",
                    value: fmt(dash.pendingSettlements),
                    color: GREEN,
                  },
                ].map(kpi => (
                  <div
                    key={kpi.label}
                    className="rounded-xl p-4"
                    style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  >
                    <div className="text-xs text-gray-400 mb-1">
                      {kpi.label}
                    </div>
                    <div
                      className="text-lg font-black"
                      style={{ color: kpi.color, fontFamily: MONO }}
                    >
                      {kpi.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {profileQ.error && (
              <div
                className="text-sm p-4 rounded-xl"
                style={{
                  background: "oklch(0.60 0.22 25 / 0.1)",
                  color: RED,
                  border: `1px solid ${RED}`,
                }}
              >
                {profileQ.error.message}
              </div>
            )}
          </div>
        )}

        {/* Transactions */}
        {tab === "transactions" && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-gray-300">
              Recent Transactions
            </div>
            {txQ.isLoading && (
              <div className="text-gray-400 text-sm">Loading…</div>
            )}
            <div
              className="overflow-x-auto rounded-xl"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr
                    style={{
                      background: CARD,
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    {[
                      "Ref",
                      "Type",
                      "Amount",
                      "Customer",
                      "Status",
                      "Time",
                    ].map(h => (
                      <th
                        key={h}
                        className="px-3 py-3 text-left font-semibold text-gray-400 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(txQ.data?.transactions ?? []).map((tx: any, i: number) => (
                    <tr
                      key={tx.id}
                      style={{
                        background: i % 2 === 0 ? BG : CARD,
                        borderBottom: `1px solid ${BORDER}`,
                      }}
                    >
                      <td
                        className="px-3 py-2 text-gray-400"
                        style={{ fontFamily: MONO }}
                      >
                        {tx.ref}
                      </td>
                      <td className="px-3 py-2 font-semibold text-white">
                        {tx.type}
                      </td>
                      <td
                        className="px-3 py-2 font-bold"
                        style={{ color: GOLD, fontFamily: MONO }}
                      >
                        {fmt(tx.amount)}
                      </td>
                      <td className="px-3 py-2 text-gray-400">
                        {tx.customerPhone ?? "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{
                            background:
                              tx.status === "success"
                                ? "oklch(0.65 0.18 160 / 0.15)"
                                : "oklch(0.60 0.22 25 / 0.15)",
                            color: tx.status === "success" ? GREEN : RED,
                          }}
                        >
                          {tx.status}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 text-gray-500"
                        style={{ fontFamily: MONO }}
                      >
                        {new Date(tx.createdAt).toLocaleString("en-NG")}
                      </td>
                    </tr>
                  ))}
                  {(txQ.data?.transactions ?? []).length === 0 &&
                    !txQ.isLoading && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-6 text-center text-gray-500"
                        >
                          No transactions found
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Settlements */}
        {tab === "settlements" && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-gray-300">
              Settlement History
            </div>
            {settleQ.isLoading && (
              <div className="text-gray-400 text-sm">Loading…</div>
            )}
            <div
              className="overflow-x-auto rounded-xl"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr
                    style={{
                      background: CARD,
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    {[
                      "Period",
                      "Gross",
                      "Fee",
                      "Net",
                      "Status",
                      "Settled At",
                    ].map(h => (
                      <th
                        key={h}
                        className="px-3 py-3 text-left font-semibold text-gray-400 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(settleQ.data?.settlements ?? []).map(
                    (s: any, i: number) => (
                      <tr
                        key={s.id}
                        style={{
                          background: i % 2 === 0 ? BG : CARD,
                          borderBottom: `1px solid ${BORDER}`,
                        }}
                      >
                        <td
                          className="px-3 py-2 text-gray-400"
                          style={{ fontFamily: MONO }}
                        >
                          {s.period}
                        </td>
                        <td
                          className="px-3 py-2 font-bold"
                          style={{ color: GOLD, fontFamily: MONO }}
                        >
                          {fmt(s.grossAmount)}
                        </td>
                        <td
                          className="px-3 py-2 text-gray-400"
                          style={{ fontFamily: MONO }}
                        >
                          {fmt(s.feeAmount)}
                        </td>
                        <td
                          className="px-3 py-2 font-bold"
                          style={{ color: GREEN, fontFamily: MONO }}
                        >
                          {fmt(s.netAmount)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className="px-2 py-0.5 rounded-full text-xs font-semibold"
                            style={{
                              background:
                                s.status === "settled"
                                  ? "oklch(0.65 0.18 160 / 0.15)"
                                  : "oklch(0.75 0.18 80 / 0.15)",
                              color: s.status === "settled" ? GREEN : GOLD,
                            }}
                          >
                            {s.status}
                          </span>
                        </td>
                        <td
                          className="px-3 py-2 text-gray-500"
                          style={{ fontFamily: MONO }}
                        >
                          {s.settledAt
                            ? new Date(s.settledAt).toLocaleString("en-NG")
                            : "—"}
                        </td>
                      </tr>
                    )
                  )}
                  {(settleQ.data?.settlements ?? []).length === 0 &&
                    !settleQ.isLoading && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-6 text-center text-gray-500"
                        >
                          No settlements found
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Disputes */}
        {tab === "disputes" && (
          <div className="flex flex-col gap-6">
            <div
              className="rounded-xl p-5"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="text-sm font-bold text-white mb-4">
                Raise a Dispute
              </div>
              <div className="flex flex-col gap-3">
                <input
                  className="px-3 py-2 rounded-lg text-sm text-white outline-none"
                  style={{ background: BG, border: `1px solid ${BORDER}` }}
                  placeholder="Transaction Reference (e.g. TXN20260401ABCD)"
                  value={disputeForm.transactionRef}
                  onChange={e =>
                    setDisputeForm(f => ({
                      ...f,
                      transactionRef: e.target.value,
                    }))
                  }
                />
                <textarea
                  className="px-3 py-2 rounded-lg text-sm text-white outline-none resize-none"
                  style={{ background: BG, border: `1px solid ${BORDER}` }}
                  rows={3}
                  placeholder="Describe the issue in detail (minimum 10 characters)…"
                  value={disputeForm.reason}
                  onChange={e =>
                    setDisputeForm(f => ({ ...f, reason: e.target.value }))
                  }
                />
                <button
                  onClick={async () => {
                    if (!disputeForm.transactionRef || !disputeForm.reason) {
                      toast.error("All fields required");
                      return;
                    }
                    if (disputeForm.reason.length < 10) {
                      toast.error("Reason must be at least 10 characters");
                      return;
                    }
                    setSubmitting(true);
                    try {
                      await raiseMut.mutateAsync({
                        transactionRef: disputeForm.transactionRef,
                        reason: disputeForm.reason,
                      });
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  disabled={submitting}
                  className="self-start px-5 py-2 rounded-lg text-sm font-bold text-white transition-all"
                  style={{ background: submitting ? BORDER : BLUE }}
                >
                  {submitting ? "Submitting…" : "Submit Dispute"}
                </button>
              </div>
            </div>
            <div
              className="text-sm text-gray-500 p-4 rounded-xl"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="font-semibold text-gray-300 mb-1">
                Dispute Resolution Timeline
              </div>
              <div>
                Our team reviews all disputes within 3 business days. You will
                receive an SMS and email notification when your dispute status
                changes.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-center gap-4 px-6 py-3 border-t text-xs text-gray-600"
        style={{ borderColor: BORDER }}
      >
        <Link href="/privacy">
          <a
            className="hover:text-gray-400 transition-colors"
            style={{ color: BLUE }}
          >
            Privacy Policy
          </a>
        </Link>
        <span>·</span>
        <span>© 2026 InsurePortal Insurance</span>
      </div>
    </div>
  );
}
