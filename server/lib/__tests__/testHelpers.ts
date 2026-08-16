/**
 * Shared test utilities for creating tRPC callers with proper auth context.
 */
import type { TrpcContext } from "../../_core/context";

export const MOCK_USER = {
  id: 1,
  username: "test-agent",
  role: "admin" as const,
  agentId: "AGT001",
  name: "Test Agent",
  email: "test@insureportal.io",
};

export function makeAuthenticatedCtx(
  overrides: Partial<TrpcContext> = {}
): TrpcContext {
  return {
    user: MOCK_USER as any,
    requestId: "test-request",
    req: {
      headers: { cookie: "agent_session=mock.jwt.token" },
      ip: "127.0.0.1",
      protocol: "http",
    } as any,
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as any,
    ...overrides,
  };
}

export function makeUnauthenticatedCtx(
  overrides: Partial<TrpcContext> = {}
): TrpcContext {
  return {
    user: null,
    requestId: "test-request",
    req: {
      headers: {},
      ip: "127.0.0.1",
      protocol: "http",
    } as any,
    res: {
      cookie: () => {},
      clearCookie: () => {},
    } as any,
    ...overrides,
  };
}
