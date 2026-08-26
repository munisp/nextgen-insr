// Sprint 87: Upgraded from mock data to real DB queries — mfaManager
// DD-AUTH (F6-3): the previous implementation was THEATER — enableTotp,
// verifyTotp, enableSms2fa, disableMfa and getBackupCodes were byte-identical
// pagination queries over platformSettings that enrolled nothing, verified
// nothing and disabled nothing. There is no TOTP/SMS/WebAuthn verification
// capability in this codebase (no TOTP library in-tree; the production
// Keycloak realm has no MFA flow), so every mutation here now fails LOUD
// instead of pretending MFA exists. getMfaStatus reports the honest state.
import { TRPCError } from "@trpc/server";

import { protectedProcedure, router } from "../_core/trpc";

const MFA_UNAVAILABLE_REASON =
  "MFA enrollment is not implemented: this deployment has no TOTP/SMS/WebAuthn " +
  "verification capability (no in-tree authenticator, and the Keycloak realm " +
  "has no MFA flow configured). Do not rely on MFA for step-up; financial " +
  "operations are gated by role + maker-checker instead.";

function mfaNotImplemented(capability: string): TRPCError {
  return new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `${capability} is not implemented: ${MFA_UNAVAILABLE_REASON}`,
  });
}

const getMfaStatus = protectedProcedure.query(({ ctx }) => {
  // Honest status: the DB flag is reported as-is, plus the hard truth that
  // no second factor can actually be enrolled or challenged in this
  // deployment, so `available` is always false.
  return {
    mfaEnabled: ctx.user.mfaEnabled ?? false,
    available: false,
    reason: MFA_UNAVAILABLE_REASON,
  };
});

const enableTotp = protectedProcedure.mutation(() => {
  throw mfaNotImplemented("TOTP enrollment");
});

const verifyTotp = protectedProcedure.mutation(() => {
  throw mfaNotImplemented("TOTP verification");
});

const enableSms2fa = protectedProcedure.mutation(() => {
  throw mfaNotImplemented("SMS 2FA enrollment");
});

const disableMfa = protectedProcedure.mutation(() => {
  throw mfaNotImplemented("MFA disable");
});

const getBackupCodes = protectedProcedure.query(() => {
  throw mfaNotImplemented("MFA backup codes");
});

export const mfaManagerRouter = router({
  getMfaStatus,
  enableTotp,
  verifyTotp,
  enableSms2fa,
  disableMfa,
  getBackupCodes,
});
