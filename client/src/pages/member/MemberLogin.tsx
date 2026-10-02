/**
 * MemberLogin.tsx — /member/login (W7-B4, 2026-10-02)
 *
 * Member-facing sign-in entry for the portal shell (W7-B1). Honest-contract
 * choices (2026-10-02, W7-B4):
 *
 *   - There is NO password form here and no member-auth tRPC mutation:
 *     member identity in the monolith is Keycloak OIDC — the ONLY real
 *     server-side login mechanism is the Authorization Code flow at
 *     GET /api/auth/login (server/_core/keycloakAuth.ts:467), which issues
 *     the kc_session cookie consumed by tRPC ctx (server/_core/context.ts).
 *     This page therefore links to that endpoint via getLoginUrl() and never
 *     collects credentials itself.
 *   - Signup / password reset / MFA enrollment are realm-side Keycloak
 *     capabilities (surfaced on the Keycloak login page itself); no monolith
 *     procedures exist for them, so no client-only screens are fabricated
 *     for them here.
 *   - Session state comes from the REAL trpc.auth.me query (via useAuth),
 *     never a stored boolean: an already-authenticated visitor is redirected
 *     straight into the portal; an anonymous visitor sees the sign-in link.
 *   - returnTo is sanitized fail-closed: only same-origin "/member" paths
 *     are honored (the backend callback redirects to returnTo verbatim), so
 *     this page cannot be used as an open-redirect stepping stone.
 *   - Backend failures are surfaced honestly: ?auth_error= (set by
 *     /api/auth/callback on Keycloak errors) renders the real error text;
 *     a session-query failure renders the tRPC error message.
 */
import { Redirect, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AlertTriangle, LogIn, ShieldCheck } from "lucide-react";
import { MemberLoading } from "./MemberLayout";

export const MEMBER_HOME = "/member/quotes";

/**
 * Fail-closed returnTo sanitizer: only same-origin member-portal paths are
 * honored. Anything else (absolute URLs, protocol-relative "//host", paths
 * outside /member) falls back to the member home so a crafted login link
 * cannot bounce the member off-site after SSO.
 */
export function sanitizeMemberReturnTo(raw: string | null): string {
  if (raw && raw.startsWith("/member") && !raw.startsWith("//")) {
    return raw;
  }
  return MEMBER_HOME;
}

function readParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function MemberLogin() {
  const { user, loading, error } = useAuth();
  const [location] = useLocation();

  const params = readParams();
  const returnTo = sanitizeMemberReturnTo(
    params.get("returnTo") ??
      // A direct visit to /member/login has no returnTo; land on the portal.
      (location === "/member/login" ? null : location)
  );
  const authError = params.get("auth_error");

  if (loading) {
    return (
      <div className="container max-w-md mx-auto py-16 px-4">
        <MemberLoading label="Checking your session" />
      </div>
    );
  }

  // Real session exists — go straight into the portal.
  if (user) {
    return <Redirect to={returnTo} />;
  }

  return (
    <div className="container max-w-md mx-auto py-16 px-4">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Member Portal Sign In
          </CardTitle>
          <CardDescription>
            Sign in with your InsurePortal account to view your quotes,
            policies, claims and payments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authError ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Sign-in failed: {authError}</span>
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>Could not verify your session: {error.message}</span>
            </div>
          ) : null}
          {/* Real SSO entry point: GET /api/auth/login (Keycloak Authorization
              Code flow). The backend sets the kc_session cookie and returns
              to returnTo after the callback. */}
          <Button asChild className="w-full" size="lg">
            <a href={getLoginUrl(returnTo)}>
              <LogIn className="h-4 w-4 mr-2" />
              Sign in with InsurePortal SSO
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            Account registration, password reset and multi-factor setup are
            handled by the identity provider on the sign-in page. If you do
            not have an account, contact your insurer or agent.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
