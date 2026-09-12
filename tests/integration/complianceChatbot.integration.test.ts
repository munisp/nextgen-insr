/**
 * complianceChatbot.integration.test.ts — B13 integration coverage for the
 * real compliance chatbot pipeline against the REAL PG (PGlite) schema.
 *
 * Covers:
 *   1. Persistence round-trip (startSession → listSessions → getHistory).
 *   2. Ollama-unavailable fail-loud (OLLAMA_URL unset AND unreachable host),
 *      asserting the user message is still persisted and NO assistant reply
 *      is fabricated.
 *   3. TRANSPORT-SEAM test (clearly labeled): mocks ONLY the global fetch
 *      HTTP boundary with a protocol-shaped Ollama /api/chat payload, then
 *      exercises the REAL pipeline above it (prompt construction, response
 *      parsing, persistence of the assistant message with its model).
 */
import { afterEach, beforeAll, afterAll, describe, it, vi } from "vitest";

import { getDb } from "../../server/db";
import {
  complianceChatMessages,
  complianceChatSessions,
} from "../../drizzle/schema.additions";
import { eq } from "drizzle-orm";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const REAL_FETCH = globalThis.fetch;
let sessionKey = "";

describe("complianceChatbot (B13) — integration", () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterEach(() => {
    // Never let a stub leak across tests.
    vi.unstubAllGlobals();
    globalThis.fetch = REAL_FETCH;
  });

  afterAll(() => {
    console.log(`[complianceChatbot] assertions: ${getAssertionCount()}`);
  });

  it("startSession persists a real chat_sessions row", async () => {
    const res = await callerFor(regularUser).complianceChatbot.startSession({
      title: "B13 integration session",
    });
    expect(res.sessionId).toBeTruthy();
    sessionKey = res.sessionId;
    const db = (await getDb())!;
    const [row] = await db
      .select()
      .from(complianceChatSessions)
      .where(eq(complianceChatSessions.sessionKey, sessionKey))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row.userId).toBe(regularUser.id);
    expect(row.purpose).toBe("compliance");
  });

  it("listSessions returns the caller's own session with real counts", async () => {
    const res = await callerFor(regularUser).complianceChatbot.listSessions();
    const found = res.sessions.find(s => s.id === sessionKey);
    expect(found).toBeTruthy();
    expect(found!.messageCount).toBe(0);
    expect(found!.preview).toBeNull();
    // Another user must not see it.
    const other = await callerFor(adminUser).complianceChatbot.listSessions();
    expect(other.sessions.some(s => s.id === sessionKey)).toBe(true); // admin sees all
    const nobody = await callerFor({
      id: 91999,
      email: "nobody@integration.local",
      name: "Nobody",
      role: "user",
    }).complianceChatbot.listSessions();
    expect(nobody.sessions.some(s => s.id === sessionKey)).toBe(false);
  });

  it("sendMessage fails loud 'ollama_unavailable' when OLLAMA_URL is unset, persisting only the user message", async () => {
    const saved = process.env.OLLAMA_URL;
    delete process.env.OLLAMA_URL;
    try {
      const err = await expectTrpcError(
        callerFor(regularUser).complianceChatbot.sendMessage({
          sessionId: sessionKey,
          message: "What are CBN agent banking limits?",
        }),
        "PRECONDITION_FAILED"
      );
      expect(err.message).toContain("ollama_unavailable");
      expect(err.message).toContain("OLLAMA_URL");
    } finally {
      if (saved !== undefined) process.env.OLLAMA_URL = saved;
    }
    // Transcript honestly contains ONLY the real user message.
    const history = await callerFor(regularUser).complianceChatbot.getHistory({
      sessionId: sessionKey,
    });
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0].role).toBe("user");
    expect(history.messages[0].content).toBe(
      "What are CBN agent banking limits?"
    );
  });

  it("sendMessage fails loud naming the probed host when Ollama is unreachable", async () => {
    const saved = process.env.OLLAMA_URL;
    process.env.OLLAMA_URL = "http://127.0.0.1:9";
    try {
      const err = await expectTrpcError(
        callerFor(regularUser).complianceChatbot.sendMessage({
          sessionId: sessionKey,
          message: "Explain NAICOM solvency requirements",
        }),
        "PRECONDITION_FAILED"
      );
      expect(err.message).toContain("ollama_unavailable");
      expect(err.message).toContain("127.0.0.1:9");
    } finally {
      if (saved !== undefined) process.env.OLLAMA_URL = saved;
      else delete process.env.OLLAMA_URL;
    }
    const history = await callerFor(regularUser).complianceChatbot.getHistory({
      sessionId: sessionKey,
    });
    // Second user message persisted; still no assistant message fabricated.
    expect(history.messages.filter(m => m.role === "assistant")).toHaveLength(0);
    expect(history.messages.filter(m => m.role === "user")).toHaveLength(2);
  });

  it("classify/explain/quickComplianceCheck fail loud without Ollama — no canned answers", async () => {
    const saved = process.env.OLLAMA_URL;
    delete process.env.OLLAMA_URL;
    try {
      await expectTrpcError(
        callerFor(regularUser).complianceChatbot.classify({ text: "kyc tier 2" }),
        "PRECONDITION_FAILED"
      );
      await expectTrpcError(
        callerFor(regularUser).complianceChatbot.explain({ topic: "IFRS 17" }),
        "PRECONDITION_FAILED"
      );
      await expectTrpcError(
        callerFor(regularUser).complianceChatbot.quickComplianceCheck({
          checkType: "kyc",
        }),
        "PRECONDITION_FAILED"
      );
    } finally {
      if (saved !== undefined) process.env.OLLAMA_URL = saved;
    }
  });

  it("searchKnowledgeBase fails loud (no KB store delivered)", async () => {
    const err = await expectTrpcError(
      callerFor(regularUser).complianceChatbot.searchKnowledgeBase({
        query: "kyc",
      }),
      "NOT_IMPLEMENTED"
    );
    expect(err.message).toContain("knowledge_base_not_delivered");
  });

  // ── TRANSPORT-SEAM TEST ──────────────────────────────────────────────────
  // Mocks ONLY the global fetch HTTP boundary (labeled seam in
  // server/lib/ollamaClient.ts). Everything above the seam — URL and prompt
  // construction, error mapping, transcript persistence — is the REAL code.
  it("TRANSPORT-SEAM: a real-shaped Ollama reply is parsed and persisted as the assistant message", async () => {
    const savedUrl = process.env.OLLAMA_URL;
    process.env.OLLAMA_URL = "http://ollama-seam.test:11434";
    const seenBodies: string[] = [];
    vi.stubGlobal("fetch", async (url: unknown, init?: { body?: unknown }) => {
      expect(String(url)).toBe(
        "http://ollama-seam.test:11434/api/chat"
      );
      seenBodies.push(String(init?.body));
      return new Response(
        JSON.stringify({
          model: "llama3.2:3b",
          message: {
            role: "assistant",
            content: "SEAM-REPLY: Tier 1 daily limit is N50,000 under CBN agent-banking rules.",
          },
          done: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });
    try {
      const res = await callerFor(regularUser).complianceChatbot.sendMessage({
        sessionId: sessionKey,
        message: "What is the tier 1 limit?",
      });
      expect(res.message.role).toBe("assistant");
      expect(res.message.content).toContain("SEAM-REPLY");
      expect(res.message.model).toBe("llama3.2:3b");
      // The real pipeline sent the compliance system prompt + full transcript.
      const sent = JSON.parse(seenBodies[0]) as {
        model: string;
        stream: boolean;
        messages: Array<{ role: string; content: string }>;
      };
      expect(sent.stream).toBe(false);
      expect(sent.messages[0].role).toBe("system");
      expect(sent.messages[0].content).toContain("NAICOM");
      expect(sent.messages.at(-1)).toEqual({
        role: "user",
        content: "What is the tier 1 limit?",
      });
      // Persisted transcript now includes the real (seam-sourced) reply.
      const db = (await getDb())!;
      const [session] = await db
        .select()
        .from(complianceChatSessions)
        .where(eq(complianceChatSessions.sessionKey, sessionKey))
        .limit(1);
      const rows = await db
        .select()
        .from(complianceChatMessages)
        .where(eq(complianceChatMessages.sessionId, session.id));
      const assistant = rows.filter(r => r.role === "assistant");
      expect(assistant).toHaveLength(1);
      expect(assistant[0].content).toContain("SEAM-REPLY");
      expect(assistant[0].model).toBe("llama3.2:3b");
    } finally {
      if (savedUrl !== undefined) process.env.OLLAMA_URL = savedUrl;
      else delete process.env.OLLAMA_URL;
    }
  });
});
