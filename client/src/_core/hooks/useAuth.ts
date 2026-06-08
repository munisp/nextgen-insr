/**
 * useAuth.ts — Authentication hook for InsurePortal Shell
 *
 * Uses Keycloak OIDC for authentication.
 *  - Login: redirect to /api/auth/login (Keycloak Authorization Code flow)
 *  - Logout: redirect to /api/auth/logout (clears cookie + Keycloak end-session)
 *  - Session: trpc.auth.me.useQuery() reads the current user from the DB
 *
 * The hook interface is unchanged from the Manus OAuth version so all
 * existing consumers continue to work without modification.
 */

import { getLoginUrl, getLogoutUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useMemo, useState } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};

  const utils = trpc.useUtils();
  const [loggingOut, setLoggingOut] = useState(false);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  /**
   * Logout: clear the tRPC cache immediately for a snappy UI, then redirect
   * to the Keycloak end-session endpoint via the backend logout route.
   */
  const logout = useCallback(async () => {
    setLoggingOut(true);
    utils.auth.me.setData(undefined, null);
    await utils.auth.me.invalidate();
    window.location.href = getLogoutUrl();
  }, [utils]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || loggingOut,
      error: meQuery.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [meQuery.data, meQuery.error, meQuery.isLoading, loggingOut]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || loggingOut) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    loggingOut,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
