// B13 (zero-undelivered-scope wave 2c): REAL compliance chatbot backend.
// Conversations persist to chat_sessions / chat_messages (migration 0059):
// the user message is inserted BEFORE the Ollama call and the assistant
// reply only AFTER Ollama actually produced one, so a transcript never
// contains a fabricated answer. All LLM output comes from a real Ollama
// endpoint (server/lib/ollamaClient.ts); when Ollama is unreachable every
// generation path fails loud with PRECONDITION_FAILED 'ollama_unavailable'
// naming the probed host — never a canned compliance answer.
// searchKnowledgeBase has no real knowledge-base store and fails loud.
import { TRPCError } from "@trpc/server";
import { randomUUID } from "crypto";
import { asc, desc, eq, count, sql } from "drizzle-orm";
import { z } from "zod";

import { chatMessages, chatSessions } from "../../drizzle/schema.additions";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { ollamaChat, ollamaStatus, type OllamaChatMessage } from "../lib/ollamaClient";

const COMPLIANCE_SYSTEM_PROMPT = [
  "You are a compliance assistant for a Nigerian insurance and agent-banking",
  "platform. Answer questions about NAICOM regulations, CBN agent-banking",
  "rules, KYC tiers, AML obligations, NDPR data protection, and IFRS 17.",
  "Answer concisely and cite the regulation family you rely on. If you do",
  "not know, say so explicitly — never invent regulatory requirements.",
].join(" ");

const CHECK_TYPES = [
  "kyc",
  "aml",
  "transaction_limit",
  "agent_onboarding",
  "reporting",
] as const;

const NO_DB = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "chatbot_database_unavailable: no database connection",
  });

async function requireSession(database: NonNullable<Awaited<ReturnType<typeof getDb>>>, sessionKey: string) {
  const [session] = await database
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.sessionKey, sessionKey))
    .limit(1);
  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `chat_session_not_found: no chat_sessions row with session_key '${sessionKey}'`,
    });
  }
  return session;
}

/** Parse a JSON object out of a model reply; fail loud when it isn't there. */
function parseModelJson(raw: string, task: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `ollama_unparseable: ${task} reply contained no JSON object — no answer is reported rather than a guessed one`,
    });
  }
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `ollama_unparseable: ${task} reply JSON was malformed — no answer is reported rather than a guessed one`,
    });
  }
}

export const complianceChatbotRouter = router({
  status: protectedProcedure.query(() => ollamaStatus()),

  startSession: protectedProcedure
    .input(z.object({ title: z.string().max(256).optional() }).optional())
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw NO_DB();
      const sessionKey = randomUUID();
      const [row] = await database
        .insert(chatSessions)
        .values({
          sessionKey,
          userId: ctx.user?.id ?? null,
          title: input?.title ?? null,
          purpose: "compliance",
        })
        .returning();
      return { sessionId: row.sessionKey, id: row.id, createdAt: row.createdAt };
    }),

  sendMessage: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1).max(64),
        message: z.string().min(1).max(8192),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw NO_DB();
      const session = await requireSession(database, input.sessionId);

      // Persist the real user message first (survives even if Ollama is down).
      await database.insert(chatMessages).values({
        sessionId: session.id,
        role: "user",
        content: input.message,
      });

      // Real conversation context from the persisted transcript.
      const history = await database
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, session.id))
        .orderBy(asc(chatMessages.id))
        .limit(40);
      const ollamaMessages: OllamaChatMessage[] = [
        { role: "system", content: COMPLIANCE_SYSTEM_PROMPT },
        ...history.map(m => ({
          role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: m.content,
        })),
      ];

      // Fails loud (PRECONDITION_FAILED 'ollama_unavailable …') when the
      // endpoint is unreachable — the transcript then honestly contains only
      // the user message.
      const reply = await ollamaChat(ollamaMessages);

      const [assistantRow] = await database
        .insert(chatMessages)
        .values({
          sessionId: session.id,
          role: "assistant",
          content: reply.content,
          model: reply.model,
        })
        .returning();
      await database
        .update(chatSessions)
        .set({ lastActivityAt: new Date() })
        .where(eq(chatSessions.id, session.id));

      return {
        sessionId: session.sessionKey,
        message: {
          id: assistantRow.id,
          role: "assistant" as const,
          content: reply.content,
          model: reply.model,
          durationMs: reply.durationMs,
          createdAt: assistantRow.createdAt,
        },
      };
    }),

  getHistory: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1).max(64) }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) throw NO_DB();
      const session = await requireSession(database, input.sessionId);
      const rows = await database
        .select()
        .from(chatMessages)
        .where(eq(chatMessages.sessionId, session.id))
        .orderBy(asc(chatMessages.id));
      return {
        sessionId: session.sessionKey,
        messages: rows.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          model: m.model,
          createdAt: m.createdAt,
        })),
      };
    }),

  listSessions: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(20),
          offset: z.number().min(0).default(0),
        })
        .optional()
    )
    .query(async ({ input, ctx }) => {
      const database = await getDb();
      if (!database) throw NO_DB();
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      // Callers see their own sessions; admins see all.
      const scope =
        ctx.user?.role === "admin"
          ? undefined
          : eq(chatSessions.userId, ctx.user?.id ?? -1);
      const rows = await database
        .select({
          id: chatSessions.id,
          sessionKey: chatSessions.sessionKey,
          title: chatSessions.title,
          createdAt: chatSessions.createdAt,
          lastActivityAt: chatSessions.lastActivityAt,
          // Explicit alias: drizzle renders ${chatMessages.sessionId}
          // unqualified inside raw sql, which PG rejects (42703) in a
          // correlated subquery — qualify via the cm alias.
          messageCount: sql<string>`(SELECT COUNT(*) FROM "chat_messages" cm WHERE cm."session_id" = "chat_sessions"."id")`,
          preview: sql<string | null>`(SELECT cm."content" FROM "chat_messages" cm WHERE cm."session_id" = "chat_sessions"."id" ORDER BY cm."id" ASC LIMIT 1)`,
        })
        .from(chatSessions)
        .where(scope)
        .orderBy(desc(chatSessions.lastActivityAt))
        .limit(limit)
        .offset(offset);
      const [{ total }] = await database
        .select({ total: count() })
        .from(chatSessions)
        .where(scope);
      return {
        sessions: rows.map(r => ({
          id: r.sessionKey,
          title: r.title,
          preview: r.preview ? r.preview.slice(0, 120) : null,
          messageCount: Number(r.messageCount),
          createdAt: r.createdAt,
          lastActivity: r.lastActivityAt,
        })),
        total: Number(total ?? 0),
      };
    }),

  // Real Ollama classification into a fixed category set. No canned mapping.
  classify: protectedProcedure
    .input(z.object({ text: z.string().min(1).max(4096) }))
    .mutation(async ({ input }) => {
      const reply = await ollamaChat([
        {
          role: "system",
          content:
            "Classify the compliance query into exactly one category: kyc, aml, transaction_limit, agent_onboarding, reporting, fraud, data_protection, other. Reply with ONLY a JSON object: {\"category\":\"...\",\"confidence\":<0..1>,\"rationale\":\"...\"}.",
        },
        { role: "user", content: input.text },
      ]);
      const parsed = parseModelJson(reply.content, "classify");
      if (typeof parsed.category !== "string") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "ollama_unparseable: classify reply JSON lacked a string 'category' — no classification is reported rather than a guessed one",
        });
      }
      return {
        category: parsed.category,
        confidence:
          typeof parsed.confidence === "number" ? parsed.confidence : null,
        rationale:
          typeof parsed.rationale === "string" ? parsed.rationale : null,
        model: reply.model,
      };
    }),

  // Real Ollama explanation of a regulatory topic. No canned text.
  explain: protectedProcedure
    .input(z.object({ topic: z.string().min(1).max(512) }))
    .query(async ({ input }) => {
      const reply = await ollamaChat([
        { role: "system", content: COMPLIANCE_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Explain this compliance topic for an insurance operations team: ${input.topic}`,
        },
      ]);
      return { topic: input.topic, explanation: reply.content, model: reply.model };
    }),

  // Real Ollama-backed structured compliance check. The model is asked for a
  // strict JSON verdict; unparseable output fails loud instead of being
  // coerced into a plausible-looking verdict.
  quickComplianceCheck: protectedProcedure
    .input(
      z.object({
        checkType: z.enum(CHECK_TYPES),
        scenario: z.string().max(4096).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const reply = await ollamaChat([
        {
          role: "system",
          content:
            "You are a Nigerian insurance/agent-banking compliance checker. Given a check type and optional scenario, reply with ONLY a JSON object: {\"status\":\"compliant\"|\"review_required\"|\"non_compliant\",\"details\":\"...\",\"requirements\":[{\"name\":\"...\",\"met\":true|false}]}. Base it on real CBN/NAICOM/NDPR obligations; if uncertain, use status \"review_required\".",
        },
        {
          role: "user",
          content: `Check type: ${input.checkType}${input.scenario ? `\nScenario: ${input.scenario}` : ""}`,
        },
      ]);
      const parsed = parseModelJson(reply.content, "quickComplianceCheck");
      const requirements = Array.isArray(parsed.requirements)
        ? (parsed.requirements as Array<Record<string, unknown>>)
            .filter(r => typeof r?.name === "string")
            .map(r => ({ name: r.name as string, met: r.met === true }))
        : [];
      return {
        checkType: input.checkType,
        status:
          typeof parsed.status === "string" ? parsed.status : "review_required",
        details:
          typeof parsed.details === "string"
            ? parsed.details
            : "The model did not provide details.",
        requirements,
        model: reply.model,
      };
    }),

  // No real compliance knowledge-base store exists on this platform. Fail
  // loud — never search an unrelated table and present it as KB results.
  searchKnowledgeBase: protectedProcedure
    .input(z.object({ query: z.string().min(1).max(512) }))
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message:
          "knowledge_base_not_delivered: no compliance knowledge-base store exists — use chat/classify/explain (real Ollama) instead",
      });
    }),
});
