/**
 * memberHelpDesk.test.ts — R3 batch 1 (2026-10-01, R3)
 *
 * Tests for server/routers/memberHelpDesk.ts (myTickets / myTicket /
 * createTicket / replyTicket). The router is exercised through a real tRPC
 * caller; only the DB driver boundary (getDb) is substituted with a
 * stateful in-memory drizzle-compatible double — no router behavior is
 * mocked. Auth contexts follow server/lib/__tests__/testHelpers.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

// ── drizzle-orm operator doubles ────────────────────────────────────────────
// The in-memory DB below evaluates predicates structurally, so eq/and/asc/desc
// become plain descriptors. Everything else (pg-core builders, sql, …) is the
// real module.
vi.mock("drizzle-orm", async importOriginal => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: { name: string }, val: unknown) => ({ __eq: [col.name, val] }),
    and: (...conds: unknown[]) => ({ __and: conds }),
    asc: (col: { name: string }) => ({ __ord: [col.name, "asc"] }),
    desc: (col: { name: string }) => ({ __ord: [col.name, "desc"] }),
  };
});

// ── In-memory DB state + double ──────────────────────────────────────────────
interface Row {
  [key: string]: unknown;
}

const state = {
  customers: [] as Row[],
  sessions: [] as Row[],
  messages: [] as Row[],
  audit: [] as Row[],
};
let nextId = 1;

function resetState() {
  state.customers = [
    {
      id: 10,
      keycloakSub: "1",
      firstName: "Ada",
      lastName: "Member",
      deletedAt: null,
    },
    {
      id: 20,
      keycloakSub: "2",
      firstName: "Other",
      lastName: "Member",
      deletedAt: null,
    },
  ];
  state.sessions = [
    {
      id: 100,
      sessionRef: "CHT-OWNED",
      agentId: 10,
      subject: "My policy question",
      status: "open",
      supportAgentName: null,
      createdAt: new Date("2026-09-30T10:00:00Z"),
      updatedAt: new Date("2026-09-30T10:00:00Z"),
    },
    {
      id: 101,
      sessionRef: "CHT-STRANGER",
      agentId: 20,
      subject: "Someone else's ticket",
      status: "open",
      supportAgentName: null,
      createdAt: new Date("2026-09-30T11:00:00Z"),
      updatedAt: new Date("2026-09-30T11:00:00Z"),
    },
    {
      id: 102,
      sessionRef: "CHT-RESOLVED",
      agentId: 10,
      subject: "Old resolved ticket",
      status: "resolved",
      supportAgentName: null,
      createdAt: new Date("2026-09-29T09:00:00Z"),
      updatedAt: new Date("2026-09-29T09:00:00Z"),
    },
  ];
  state.messages = [
    {
      id: 1000,
      sessionId: 100,
      senderType: "agent",
      senderName: "Ada Member",
      content: "Initial question",
      createdAt: new Date("2026-09-30T10:00:00Z"),
    },
  ];
  state.audit = [];
  nextId = 10000;
}

function evalCond(cond: unknown, rows: Row[]): Row[] {
  if (cond == null) return rows;
  const c = cond as { __eq?: [string, unknown]; __and?: unknown[] };
  if (c.__eq) {
    const [col, val] = c.__eq;
    return rows.filter(r => r[col] === val);
  }
  if (c.__and) return c.__and.reduce((acc, sub) => evalCond(sub, acc), rows);
  throw new Error("unsupported condition in test double");
}

function project(row: Row, cols: Record<string, { name: string }> | undefined): Row {
  if (!cols) return row;
  const out: Row = {};
  for (const [key, col] of Object.entries(cols)) out[key] = row[col.name];
  return out;
}

function makeThenable<T>(value: T): PromiseLike<T> {
  return {
    then: (onFulfilled?: ((v: T) => unknown) | null) =>
      Promise.resolve(value).then(onFulfilled as (v: T) => never),
  } as PromiseLike<T>;
}

function selectFrom(tableRows: Row[], cols?: Record<string, { name: string }>) {
  let rows = tableRows.slice();
  const builder = {
    where(cond: unknown) {
      rows = evalCond(cond, rows);
      return builder;
    },
    orderBy(...ords: { __ord: [string, "asc" | "desc"] }[]) {
      for (const { __ord } of ords) {
        const [col, dir] = __ord;
        rows.sort((a, b) => {
          const av = a[col] as number | string | Date;
          const bv = b[col] as number | string | Date;
          const cmp = av > bv ? 1 : av < bv ? -1 : 0;
          return dir === "asc" ? cmp : -cmp;
        });
      }
      return builder;
    },
    limit(n: number) {
      rows = rows.slice(0, n);
      return builder;
    },
    then: (onFulfilled?: ((v: Row[]) => unknown) | null) =>
      Promise.resolve(rows.map(r => project(r, cols))).then(
        onFulfilled as (v: Row[]) => never
      ),
  };
  return builder;
}

function fakeDb() {
  return {
    select(cols?: Record<string, { name: string }>) {
      return {
        from(table: unknown) {
          return selectFrom(rowsFor(table), cols);
        },
      };
    },
    insert(table: unknown) {
      return {
        values(v: Row) {
          const rows = rowsFor(table);
          const row: Row = { id: nextId++, createdAt: new Date(), ...v };
          // Apply the chat_sessions column defaults the real schema provides
          // (status default "open", updatedAt default now()).
          if (tableNameOf(table) === "chat_sessions") {
            row.status = row.status ?? "open";
            row.updatedAt = row.updatedAt ?? new Date();
          }
          rows.push(row);
          return {
            returning: () => makeThenable([row]),
            ...makeThenable(undefined),
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(patch: Row) {
          return {
            where(cond: unknown) {
              for (const r of evalCond(cond, rowsFor(table))) Object.assign(r, patch);
              return makeThenable(undefined);
            },
          };
        },
      };
    },
  };
}

import { auditLog, chatMessages, chatSessions, customers } from "../../../drizzle/schema";

function tableNameOf(table: unknown): string {
  if (table === chatSessions) return "chat_sessions";
  if (table === chatMessages) return "chat_messages";
  if (table === customers) return "customers";
  if (table === auditLog) return "audit_log";
  throw new Error("unknown table in test double");
}

function rowsFor(table: unknown): Row[] {
  switch (tableNameOf(table)) {
    case "chat_sessions":
      return state.sessions;
    case "chat_messages":
      return state.messages;
    case "customers":
      return state.customers;
    default:
      return state.audit;
  }
}

// ── db module: real module, getDb overridden to the in-memory double ────────
const getDbMock = vi.fn();
vi.mock("../../db", async importOriginal => {
  const actual = await importOriginal<typeof import("../../db")>();
  return { ...actual, getDb: () => getDbMock() };
});

import { router } from "../../_core/trpc";
import { memberHelpDeskRouter } from "../memberHelpDesk";

// Standalone mount — the orchestrator wires this into appRouter as
// `memberHelpDesk`; the test mounts it under the same name.
const testRouter = router({ memberHelpDesk: memberHelpDeskRouter });

describe("memberHelpDesk router", () => {
  beforeEach(() => {
    resetState();
    getDbMock.mockReset();
    getDbMock.mockResolvedValue(fakeDb());
  });

  it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
    const caller = testRouter.createCaller(makeUnauthenticatedCtx());
    await expect(caller.memberHelpDesk.myTickets()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      caller.memberHelpDesk.myTicket({ id: 100 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.memberHelpDesk.createTicket({
        subject: "x",
        description: "y",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.memberHelpDesk.replyTicket({ ticketId: 100, content: "hi" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("myTickets returns only the caller's own tickets (scope isolation)", async () => {
    const caller = testRouter.createCaller(makeAuthenticatedCtx()); // user id 1 → customer 10
    const res = await caller.memberHelpDesk.myTickets();
    expect(res).not.toBeNull();
    const ids = res!.tickets.map((t: { id: number }) => t.id).sort();
    expect(ids).toEqual([100, 102]);
    for (const t of res!.tickets as { agentId: number }[]) {
      expect(t.agentId).toBe(10);
    }
  });

  it("myTickets honors the status filter within the caller's scope", async () => {
    const caller = testRouter.createCaller(makeAuthenticatedCtx());
    const res = await caller.memberHelpDesk.myTickets({ status: "resolved" });
    expect(res!.tickets.map((t: { id: number }) => t.id)).toEqual([102]);
  });

  it("myTicket returns the caller's ticket with its thread", async () => {
    const caller = testRouter.createCaller(makeAuthenticatedCtx());
    const res = await caller.memberHelpDesk.myTicket({ id: 100 });
    expect(res!.ticket.id).toBe(100);
    expect(res!.messages).toHaveLength(1);
    expect(res!.messages[0].content).toBe("Initial question");
  });

  it("myTicket on another member's ticket → NOT_FOUND (non-enumerating)", async () => {
    const caller = testRouter.createCaller(makeAuthenticatedCtx());
    await expect(
      caller.memberHelpDesk.myTicket({ id: 101 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Nonexistent ids are indistinguishable from cross-member ids.
    await expect(
      caller.memberHelpDesk.myTicket({ id: 99999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("createTicket forces the owner to the caller's customer and writes thread + audit", async () => {
    const caller = testRouter.createCaller(makeAuthenticatedCtx());
    const ticket = await caller.memberHelpDesk.createTicket({
      subject: "Cannot see my policy",
      description: "My policy list is empty since yesterday.",
      priority: "high",
    });
    expect(ticket).not.toBeNull();
    expect(ticket!.agentId).toBe(10); // caller's customer id — never client input
    expect(ticket!.status).toBe("open");
    expect(ticket!.sessionRef).toMatch(/^CHT-/);

    const opening = state.messages.filter(m => m.sessionId === ticket!.id);
    expect(opening).toHaveLength(1);
    expect(opening[0].content).toBe("My policy list is empty since yesterday.");
    // sender_type enum has no "customer"; the account party writes as "agent".
    expect(opening[0].senderType).toBe("agent");
    expect(opening[0].senderName).toBe("Ada Member");

    expect(state.audit).toHaveLength(1);
    expect(state.audit[0].action).toBe("member_helpdesk_ticket_created");
    expect(state.audit[0].agentId).toBe(10);
  });

  it("replyTicket appends to the caller's own open ticket", async () => {
    const caller = testRouter.createCaller(makeAuthenticatedCtx());
    const before = state.sessions.find(s => s.id === 100)!.updatedAt as Date;
    const res = await caller.memberHelpDesk.replyTicket({
      ticketId: 100,
      content: "Adding a screenshot reference.",
    });
    expect(res).toEqual({ success: true });
    const appended = state.messages.filter(m => m.sessionId === 100);
    expect(appended).toHaveLength(2);
    expect(appended[1].senderType).toBe("agent");
    const after = state.sessions.find(s => s.id === 100)!.updatedAt as Date;
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("replyTicket on another member's ticket → NOT_FOUND", async () => {
    const caller = testRouter.createCaller(makeAuthenticatedCtx());
    await expect(
      caller.memberHelpDesk.replyTicket({ ticketId: 101, content: "intrusive" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.messages.filter(m => m.sessionId === 101)).toHaveLength(0);
  });

  it("replyTicket on a resolved ticket → BAD_REQUEST", async () => {
    const caller = testRouter.createCaller(makeAuthenticatedCtx());
    await expect(
      caller.memberHelpDesk.replyTicket({ ticketId: 102, content: "reopen?" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("denies callers with no linked customer profile (fail-closed)", async () => {
    const caller = testRouter.createCaller(
      makeAuthenticatedCtx({
        user: { id: 77 } as never,
      })
    );
    await expect(caller.memberHelpDesk.myTickets()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("fails closed with INTERNAL_SERVER_ERROR when the DB is unavailable", async () => {
    getDbMock.mockResolvedValue(null);
    const caller = testRouter.createCaller(makeAuthenticatedCtx());
    await expect(caller.memberHelpDesk.myTickets()).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});
