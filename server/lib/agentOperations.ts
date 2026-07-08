// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 64 — Agent Operations Module
 * F11: Agent availability/presence tracking
 * F12: Chat queue management with priority and wait time
 * F13: Post-chat satisfaction survey
 * F14: Chat routing rules engine
 * F15: Escalation chain configuration
 */

// ─── F11: Agent Availability / Presence ─────────────────────────────────────
export type PresenceStatus = "online" | "away" | "busy" | "offline";

export interface AgentPresence {
  agentId: string;
  agentName: string;
  status: PresenceStatus;
  lastSeen: number; // epoch ms
  activeSessions: number;
  maxSessions: number;
  statusMessage: string;
  autoAwayTimeoutMs: number;
}

const presenceStore = new Map<string, AgentPresence>();

export function setAgentPresence(
  agentId: string,
  agentName: string,
  status: PresenceStatus,
  opts?: { statusMessage?: string; maxSessions?: number }
): AgentPresence {
  const existing = presenceStore.get(agentId);
  const presence: AgentPresence = {
    agentId,
    agentName,
    status,
    lastSeen: Date.now(),
    activeSessions: existing?.activeSessions ?? 0,
    maxSessions: opts?.maxSessions ?? existing?.maxSessions ?? 5,
    statusMessage: opts?.statusMessage ?? existing?.statusMessage ?? "",
    autoAwayTimeoutMs: 10 * 60 * 1000, // 10 min
  };
  presenceStore.set(agentId, presence);
  return presence;
}

export function getAgentPresence(agentId: string): AgentPresence | undefined {
  return presenceStore.get(agentId);
}

export function getAllOnlineAgents(): AgentPresence[] {
  return Array.from(presenceStore.values()).filter(
    a => a.status === "online" || a.status === "busy"
  );
}

export function getAllAgentPresences(): AgentPresence[] {
  return Array.from(presenceStore.values());
}

export function updateAgentSessionCount(agentId: string, delta: number): void {
  const p = presenceStore.get(agentId);
  if (p) {
    p.activeSessions = Math.max(0, p.activeSessions + delta);
    if (p.activeSessions >= p.maxSessions && p.status === "online") {
      p.status = "busy";
    } else if (p.activeSessions < p.maxSessions && p.status === "busy") {
      p.status = "online";
    }
  }
}

export function heartbeat(agentId: string): void {
  const p = presenceStore.get(agentId);
  if (p) p.lastSeen = Date.now();
}

export function checkAutoAway(): string[] {
  const now = Date.now();
  const awayAgents: string[] = [];
  for (const [id, p] of presenceStore.entries()) {
    if (p.status === "online" && now - p.lastSeen > p.autoAwayTimeoutMs) {
      p.status = "away";
      awayAgents.push(id);
    }
  }
  return awayAgents;
}

// ─── F12: Chat Queue Management ─────────────────────────────────────────────
export type QueuePriority = "critical" | "high" | "medium" | "low";

export interface QueueEntry {
  sessionId: number;
  userId: string;
  userName: string;
  subject: string;
  category: string;
  priority: QueuePriority;
  enqueuedAt: number;
  estimatedWaitMs: number;
  position: number;
  requiredSkill: string | null;
  language: string;
}

const chatQueue: QueueEntry[] = [];
const PRIORITY_ORDER: Record<QueuePriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function enqueueChat(
  entry: Omit<QueueEntry, "position" | "estimatedWaitMs">
): QueueEntry {
  const queueEntry: QueueEntry = {
    ...entry,
    position: 0,
    estimatedWaitMs: 0,
  };
  chatQueue.push(queueEntry);
  recomputeQueuePositions();
  return queueEntry;
}

export function dequeueChat(sessionId: number): QueueEntry | undefined {
  const idx = chatQueue.findIndex(e => e.sessionId === sessionId);
  if (idx === -1) return undefined;
  const [entry] = chatQueue.splice(idx, 1);
  recomputeQueuePositions();
  return entry;
}

export function getQueueStatus(): {
  entries: QueueEntry[];
  totalWaiting: number;
  avgWaitMs: number;
  longestWaitMs: number;
} {
  const now = Date.now();
  const waits = chatQueue.map(e => now - e.enqueuedAt);
  return {
    entries: [...chatQueue],
    totalWaiting: chatQueue.length,
    avgWaitMs:
      waits.length > 0 ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
    longestWaitMs: waits.length > 0 ? Math.max(...waits) : 0,
  };
}

export function peekNextInQueue(): QueueEntry | undefined {
  return chatQueue[0];
}

function recomputeQueuePositions(): void {
  chatQueue.sort((a, b) => {
    const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (pDiff !== 0) return pDiff;
    return a.enqueuedAt - b.enqueuedAt;
  });
  const avgServiceTimeMs = 8 * 60 * 1000; // 8 min average
  chatQueue.forEach((entry, i) => {
    entry.position = i + 1;
    entry.estimatedWaitMs = (i + 1) * avgServiceTimeMs;
  });
}

export function getQueueLength(): number {
  return chatQueue.length;
}

// ─── F13: Post-Chat Satisfaction Survey ─────────────────────────────────────
export interface SurveyResponse {
  sessionId: number;
  userId: string;
  rating: number; // 1-5
  comment: string;
  categories: string[]; // e.g., ["helpful", "fast", "knowledgeable"]
  submittedAt: number;
}

const surveyStore: SurveyResponse[] = [];

export function submitSurvey(
  response: Omit<SurveyResponse, "submittedAt">
): SurveyResponse {
  const survey: SurveyResponse = {
    ...response,
    rating: Math.max(1, Math.min(5, Math.round(response.rating))),
    submittedAt: Date.now(),
  };
  surveyStore.push(survey);
  return survey;
}

export function getSurveyStats(): {
  totalResponses: number;
  averageRating: number;
  ratingDistribution: Record<number, number>;
  topFeedbackCategories: Array<{ category: string; count: number }>;
  npsScore: number;
} {
  const total = surveyStore.length;
  if (total === 0) {
    return {
      totalResponses: 0,
      averageRating: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      topFeedbackCategories: [],
      npsScore: 0,
    };
  }

  const avg = surveyStore.reduce((s, r) => s + r.rating, 0) / total;
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  surveyStore.forEach(r => dist[r.rating]++);

  const catMap = new Map<string, number>();
  surveyStore.forEach(r =>
    r.categories.forEach(c => catMap.set(c, (catMap.get(c) || 0) + 1))
  );
  const topCats = Array.from(catMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // NPS: promoters (4-5) minus detractors (1-2) as percentage
  const promoters = surveyStore.filter(r => r.rating >= 4).length;
  const detractors = surveyStore.filter(r => r.rating <= 2).length;
  const nps = Math.round(((promoters - detractors) / total) * 100);

  return {
    totalResponses: total,
    averageRating: Math.round(avg * 100) / 100,
    ratingDistribution: dist,
    topFeedbackCategories: topCats,
    npsScore: nps,
  };
}

export function getSurveyForSession(
  sessionId: number
): SurveyResponse | undefined {
  return surveyStore.find(s => s.sessionId === sessionId);
}

// ─── F14: Chat Routing Rules Engine ─────────────────────────────────────────
export interface RoutingRule {
  id: string;
  name: string;
  priority: number; // lower = higher priority
  conditions: RoutingCondition[];
  action: RoutingAction;
  enabled: boolean;
}

export interface RoutingCondition {
  field: "category" | "language" | "priority" | "customer_tier" | "keyword";
  operator: "equals" | "contains" | "in" | "not_in";
  value: string | string[];
}

export interface RoutingAction {
  type:
    | "assign_agent"
    | "assign_team"
    | "assign_skill"
    | "enqueue"
    | "auto_respond";
  target: string;
  fallback?: string;
}

const routingRules: RoutingRule[] = [
  {
    id: "rule-fraud",
    name: "Fraud → Security Team",
    priority: 1,
    conditions: [{ field: "category", operator: "equals", value: "fraud" }],
    action: {
      type: "assign_team",
      target: "security-team",
      fallback: "general-queue",
    },
    enabled: true,
  },
  {
    id: "rule-vip",
    name: "VIP → Senior Agents",
    priority: 2,
    conditions: [
      { field: "customer_tier", operator: "in", value: ["platinum", "gold"] },
    ],
    action: {
      type: "assign_skill",
      target: "senior-support",
      fallback: "general-queue",
    },
    enabled: true,
  },
  {
    id: "rule-billing",
    name: "Billing → Finance Team",
    priority: 3,
    conditions: [{ field: "category", operator: "equals", value: "billing" }],
    action: { type: "assign_team", target: "finance-team" },
    enabled: true,
  },
  {
    id: "rule-technical",
    name: "Technical → Tech Support",
    priority: 4,
    conditions: [
      {
        field: "category",
        operator: "in",
        value: ["technical", "bug", "error"],
      },
    ],
    action: { type: "assign_skill", target: "technical-support" },
    enabled: true,
  },
  {
    id: "rule-default",
    name: "Default → General Queue",
    priority: 99,
    conditions: [],
    action: { type: "enqueue", target: "general-queue" },
    enabled: true,
  },
];

export function evaluateRoutingRules(context: {
  category: string;
  language: string;
  priority: string;
  customerTier: string;
  messageContent: string;
}): RoutingAction {
  const sorted = routingRules
    .filter(r => r.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (rule.conditions.length === 0 && rule.priority === 99) {
      return rule.action; // default fallback
    }
    const allMatch = rule.conditions.every(cond => {
      const fieldValue = getFieldValue(context, cond.field);
      return evaluateCondition(fieldValue, cond.operator, cond.value);
    });
    if (allMatch) return rule.action;
  }

  return { type: "enqueue", target: "general-queue" };
}

function getFieldValue(context: Record<string, string>, field: string): string {
  const map: Record<string, string> = {
    category: context.category,
    language: context.language,
    priority: context.priority,
    customer_tier: context.customerTier,
    keyword: context.messageContent,
  };
  return (map[field] || "").toLowerCase();
}

function evaluateCondition(
  fieldValue: string,
  operator: string,
  value: string | string[]
): boolean {
  switch (operator) {
    case "equals":
      return fieldValue === (value as string).toLowerCase();
    case "contains":
      return fieldValue.includes((value as string).toLowerCase());
    case "in":
      return (value as string[]).map(v => v.toLowerCase()).includes(fieldValue);
    case "not_in":
      return !(value as string[])
        .map(v => v.toLowerCase())
        .includes(fieldValue);
    default:
      return false;
  }
}

export function getRoutingRules(): RoutingRule[] {
  return [...routingRules];
}

// ─── F15: Escalation Chain Configuration ────────────────────────────────────
export interface EscalationLevel {
  level: number; // L1, L2, L3
  name: string;
  team: string;
  timeoutMs: number; // time before auto-escalation to next level
  notifyChannels: string[];
  autoEscalate: boolean;
}

export interface EscalationChain {
  id: string;
  name: string;
  levels: EscalationLevel[];
}

const escalationChains: EscalationChain[] = [
  {
    id: "chain-default",
    name: "Default Escalation Chain",
    levels: [
      {
        level: 1,
        name: "L1 — Frontline Support",
        team: "frontline",
        timeoutMs: 30 * 60 * 1000, // 30 min
        notifyChannels: ["inApp"],
        autoEscalate: true,
      },
      {
        level: 2,
        name: "L2 — Senior Support",
        team: "senior-support",
        timeoutMs: 60 * 60 * 1000, // 1 hour
        notifyChannels: ["inApp", "email"],
        autoEscalate: true,
      },
      {
        level: 3,
        name: "L3 — Engineering / Management",
        team: "engineering",
        timeoutMs: 4 * 60 * 60 * 1000, // 4 hours
        notifyChannels: ["inApp", "email", "sms"],
        autoEscalate: false,
      },
    ],
  },
  {
    id: "chain-critical",
    name: "Critical Issue Chain",
    levels: [
      {
        level: 1,
        name: "L1 — Senior Support",
        team: "senior-support",
        timeoutMs: 10 * 60 * 1000, // 10 min
        notifyChannels: ["inApp", "push"],
        autoEscalate: true,
      },
      {
        level: 2,
        name: "L2 — Engineering",
        team: "engineering",
        timeoutMs: 30 * 60 * 1000, // 30 min
        notifyChannels: ["inApp", "email", "sms"],
        autoEscalate: true,
      },
      {
        level: 3,
        name: "L3 — CTO / VP",
        team: "executive",
        timeoutMs: 60 * 60 * 1000, // 1 hour
        notifyChannels: ["inApp", "email", "sms", "phone"],
        autoEscalate: false,
      },
    ],
  },
  {
    id: "chain-fraud",
    name: "Fraud Escalation Chain",
    levels: [
      {
        level: 1,
        name: "L1 — Security Team",
        team: "security-team",
        timeoutMs: 5 * 60 * 1000, // 5 min
        notifyChannels: ["inApp", "push", "sms"],
        autoEscalate: true,
      },
      {
        level: 2,
        name: "L2 — Fraud Investigators",
        team: "fraud-investigation",
        timeoutMs: 15 * 60 * 1000, // 15 min
        notifyChannels: ["inApp", "email", "sms"],
        autoEscalate: true,
      },
      {
        level: 3,
        name: "L3 — Compliance Officer",
        team: "compliance",
        timeoutMs: 60 * 60 * 1000, // 1 hour
        notifyChannels: ["inApp", "email", "sms", "phone"],
        autoEscalate: false,
      },
    ],
  },
];

export function getEscalationChain(
  chainId: string
): EscalationChain | undefined {
  return escalationChains.find(c => c.id === chainId);
}

export function getAllEscalationChains(): EscalationChain[] {
  return [...escalationChains];
}

export function getNextEscalationLevel(
  chainId: string,
  currentLevel: number
): EscalationLevel | null {
  const chain = getEscalationChain(chainId);
  if (!chain) return null;
  const next = chain.levels.find(l => l.level === currentLevel + 1);
  return next || null;
}

export function shouldAutoEscalate(
  chainId: string,
  currentLevel: number,
  elapsedMs: number
): boolean {
  const chain = getEscalationChain(chainId);
  if (!chain) return false;
  const level = chain.levels.find(l => l.level === currentLevel);
  if (!level) return false;
  return level.autoEscalate && elapsedMs > level.timeoutMs;
}
