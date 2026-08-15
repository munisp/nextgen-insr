/**
 * trpcMock.ts — scriptable stand-in for client/src/lib/trpc.
 *
 * This is the ONLY mocked module in the client page tests: it replaces the
 * tRPC network client boundary. Pages (and the real useAuth hook, which also
 * goes through trpc.auth.me) receive fully-scriptable query/mutation results.
 *
 * Shape:
 *   trpc.<router>.<procedure>.useQuery(input?, opts?)    → registered result
 *   trpc.<router>.<procedure>.useMutation(opts?)          → recording stub
 *   trpc.useUtils() / trpc.useContext()                   → no-op deep proxy
 *
 * Default query result (no registration): a successfully-settled EMPTY query
 * (data undefined, isLoading false) — the truthful "no data" state.
 */
import { vi } from "vitest";

export interface MockQueryResult {
  data?: unknown;
  isLoading?: boolean;
  isError?: boolean;
  error?: { message: string } | null;
  isSuccess?: boolean;
  status?: "pending" | "error" | "success";
  fetchStatus?: "fetching" | "paused" | "idle";
  isFetched?: boolean;
  refetch?: () => void;
}

const queryResults = new Map<string, MockQueryResult>();
const mutationCalls: { path: string; input: unknown }[] = [];

/** Register the result a given procedure's useQuery returns, e.g.
 *  setQuery("fraud.list", { isLoading: true }). */
export function setQuery(path: string, result: MockQueryResult): void {
  queryResults.set(path, result);
}

export function resetTrpcMock(): void {
  queryResults.clear();
  mutationCalls.length = 0;
}

/** Inputs recorded for <path>.useMutation().mutate(...) calls. */
export function getMutationCalls(path: string): unknown[] {
  return mutationCalls.filter(c => c.path === path).map(c => c.input);
}

const DEFAULT_QUERY: Required<Omit<MockQueryResult, "data" | "error">> & {
  data: undefined;
  error: null;
} = {
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  isSuccess: true,
  status: "success",
  fetchStatus: "idle",
  isFetched: true,
  refetch: vi.fn(),
};

function normalizeQuery(r: MockQueryResult): MockQueryResult {
  const merged = { ...DEFAULT_QUERY, ...r };
  // Keep derived flags coherent with the simple knobs tests set.
  if (r.isLoading) {
    merged.isSuccess = false;
    merged.status = "pending";
    merged.fetchStatus = "fetching";
  }
  if (r.isError) {
    merged.isSuccess = false;
    merged.status = "error";
  }
  return merged;
}

/** Deeply-callable no-op proxy for trpc.useUtils() (cache helpers). */
function makeUtilsProxy(): unknown {
  const fn = function () {
    return makeUtilsProxy();
  };
  return new Proxy(fn, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "then") return undefined; // stay non-thenable
      return makeUtilsProxy();
    },
    apply() {
      return makeUtilsProxy();
    },
  });
}

function makeTrpcProxy(path: string[]): unknown {
  const fn = function () {};
  return new Proxy(fn, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      switch (prop) {
        case "useQuery":
        case "useSuspenseQuery": {
          const key = path.join(".");
          return () => normalizeQuery(queryResults.get(key) ?? {});
        }
        case "useInfiniteQuery": {
          const key = path.join(".");
          return () => ({
            ...normalizeQuery(queryResults.get(key) ?? {}),
            fetchNextPage: vi.fn(),
            hasNextPage: false,
            isFetchingNextPage: false,
          });
        }
        case "useMutation": {
          const key = path.join(".");
          return (opts?: {
            onSuccess?: (data: unknown) => void;
            onError?: (err: unknown) => void;
          }) => ({
            mutate: (input: unknown) => {
              mutationCalls.push({ path: key, input });
            },
            mutateAsync: async (input: unknown) => {
              mutationCalls.push({ path: key, input });
              return undefined;
            },
            isPending: false,
            isError: false,
            isSuccess: false,
            error: null,
            reset: vi.fn(),
          });
        }
        case "useUtils":
        case "useContext":
          return () => makeUtilsProxy();
        case "createClient":
          return () => ({});
        case "Provider":
          // If a page ever renders <trpc.Provider>, pass children through.
          return ({ children }: { children?: unknown }) => children;
        default:
          return makeTrpcProxy([...path, prop]);
      }
    },
  });
}

export const trpc = makeTrpcProxy([]) as unknown as Record<string, never>;
