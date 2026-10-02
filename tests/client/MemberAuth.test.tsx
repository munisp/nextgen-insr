/**
 * MemberAuth.test.tsx — member-facing auth flow tests (W7-B4).
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub — the same boundary MemberPages.test.tsx uses. The real
 * useAuth hook reads the session through the scripted trpc.auth.me query.
 *
 * Proves:
 *   - /member/login renders a REAL SSO entry link (GET /api/auth/login via
 *     getLoginUrl) — no password form, no demo credentials.
 *   - returnTo is honored only for same-origin /member paths (fail-closed
 *     open-redirect guard).
 *   - Backend auth failures (?auth_error= from /api/auth/callback) are
 *     surfaced honestly.
 *   - An authenticated session (real trpc.auth.me data) redirects into the
 *     portal instead of showing the sign-in link.
 *   - MemberLayout renders its redirecting state (never member content) for
 *     an anonymous session.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberLogin, {
  sanitizeMemberReturnTo,
  MEMBER_HOME,
} from "@/pages/member/MemberLogin";
import MemberLayout from "@/pages/member/MemberLayout";
import { setQuery, resetTrpcMock } from "./helpers/trpcMock";

const MEMBER = {
  id: 9001,
  name: "Adaeze Test",
  email: "adaeze@example.com",
  role: "user",
};

function setLocation(url: string) {
  window.history.pushState({}, "", url);
}

describe("sanitizeMemberReturnTo", () => {
  it("honors same-origin member paths", () => {
    expect(sanitizeMemberReturnTo("/member/claims")).toBe("/member/claims");
    expect(sanitizeMemberReturnTo("/member")).toBe("/member");
  });

  it("falls back to member home for external or non-member targets", () => {
    expect(sanitizeMemberReturnTo("https://evil.example/")).toBe(MEMBER_HOME);
    expect(sanitizeMemberReturnTo("//evil.example/x")).toBe(MEMBER_HOME);
    expect(sanitizeMemberReturnTo("/admin")).toBe(MEMBER_HOME);
    expect(sanitizeMemberReturnTo("javascript:alert(1)")).toBe(MEMBER_HOME);
    expect(sanitizeMemberReturnTo(null)).toBe(MEMBER_HOME);
  });
});

describe("MemberLogin page", () => {
  beforeEach(() => {
    resetTrpcMock();
    setLocation("/member/login");
  });
  afterEach(() => cleanup());

  it("anonymous visitor gets a real SSO link, no credential form", () => {
    setQuery("auth.me", { data: null });
    render(<MemberLogin />);
    const link = screen.getByRole("link", {
      name: /Sign in with InsurePortal SSO/,
    });
    expect(link).toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent(MEMBER_HOME)}`
    );
    // No password/username inputs may exist on this page.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/password/i)
    ).not.toBeInTheDocument();
  });

  it("preserves a legitimate member returnTo in the SSO link", () => {
    setQuery("auth.me", { data: null });
    setLocation("/member/login?returnTo=%2Fmember%2Fclaims");
    render(<MemberLogin />);
    expect(
      screen.getByRole("link", { name: /Sign in with InsurePortal SSO/ })
    ).toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent("/member/claims")}`
    );
  });

  it("rejects an external returnTo (fail-closed open-redirect guard)", () => {
    setQuery("auth.me", { data: null });
    setLocation(
      `/member/login?returnTo=${encodeURIComponent("https://evil.example/")}`
    );
    render(<MemberLogin />);
    expect(
      screen.getByRole("link", { name: /Sign in with InsurePortal SSO/ })
    ).toHaveAttribute(
      "href",
      `/api/auth/login?returnTo=${encodeURIComponent(MEMBER_HOME)}`
    );
  });

  it("surfaces a backend auth_error honestly", () => {
    setQuery("auth.me", { data: null });
    setLocation("/member/login?auth_error=access_denied");
    render(<MemberLogin />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sign-in failed: access_denied"
    );
  });

  it("surfaces a session-query failure honestly", () => {
    setQuery("auth.me", {
      data: undefined,
      isError: true,
      error: { message: "session service unavailable" },
    });
    render(<MemberLogin />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not verify your session: session service unavailable"
    );
  });

  it("loading session renders the checking state, not the sign-in link", () => {
    setQuery("auth.me", { isLoading: true });
    render(<MemberLogin />);
    expect(
      screen.queryByRole("link", { name: /Sign in with InsurePortal SSO/ })
    ).not.toBeInTheDocument();
  });

  it("authenticated member is redirected into the portal", () => {
    setQuery("auth.me", { data: MEMBER });
    setLocation("/member/login?returnTo=%2Fmember%2Fpolicies");
    render(<MemberLogin />);
    expect(window.location.pathname).toBe("/member/policies");
    expect(
      screen.queryByRole("link", { name: /Sign in with InsurePortal SSO/ })
    ).not.toBeInTheDocument();
  });
});

describe("MemberLayout auth gate", () => {
  beforeEach(() => {
    resetTrpcMock();
    setLocation("/member/quotes");
  });
  afterEach(() => cleanup());

  it("anonymous session renders the redirecting state, never member content", () => {
    setQuery("auth.me", { data: null });
    render(
      <MemberLayout>
        <div>secret member content</div>
      </MemberLayout>
    );
    expect(screen.getByLabelText("Redirecting to sign in")).toBeInTheDocument();
    expect(screen.queryByText("secret member content")).not.toBeInTheDocument();
    expect(screen.queryByText("Member Portal")).not.toBeInTheDocument();
  });

  it("authenticated member sees the shell and children", () => {
    setQuery("auth.me", { data: MEMBER });
    render(
      <MemberLayout>
        <div>real member content</div>
      </MemberLayout>
    );
    expect(screen.getByText("Member Portal")).toBeInTheDocument();
    expect(screen.getByText("real member content")).toBeInTheDocument();
    expect(screen.getByText(/Signed in as Adaeze Test/)).toBeInTheDocument();
  });
});
