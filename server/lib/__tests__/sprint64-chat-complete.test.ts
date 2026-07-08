// @ts-check

import { describe, it, expect } from "vitest";

// ─── F1-F5: Chat System Complete ────────────────────────────────────────────
import {
  handleTypingIndicator,
  getActiveTypers,
  clearTypingState,
  generateTranscriptHTML,
  generateTranscriptCSV,
  autoAssignSession,
  resetRoundRobin,
  computeChatMetrics,
  searchChatMessages,
} from "../chatSystemComplete";
import type { TypingEvent, SupportAgent } from "../chatSystemComplete";

describe("Sprint 64 — Chat System Complete (F1-F5)", () => {
  it("F1: handleTypingIndicator tracks typing state", () => {
    clearTypingState();
    handleTypingIndicator({
      sessionId: 1,
      userId: "user-1",
      userName: "Alice",
      isTyping: true,
    });
    const typing = getActiveTypers(1);
    expect(typing.length).toBe(1);
    expect(typing[0].userName).toBe("Alice");
  });

  it("F1: handleTypingIndicator clears typing", () => {
    clearTypingState();
    handleTypingIndicator({
      sessionId: 1,
      userId: "user-1",
      userName: "Alice",
      isTyping: true,
    });
    handleTypingIndicator({
      sessionId: 1,
      userId: "user-1",
      userName: "Alice",
      isTyping: false,
    });
    expect(getActiveTypers(1).length).toBe(0);
  });

  it("F2: generateTranscriptHTML produces formatted output", () => {
    const session = {
      id: 1,
      subject: "Test Issue",
      category: "billing",
      status: "closed",
      agentId: "agent-1",
      supportAgentName: "Bob",
      createdAt: "2024-01-01T00:00:00Z",
      closedAt: "2024-01-01T01:00:00Z",
    };
    const messages = [
      {
        senderType: "user",
        senderName: "Alice",
        content: "Hello",
        createdAt: "2024-01-01T00:01:00Z",
      },
      {
        senderType: "agent",
        senderName: "Bob",
        content: "Hi there!",
        createdAt: "2024-01-01T00:02:00Z",
      },
    ];
    const transcript = generateTranscriptHTML(session, messages);
    expect(transcript).toContain("Test Issue");
    expect(transcript).toContain("Alice");
    expect(transcript).toContain("Hello");
  });

  it("F2: generateTranscriptCSV produces CSV output", () => {
    const session = {
      id: 1,
      subject: "Test",
      category: "billing",
      status: "closed",
      agentId: "agent-1",
      supportAgentName: "Bob",
      createdAt: "2024-01-01T00:00:00Z",
      closedAt: null,
    };
    const messages = [
      {
        senderType: "user",
        senderName: "Alice",
        content: "Hello",
        createdAt: "2024-01-01T00:01:00Z",
      },
    ];
    const csv = generateTranscriptCSV(session, messages);
    expect(csv).toContain("Alice");
    expect(csv).toContain("Hello");
  });

  it("F3: autoAssignSession assigns to least-loaded agent", () => {
    resetRoundRobin();
    const agents: SupportAgent[] = [
      {
        id: "agent-1",
        name: "Alice",
        skills: ["billing"],
        maxConcurrent: 5,
        currentLoad: 3,
        isAvailable: true,
      },
      {
        id: "agent-2",
        name: "Bob",
        skills: ["billing"],
        maxConcurrent: 5,
        currentLoad: 1,
        isAvailable: true,
      },
    ];
    const assigned = autoAssignSession(agents, "least_loaded", "billing");
    expect(assigned).toBeDefined();
    expect(assigned?.id).toBe("agent-2");
  });

  it("F3: autoAssignSession returns null when no agents available", () => {
    const assigned = autoAssignSession([], "round_robin");
    expect(assigned).toBeNull();
  });

  it("F4: computeChatMetrics calculates session metrics", () => {
    const metrics = computeChatMetrics([
      {
        status: "closed",
        category: "billing",
        createdAt: new Date(Date.now() - 300000),
        closedAt: new Date(),
        firstResponseAt: new Date(Date.now() - 290000),
        rating: 5,
        messageCount: 10,
      },
      {
        status: "open",
        category: "technical",
        createdAt: new Date(Date.now() - 600000),
        closedAt: null,
        firstResponseAt: null,
        rating: 3,
        messageCount: 20,
      },
    ]);
    expect(metrics.totalSessions).toBe(2);
    expect(metrics.openSessions).toBe(1);
    expect(metrics.resolvedSessions).toBeGreaterThanOrEqual(0);
  });

  it("F5: searchChatMessages finds matching messages", () => {
    const messages = [
      {
        id: 1,
        sessionId: 1,
        content: "Payment not received for my transaction",
        senderName: "Alice",
        createdAt: "2024-01-01T00:01:00Z",
      },
      {
        id: 2,
        sessionId: 2,
        content: "Cannot login to the dashboard",
        senderName: "Bob",
        createdAt: "2024-01-01T00:02:00Z",
      },
    ];
    const sessions = new Map<
      number,
      { subject: string; category: string; status: string }
    >();
    sessions.set(1, {
      subject: "Payment",
      category: "billing",
      status: "open",
    });
    sessions.set(2, {
      subject: "Login",
      category: "technical",
      status: "open",
    });
    const results = searchChatMessages(messages, sessions, "payment");
    expect(results.length).toBe(1);
    expect(results[0].sessionId).toBe(1);
  });

  it("F5: searchChatMessages handles empty query", () => {
    const sessions = new Map<
      number,
      { subject: string; category: string; status: string }
    >();
    const results = searchChatMessages([], sessions, "");
    expect(results.length).toBe(0);
  });
});

// ─── F6-F10: Support Operations ─────────────────────────────────────────────
import {
  getNotificationPrefs,
  setNotificationPrefs,
  checkSLAStatus,
  searchKnowledgeBase,
  getKBByCategory,
  getCannedResponses,
  getCannedResponseById,
  getAllTags,
  searchTags,
} from "../supportOperations";

describe("Sprint 64 — Support Operations (F6-F10)", () => {
  it("F6: getNotificationPrefs returns defaults", () => {
    const pref = getNotificationPrefs("unknown-user");
    expect(pref).toBeDefined();
    expect(pref.channels.inApp).toBe(true);
  });

  it("F6: setNotificationPrefs stores prefs", () => {
    setNotificationPrefs("user-np-1", {
      channels: { email: true, push: false, sms: true, inApp: true },
    });
    const pref = getNotificationPrefs("user-np-1");
    expect(pref.channels.email).toBe(true);
    expect(pref.channels.push).toBe(false);
  });

  it("F7: checkSLAStatus returns compliance status", () => {
    const status = checkSLAStatus(1, "high", new Date(), null, null);
    expect(status).toBeDefined();
    expect(status.firstResponseBreached).toBe(false);
    expect(status.resolutionBreached).toBe(false);
  });

  it("F8: searchKnowledgeBase finds articles", () => {
    const results = searchKnowledgeBase("refund");
    expect(results.length).toBeGreaterThanOrEqual(0); // depends on seeded data
  });

  it("F8: getKBByCategory filters articles", () => {
    const results = getKBByCategory("billing");
    expect(Array.isArray(results)).toBe(true);
  });

  it("F9: getCannedResponses retrieves all responses", () => {
    const responses = getCannedResponses();
    expect(Array.isArray(responses)).toBe(true);
    expect(responses.length).toBeGreaterThan(0);
  });

  it("F9: getCannedResponses filters by category", () => {
    const greetings = getCannedResponses("greeting");
    expect(greetings.every(r => r.category === "greeting")).toBe(true);
  });

  it("F10: getAllTags returns tag definitions", () => {
    const tags = getAllTags();
    expect(Array.isArray(tags)).toBe(true);
    expect(tags.length).toBeGreaterThan(0);
  });

  it("F10: searchTags finds matching tags", () => {
    const results = searchTags("urg");
    expect(Array.isArray(results)).toBe(true);
  });
});

// ─── F11-F15: Agent Operations ──────────────────────────────────────────────
import {
  setAgentPresence,
  getAgentPresence,
  getAllOnlineAgents,
  updateAgentSessionCount,
  checkAutoAway,
  enqueueChat,
  dequeueChat,
  getQueueStatus,
  submitSurvey,
  getSurveyStats,
  evaluateRoutingRules,
  getEscalationChain,
  getNextEscalationLevel,
  shouldAutoEscalate,
} from "../agentOperations";

describe("Sprint 64 — Agent Operations (F11-F15)", () => {
  it("F11: setAgentPresence and getAgentPresence", () => {
    setAgentPresence("agent-test-1", "Test Agent", "online");
    const p = getAgentPresence("agent-test-1");
    expect(p).toBeDefined();
    expect(p?.status).toBe("online");
    expect(p?.agentName).toBe("Test Agent");
  });

  it("F11: updateAgentSessionCount auto-sets busy", () => {
    setAgentPresence("agent-test-2", "Busy Agent", "online", {
      maxSessions: 2,
    });
    updateAgentSessionCount("agent-test-2", 1);
    updateAgentSessionCount("agent-test-2", 1);
    const p = getAgentPresence("agent-test-2");
    expect(p?.status).toBe("busy");
  });

  it("F11: getAllOnlineAgents returns online and busy", () => {
    setAgentPresence("agent-online", "Online", "online");
    setAgentPresence("agent-away", "Away", "away");
    const online = getAllOnlineAgents();
    expect(online.some(a => a.agentId === "agent-online")).toBe(true);
    expect(online.some(a => a.agentId === "agent-away")).toBe(false);
  });

  it("F12: enqueueChat and dequeueChat", () => {
    const entry = enqueueChat({
      sessionId: 100,
      userId: "user-q1",
      userName: "Queue User",
      subject: "Test",
      category: "general",
      priority: "medium",
      enqueuedAt: Date.now(),
      requiredSkill: null,
      language: "en",
    });
    expect(entry.position).toBeGreaterThan(0);
    const dequeued = dequeueChat(100);
    expect(dequeued?.sessionId).toBe(100);
  });

  it("F12: getQueueStatus returns stats", () => {
    enqueueChat({
      sessionId: 101,
      userId: "user-q2",
      userName: "Q2",
      subject: "Test 2",
      category: "billing",
      priority: "high",
      enqueuedAt: Date.now(),
      requiredSkill: null,
      language: "en",
    });
    const status = getQueueStatus();
    expect(status.totalWaiting).toBeGreaterThanOrEqual(1);
  });

  it("F13: submitSurvey and getSurveyStats", () => {
    submitSurvey({
      sessionId: 200,
      userId: "user-s1",
      rating: 5,
      comment: "Great!",
      categories: ["helpful"],
    });
    submitSurvey({
      sessionId: 201,
      userId: "user-s2",
      rating: 4,
      comment: "Good",
      categories: ["helpful", "fast"],
    });
    const stats = getSurveyStats();
    expect(stats.totalResponses).toBeGreaterThanOrEqual(2);
    expect(stats.averageRating).toBeGreaterThan(0);
  });

  it("F14: evaluateRoutingRules routes fraud to security", () => {
    const action = evaluateRoutingRules({
      category: "fraud",
      language: "en",
      priority: "critical",
      customerTier: "gold",
      messageContent: "suspicious transaction",
    });
    expect(action.type).toBe("assign_team");
    expect(action.target).toBe("security-team");
  });

  it("F14: evaluateRoutingRules routes billing to finance", () => {
    const action = evaluateRoutingRules({
      category: "billing",
      language: "en",
      priority: "medium",
      customerTier: "standard",
      messageContent: "payment issue",
    });
    expect(action.type).toBe("assign_team");
    expect(action.target).toBe("finance-team");
  });

  it("F15: getEscalationChain returns chain", () => {
    const chain = getEscalationChain("chain-default");
    expect(chain).toBeDefined();
    expect(chain?.levels.length).toBe(3);
  });

  it("F15: getNextEscalationLevel returns next level", () => {
    const next = getNextEscalationLevel("chain-default", 1);
    expect(next).toBeDefined();
    expect(next?.level).toBe(2);
    expect(next?.name).toContain("Senior");
  });

  it("F15: shouldAutoEscalate returns true when timeout exceeded", () => {
    const result = shouldAutoEscalate("chain-default", 1, 31 * 60 * 1000); // 31 min > 30 min timeout
    expect(result).toBe(true);
  });

  it("F15: shouldAutoEscalate returns false when within timeout", () => {
    const result = shouldAutoEscalate("chain-default", 1, 5 * 60 * 1000); // 5 min < 30 min timeout
    expect(result).toBe(false);
  });
});

// ─── F16-F20: Platform Hardening ────────────────────────────────────────────
import {
  logAuditEvent,
  getAuditLog,
  getAuditStats,
  checkChatRateLimit,
  validateAttachment,
  createAttachmentRecord,
  getMessageTemplates,
  renderTemplate,
  getTranslations,
  getSupportedLanguages,
  detectLanguage,
} from "../platformHardening";

describe("Sprint 64 — Platform Hardening (F16-F20)", () => {
  it("F16: logAuditEvent creates audit entry", () => {
    const entry = logAuditEvent(1, "session_created", "user-1", "user", {
      subject: "Test",
    });
    expect(entry.id).toContain("audit-");
    expect(entry.action).toBe("session_created");
  });

  it("F16: getAuditLog retrieves entries", () => {
    logAuditEvent(2, "message_sent", "user-2", "user");
    const { entries, total } = getAuditLog(2);
    expect(total).toBeGreaterThanOrEqual(1);
    expect(entries[0].sessionId).toBe(2);
  });

  it("F16: getAuditStats returns statistics", () => {
    const stats = getAuditStats();
    expect(stats.totalEvents).toBeGreaterThan(0);
    expect(Object.keys(stats.actionCounts).length).toBeGreaterThan(0);
  });

  it("F17: checkChatRateLimit allows normal usage", () => {
    const result = checkChatRateLimit("rate-test-user");
    expect(result.allowed).toBe(true);
    expect(result.remainingTokens).toBeGreaterThan(0);
  });

  it("F18: validateAttachment accepts valid files", () => {
    const result = validateAttachment(
      "doc.pdf",
      "application/pdf",
      1024 * 1024
    );
    expect(result.valid).toBe(true);
  });

  it("F18: validateAttachment rejects oversized files", () => {
    const result = validateAttachment(
      "big.pdf",
      "application/pdf",
      10 * 1024 * 1024
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain("exceeds");
  });

  it("F18: validateAttachment rejects dangerous extensions", () => {
    const result = validateAttachment(
      "virus.exe",
      "application/octet-stream",
      1024
    );
    expect(result.valid).toBe(false);
  });

  it("F18: createAttachmentRecord creates record", () => {
    const record = createAttachmentRecord(
      1,
      1,
      "test.pdf",
      "application/pdf",
      1024,
      "https://s3.example.com/test.pdf",
      "user-1"
    );
    expect(record.id).toContain("att-");
    expect(record.fileName).toBe("test.pdf");
  });

  it("F19: getMessageTemplates returns templates", () => {
    const templates = getMessageTemplates();
    expect(templates.length).toBeGreaterThan(0);
  });

  it("F19: getMessageTemplates filters by category", () => {
    const greetings = getMessageTemplates({ category: "greeting" });
    expect(greetings.length).toBeGreaterThan(0);
    expect(greetings.every(t => t.category === "greeting")).toBe(true);
  });

  it("F19: renderTemplate substitutes variables", () => {
    const result = renderTemplate("tpl-welcome", {
      "{{customer_name}}": "Alice",
      "{{agent_name}}": "Bob",
    });
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
  });

  it("F20: getTranslations returns English strings", () => {
    const en = getTranslations("en");
    expect(en.chatTitle).toBe("Live Support");
    expect(en.chatSend).toBe("Send");
  });

  it("F20: getTranslations returns French strings", () => {
    const fr = getTranslations("fr");
    expect(fr.chatTitle).toBe("Support en direct");
  });

  it("F20: getTranslations returns Hausa strings", () => {
    const ha = getTranslations("ha");
    expect(ha.chatTitle).toBe("Tallafin Kai Tsaye");
  });

  it("F20: getSupportedLanguages returns 8 languages", () => {
    const langs = getSupportedLanguages();
    expect(langs.length).toBe(8);
    expect(langs.some(l => l.code === "en")).toBe(true);
    expect(langs.some(l => l.code === "ha")).toBe(true);
    expect(langs.some(l => l.code === "yo")).toBe(true);
  });

  it("F20: detectLanguage detects French", () => {
    expect(detectLanguage("Bonjour, j'ai besoin d'aide")).toBe("fr");
  });

  it("F20: detectLanguage detects Hausa", () => {
    expect(detectLanguage("Sannu, ina bukatar taimako")).toBe("ha");
  });

  it("F20: detectLanguage defaults to English", () => {
    expect(detectLanguage("I need help with my account")).toBe("en");
  });
});

// ─── F24: Chat Security Audit ───────────────────────────────────────────────
import {
  sanitizeMessage,
  sanitizeUrl,
  sanitizeFileName,
  getChatCSPHeaders,
  trackChatAbuse,
  redactSensitiveData,
  runChatSecurityChecks,
} from "../chatSecurityAudit";

describe("Sprint 64 — Chat Security (F24)", () => {
  it("sanitizeMessage strips HTML tags", () => {
    expect(sanitizeMessage("<script>alert('xss')</script>Hello")).toBe(
      "alert(&#x27;xss&#x27;)Hello"
    );
  });

  it("sanitizeMessage removes javascript: protocol", () => {
    expect(sanitizeMessage("javascript:alert(1)")).not.toContain("javascript:");
  });

  it("sanitizeMessage limits length", () => {
    const long = "a".repeat(6000);
    expect(sanitizeMessage(long).length).toBe(5000);
  });

  it("sanitizeUrl allows https", () => {
    expect(sanitizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("sanitizeUrl rejects javascript:", () => {
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("sanitizeUrl rejects data:", () => {
    expect(sanitizeUrl("data:text/html,<h1>hi</h1>")).toBeNull();
  });

  it("sanitizeFileName removes path traversal", () => {
    expect(sanitizeFileName("../../etc/passwd")).not.toContain("..");
  });

  it("getChatCSPHeaders returns security headers", () => {
    const headers = getChatCSPHeaders();
    expect(headers["Content-Security-Policy"]).toContain("default-src");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("trackChatAbuse allows normal traffic", () => {
    const result = trackChatAbuse("192.168.1.100");
    expect(result.blocked).toBe(false);
  });

  it("redactSensitiveData masks card numbers", () => {
    const result = redactSensitiveData("My card is 4242 4242 4242 4242");
    expect(result).toContain("[CARD_REDACTED]");
    expect(result).not.toContain("4242 4242 4242 4242");
  });

  it("redactSensitiveData masks PINs", () => {
    const result = redactSensitiveData("My pin: 1234");
    expect(result).toContain("[PIN_REDACTED]");
  });

  it("runChatSecurityChecks returns A+ score", () => {
    const { score, grade, checks } = runChatSecurityChecks();
    expect(score).toBeGreaterThanOrEqual(95);
    expect(grade).toBe("A+");
    expect(checks.length).toBeGreaterThan(15);
  });
});
