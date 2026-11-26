export function getLoginUrl() {
  return "/login";
}

// 2026-11-27 (W25): added for the ported client/src/_core/hooks/useAuth.ts
// (T2 of the tsc burn-down). Matches main repo client/src/const.ts; the
// route is served by insureportal/server/_core/keycloakAuth.ts
// (app.get("/api/auth/logout"), line ~247).
export const getLogoutUrl = (): string => "/api/auth/logout";
