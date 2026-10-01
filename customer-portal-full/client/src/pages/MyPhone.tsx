/**
 * MyPhone.tsx — R3 batch 6 (2026-10-01, R3-b6)
 * Member phone-ownership verification (route /my-phone).
 * BINDING: REAL — memberPhone.requestPhoneOtp / verifyPhoneOtp
 * (server/routers/memberPhone.ts, protectedProcedure delegating to the real
 * phoneOwnership OTP flow: bcrypt-hashed codes in phone_verification_otps,
 * 5-attempt fail-closed lock, per-phone throttle, fail-loud SMS). The
 * caller's customer profile is required server-side; this page NEVER sends
 * a userId/customerId. The server never echoes the phone back — the
 * entered value is held in local component state only. Server errors
 * (throttle, lock, SMS outage) are shown verbatim. No success is
 * fabricated.
 */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Phone, ShieldCheck } from "lucide-react";
import { memberPhoneApi } from "@/services/memberPhoneApi";

export default function MyPhone() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const requestMutation = useMutation({
    mutationFn: () => memberPhoneApi.requestPhoneOtp({ phone: phone.trim() }),
    onSuccess: result => {
      setActionError(null);
      setOtpSent(true);
      setVerified(false);
      setNotice(result?.message ?? "Verification code sent by SMS");
    },
    onError: error => {
      // Honest failure surface: throttle / SMS outage shown verbatim.
      setNotice(null);
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      memberPhoneApi.verifyPhoneOtp({ phone: phone.trim(), otp: otp.trim() }),
    onSuccess: result => {
      setActionError(null);
      if (result?.verified) {
        setVerified(true);
        setNotice("Phone number verified.");
      } else {
        setNotice(null);
        setActionError("Verification failed — please request a new code.");
      }
    },
    onError: error => {
      // Wrong code / locked token / expired — server's exact reason.
      setNotice(null);
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  return (
    <div className="mx-auto max-w-xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Verify My Phone
        </h1>
        <p className="text-sm text-stone-500">
          Prove ownership of your phone number with a one-time SMS code. The
          code is valid for 10 minutes; too many wrong attempts lock it.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Phone className="h-5 w-5 text-amber-600" aria-hidden />
            Phone verification
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="space-y-3"
            onSubmit={e => {
              e.preventDefault();
              setActionError(null);
              setNotice(null);
              requestMutation.mutate();
            }}
          >
            <label className="block text-sm text-stone-600">
              Phone number
              <input
                required
                type="tel"
                minLength={10}
                maxLength={15}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="e.g. 08031234567"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                disabled={verified}
              />
            </label>
            {!verified && (
              <button
                type="submit"
                disabled={requestMutation.isPending || phone.trim().length < 10}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {requestMutation.isPending ? "Sending…" : "Send code"}
              </button>
            )}
          </form>

          {otpSent && !verified && (
            <form
              className="space-y-3 border-t border-stone-100 pt-4"
              onSubmit={e => {
                e.preventDefault();
                setActionError(null);
                setNotice(null);
                verifyMutation.mutate();
              }}
            >
              <label className="block text-sm text-stone-600">
                6-digit code
                <input
                  required
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  className="mt-1 w-40 rounded-lg border border-stone-300 px-3 py-2 text-sm tracking-widest"
                  value={otp}
                  onChange={e => setOtp(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={verifyMutation.isPending || otp.trim().length !== 6}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {verifyMutation.isPending ? "Verifying…" : "Verify"}
              </button>
            </form>
          )}

          {verified && (
            <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Phone number verified.
            </p>
          )}
          {notice && !verified && (
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
              {notice}
            </p>
          )}
          {actionError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
