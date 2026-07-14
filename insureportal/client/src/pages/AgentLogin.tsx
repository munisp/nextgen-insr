import { useState } from "react";
import { trpc } from "../lib/trpc";
import { usePosStore } from "../store/posStore";
import { toast } from "sonner";

const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";
const BG = "oklch(0.09 0.012 240)";
const CARD = "oklch(0.14 0.012 240)";
const BORDER = "oklch(0.22 0.015 240)";
const BLUE = "#3b82f6";
const GOLD = "#f59e0b";
const GREEN = "#10b981";
const RED = "#ef4444";

type Screen = "code" | "pin" | "forgot_phone" | "forgot_newpin";

export default function AgentLogin() {
  const [agentId, setAgentCode] = useState("");
  const [pin, setPin] = useState("");
  const [step, setStep] = useState<Screen>("code");
  const [loading, setLoading] = useState(false);

  // Forgot PIN state
  const [resetPhone, setResetPhone] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPin, setResetNewPin] = useState("");
  const [resetNewPinConfirm, setResetNewPinConfirm] = useState("");
  const [resetAgentCode, setResetAgentCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  const setAgent = usePosStore(s => s.setAgent);

  // ── Login ──────────────────────────────────────────────────────────────────
  const loginMutation = trpc.agent.login.useMutation({
    onSuccess: data => {
      setAgent(data.agent as Parameters<typeof setAgent>[0]);
      toast.success(`Welcome back, ${data.agent.name}!`);
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
      setPin("");
      setLoading(false);
    },
  });

  const handleCodeSubmit = () => {
    if (agentId.trim().length < 3) {
      toast.error("Enter a valid agent ID");
      return;
    }
    setStep("pin");
  };

  const handlePinKey = (key: string) => {
    if (key === "DEL") {
      setPin(p => p.slice(0, -1));
      return;
    }
    if (pin.length >= 6) return;
    const newPin = pin + key;
    setPin(newPin);
    if (newPin.length === 4) {
      setLoading(true);
      loginMutation.mutate({
        agentId: agentId.trim().toUpperCase(),
        pin: newPin,
      });
    }
  };

  // ── PIN Reset — Step 1: Request OTP ───────────────────────────────────────
  const requestOtpMutation = trpc.pinReset.requestOtp.useMutation({
    onSuccess: () => {
      setOtpSent(true);
      toast.success(
        "If your details match, an OTP has been sent to your phone"
      );
      setStep("forgot_newpin");
      setLoading(false);
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
      setLoading(false);
    },
  });

  const handleRequestOtp = () => {
    if (resetAgentCode.trim().length < 3) {
      toast.error("Enter your agent ID");
      return;
    }
    if (resetPhone.trim().length < 10) {
      toast.error("Enter your registered phone number");
      return;
    }
    setLoading(true);
    requestOtpMutation.mutate({
      agentId: resetAgentCode.trim().toUpperCase(),
      phone: resetPhone.trim(),
    });
  };

  // ── PIN Reset — Step 2: Verify OTP + Set New PIN ──────────────────────────
  const resetPinMutation = trpc.pinReset.resetPin.useMutation({
    onSuccess: () => {
      toast.success("PIN reset successfully — please log in with your new PIN");
      setStep("code");
      setAgentCode(resetAgentCode);
      setResetPhone("");
      setResetOtp("");
      setResetNewPin("");
      setResetNewPinConfirm("");
      setResetAgentCode("");
      setOtpSent(false);
      setLoading(false);
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
      setLoading(false);
    },
  });

  const handleResetPin = () => {
    if (resetOtp.trim().length !== 6) {
      toast.error("Enter the 6-digit OTP");
      return;
    }
    if (resetNewPin.length !== 4) {
      toast.error("PIN must be 4 digits");
      return;
    }
    if (resetNewPin !== resetNewPinConfirm) {
      toast.error("PINs do not match");
      return;
    }
    setLoading(true);
    resetPinMutation.mutate({
      agentId: resetAgentCode.trim().toUpperCase(),
      otp: resetOtp.trim(),
      newPin: resetNewPin,
    });
  };

  const handleNewPinKey = (key: string, target: "new" | "confirm") => {
    const current = target === "new" ? resetNewPin : resetNewPinConfirm;
    const setter = target === "new" ? setResetNewPin : setResetNewPinConfirm;
    if (key === "DEL") {
      setter(p => p.slice(0, -1));
      return;
    }
    if (current.length >= 4) return;
    setter(current + key);
  };

  const PAD_KEYS = [
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "",
    "0",
    "DEL",
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* Logo */}
      <div className="mb-8 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-3"
          style={{ background: `${BLUE}22`, border: `1px solid ${BLUE}44` }}
        >
          🏦
        </div>
        <div
          className="text-2xl font-bold text-white"
          style={{ fontFamily: DISP }}
        >
          InsurePortal
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Insurance Management Platform
        </div>
      </div>

      {/* ── Agent Code ── */}
      {step === "code" && (
        <div className="w-full max-w-sm">
          <div className="text-sm text-gray-400 mb-2">Agent Code</div>
          <input
            type="text"
            value={agentId}
            onChange={e => setAgentCode(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && handleCodeSubmit()}
            placeholder="e.g. AGT001"
            className="w-full rounded-2xl px-4 py-4 text-white text-lg font-bold outline-none mb-4"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
              letterSpacing: "0.15em",
            }}
            autoFocus
          />
          <button
            onClick={handleCodeSubmit}
            className="w-full py-4 rounded-2xl font-bold text-white text-base transition-all active:scale-95"
            style={{ background: BLUE, fontFamily: DISP }}
          >
            Continue →
          </button>
          <div className="text-center mt-4 text-xs text-gray-600">
            Contact your supervisor if you do not have an agent ID
          </div>
          <button
            onClick={() => {
              setResetAgentCode(agentId);
              setStep("forgot_phone");
            }}
            className="w-full mt-3 py-2 rounded-xl text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Forgot PIN?
          </button>

          {/* ── SSO Divider ── */}
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px" style={{ background: BORDER }} />
            <span className="text-xs text-gray-600">or sign in with</span>
            <div className="flex-1 h-px" style={{ background: BORDER }} />
          </div>

          {/* ── Keycloak SSO Button (for supervisors / admins) ── */}
          <button
            onClick={async () => {
              try {
                const probe = await fetch("/api/auth/login", {
                  method: "GET",
                  redirect: "manual",
                });
                if (probe.status === 503) {
                  const body = await probe.json().catch(() => ({}));
                  toast.error(
                    body.message ??
                      "Keycloak SSO is not configured on this server."
                  );
                  return;
                }
              } catch {
                /* network error — proceed with redirect */
              }
              window.location.href = `/api/auth/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
            }}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm transition-all active:scale-95 hover:opacity-90"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              color: "#a3b3cc",
              fontFamily: DISP,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"
                fill="#3b82f6"
              />
            </svg>
            Supervisor / Admin SSO
          </button>
          <div className="text-center mt-2 text-xs text-gray-700">
            Powered by Keycloak OIDC
          </div>
        </div>
      )}

      {/* ── PIN Entry ── */}
      {step === "pin" && (
        <div className="w-full max-w-xs">
          <div className="text-center mb-6">
            <div className="text-sm text-gray-400 mb-1">Enter PIN</div>
            <div
              className="text-base font-bold text-white"
              style={{ fontFamily: MONO }}
            >
              {agentId}
            </div>
          </div>
          <div className="flex justify-center gap-4 mb-8">
            {[0, 1, 2, 3].map((i: any) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full transition-all"
                style={{
                  background: i < pin.length ? BLUE : BORDER,
                  transform: i < pin.length ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {PAD_KEYS.map((key, idx) => (
              <button
                key={idx}
                onClick={() => key && handlePinKey(key)}
                disabled={loading || !key}
                className="h-16 rounded-2xl font-bold text-xl transition-all active:scale-90 disabled:opacity-0"
                style={{
                  background: key === "DEL" ? BORDER : CARD,
                  color: key === "DEL" ? RED : "white",
                  border: `1px solid ${BORDER}`,
                  fontFamily: MONO,
                  cursor: key ? "pointer" : "default",
                }}
              >
                {key === "DEL" ? "⌫" : key}
              </button>
            ))}
          </div>
          {loading && (
            <div className="text-center mt-6 text-sm text-gray-400">
              Authenticating…
            </div>
          )}
          <button
            onClick={() => {
              setStep("code");
              setPin("");
            }}
            className="w-full mt-4 py-3 rounded-xl text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Change agent ID
          </button>
          <button
            onClick={() => {
              setResetAgentCode(agentId);
              setStep("forgot_phone");
            }}
            className="w-full py-2 rounded-xl text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            Forgot PIN?
          </button>
        </div>
      )}

      {/* ── Forgot PIN: Enter Phone ── */}
      {step === "forgot_phone" && (
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-lg font-bold text-white mb-1">Reset PIN</div>
            <div className="text-xs text-gray-500">
              Enter your agent ID and registered phone to receive an OTP
            </div>
          </div>
          <div className="text-sm text-gray-400 mb-2">Agent Code</div>
          <input
            type="text"
            value={resetAgentCode}
            onChange={e => setResetAgentCode(e.target.value.toUpperCase())}
            placeholder="e.g. AGT001"
            className="w-full rounded-2xl px-4 py-3 text-white font-bold outline-none mb-3"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
              letterSpacing: "0.1em",
            }}
          />
          <div className="text-sm text-gray-400 mb-2">
            Registered Phone Number
          </div>
          <input
            type="tel"
            value={resetPhone}
            onChange={e => setResetPhone(e.target.value)}
            placeholder="+234 800 000 0000"
            className="w-full rounded-2xl px-4 py-3 text-white outline-none mb-4"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
            }}
          />
          <button
            onClick={handleRequestOtp}
            disabled={loading}
            className="w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-95 disabled:opacity-60"
            style={{ background: GOLD, color: "#000", fontFamily: DISP }}
          >
            {loading ? "Sending OTP…" : "Send OTP →"}
          </button>
          <button
            onClick={() => setStep("code")}
            className="w-full mt-3 py-3 rounded-xl text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back to login
          </button>
        </div>
      )}

      {/* ── Forgot PIN: Enter OTP + New PIN ── */}
      {step === "forgot_newpin" && (
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-lg font-bold text-white mb-1">Set New PIN</div>
            {otpSent && (
              <div className="text-xs text-gray-500">
                OTP sent to <span style={{ color: GOLD }}>{resetPhone}</span>
              </div>
            )}
          </div>

          {/* OTP input */}
          <div className="text-sm text-gray-400 mb-2">6-Digit OTP</div>
          <input
            type="text"
            value={resetOtp}
            onChange={e =>
              setResetOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
            }
            placeholder="000000"
            maxLength={6}
            className="w-full rounded-2xl px-4 py-3 text-white text-xl font-bold text-center outline-none mb-4 tracking-widest"
            style={{
              background: CARD,
              border: `1px solid ${resetOtp.length === 6 ? GREEN : BORDER}`,
              fontFamily: MONO,
            }}
          />

          {/* New PIN */}
          <div className="text-sm text-gray-400 mb-2 text-center">
            New 4-Digit PIN
          </div>
          <div className="flex justify-center gap-4 mb-4">
            {[0, 1, 2, 3].map((i: any) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full transition-all"
                style={{
                  background: i < resetNewPin.length ? GREEN : BORDER,
                  transform: i < resetNewPin.length ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}
          </div>

          {/* Confirm PIN */}
          <div className="text-sm text-gray-400 mb-2 text-center">
            Confirm PIN
          </div>
          <div className="flex justify-center gap-4 mb-5">
            {[0, 1, 2, 3].map((i: any) => (
              <div
                key={i}
                className="w-4 h-4 rounded-full transition-all"
                style={{
                  background:
                    i < resetNewPinConfirm.length
                      ? resetNewPin.startsWith(resetNewPinConfirm)
                        ? GREEN
                        : RED
                      : BORDER,
                  transform:
                    i < resetNewPinConfirm.length ? "scale(1.2)" : "scale(1)",
                }}
              />
            ))}
          </div>

          {/* PIN pad — fills new first, then confirm */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {PAD_KEYS.map((key, idx) => (
              <button
                key={idx}
                onClick={() => {
                  if (!key) return;
                  if (resetNewPin.length < 4) handleNewPinKey(key, "new");
                  else handleNewPinKey(key, "confirm");
                }}
                disabled={loading || !key}
                className="h-14 rounded-2xl font-bold text-xl transition-all active:scale-90 disabled:opacity-0"
                style={{
                  background: key === "DEL" ? BORDER : CARD,
                  color: key === "DEL" ? RED : "white",
                  border: `1px solid ${BORDER}`,
                  fontFamily: MONO,
                  cursor: key ? "pointer" : "default",
                }}
              >
                {key === "DEL" ? "⌫" : key}
              </button>
            ))}
          </div>

          <button
            onClick={handleResetPin}
            disabled={
              loading ||
              resetOtp.length !== 6 ||
              resetNewPin.length !== 4 ||
              resetNewPinConfirm.length !== 4
            }
            className="w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-95 disabled:opacity-50"
            style={{
              background:
                resetNewPin === resetNewPinConfirm && resetNewPin.length === 4
                  ? GREEN
                  : "#374151",
              color:
                resetNewPin === resetNewPinConfirm && resetNewPin.length === 4
                  ? "#000"
                  : "#9ca3af",
              fontFamily: DISP,
            }}
          >
            {loading
              ? "Resetting…"
              : resetNewPin !== resetNewPinConfirm &&
                  resetNewPinConfirm.length === 4
                ? "PINs don't match"
                : "✓ Reset PIN"}
          </button>

          <button
            onClick={() => setStep("forgot_phone")}
            className="w-full mt-3 py-3 rounded-xl text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Resend OTP
          </button>
        </div>
      )}
    </div>
  );
}
