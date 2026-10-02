/**
 * MemberLayout.tsx — /member/* portal shell.
 *
 * Route guard: every member page requires an authenticated session
 * (member = authenticated platform user; the member* tRPC routers are all
 * protectedProcedure and enforce caller scoping server-side). Follows the
 * useAuth redirect pattern from client/src/_core/hooks/useAuth.ts.
 *
 * Nav: Quotes, Policies, Claims, Payments, Profile (wouter Links, same
 * router as the rest of the client).
 */
import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, FileText, ShieldCheck, CreditCard, User, FileSignature, RefreshCw, Users, FilePenLine, Wallet, PiggyBank, Star, UserPlus } from "lucide-react";

const NAV_ITEMS = [
  { href: "/member/quotes", label: "Quotes", icon: FileSignature },
  { href: "/member/policies", label: "Policies", icon: ShieldCheck },
  // 2026-10-02 (W7-B5): policy servicing surfaces.
  { href: "/member/renewals", label: "Renewals", icon: RefreshCw },
  { href: "/member/beneficiaries", label: "Beneficiaries", icon: Users },
  { href: "/member/endorsements", label: "Endorsements", icon: FilePenLine },
  { href: "/member/claims", label: "Claims", icon: FileText },
  { href: "/member/payments", label: "Payments", icon: CreditCard },
  // 2026-10-03 (W7-B7): money & rewards surfaces (wallet/savings/loyalty/
  // referrals) — read-only real backends; no fabricated funds actions.
  { href: "/member/wallet", label: "Wallet", icon: Wallet },
  { href: "/member/savings", label: "Savings", icon: PiggyBank },
  { href: "/member/loyalty", label: "Loyalty", icon: Star },
  { href: "/member/referrals", label: "Referrals", icon: UserPlus },
  { href: "/member/profile", label: "Profile", icon: User },
];

/** Shared page-state helpers (loading / error) used by every member page so
 *  all lists render honest states and never fabricate rows. */
export function MemberLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label={label}>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function MemberError({ message }: { message: string }) {
  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" /> Unable to load data
        </CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}

export default function MemberLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  // 2026-10-02 (W7-B4): anonymous members bounce to the member-facing
  // /member/login page (which initiates the real Keycloak SSO flow and
  // returns here) instead of the raw /api/auth/login API URL.
  const { user, loading, error } = useAuth({
    redirectOnUnauthenticated: true,
    redirectPath: `/member/login?returnTo=${encodeURIComponent(location)}`,
  });

  if (loading) {
    return (
      <div className="container max-w-5xl mx-auto py-10 px-4">
        <MemberLoading label="Checking your session" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container max-w-5xl mx-auto py-10 px-4">
        <MemberError message={error.message} />
      </div>
    );
  }

  // Redirect is in flight (useAuth handles window.location); render nothing
  // rather than a flash of member content for an anonymous session.
  if (!user) {
    return (
      <div className="container max-w-5xl mx-auto py-10 px-4">
        <MemberLoading label="Redirecting to sign in" />
      </div>
    );
  }

  return (
    <div className="container max-w-5xl mx-auto py-6 px-4 space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Member Portal</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as {user.name ?? user.email ?? "member"}
          </p>
        </div>
        <nav aria-label="Member portal">
          <div className="flex flex-wrap gap-2">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = location.startsWith(href);
              return (
                <Link key={href} href={href}>
                  <Button
                    variant={active ? "default" : "outline"}
                    size="sm"
                    aria-current={active ? "page" : undefined}
                  >
                    <Icon className="h-4 w-4 mr-1" />
                    {label}
                  </Button>
                </Link>
              );
            })}
          </div>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}

/** Small presentational wrapper for a page section. */
export function MemberSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
