// @ts-check

// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 64 — Support Operations Module
 * F6: Chat notification preferences
 * F7: SLA monitoring with response time thresholds
 * F8: Knowledge base / FAQ system
 * F9: Canned response management
 * F10: Chat tags and labels
 */

// ─── F6: Notification Preferences ───────────────────────────────────────────
export interface NotificationPreference {
  userId: string;
  channels: {
    email: boolean;
    push: boolean;
    sms: boolean;
    inApp: boolean;
  };
  triggers: {
    newMessage: boolean;
    sessionAssigned: boolean;
    sessionEscalated: boolean;
    slaBreached: boolean;
    sessionResolved: boolean;
  };
  quietHoursStart: string | null; // "22:00"
  quietHoursEnd: string | null; // "08:00"
}

const defaultPrefs: NotificationPreference = {
  userId: "",
  channels: { email: true, push: true, sms: false, inApp: true },
  triggers: {
    newMessage: true,
    sessionAssigned: true,
    sessionEscalated: true,
    slaBreached: true,
    sessionResolved: true,
  },
  quietHoursStart: null,
  quietHoursEnd: null,
};

const prefsStore = new Map<string, NotificationPreference>();

export function getNotificationPrefs(userId: string): NotificationPreference {
  return prefsStore.get(userId) || { ...defaultPrefs, userId };
}

export function setNotificationPrefs(
  userId: string,
  prefs: Partial<NotificationPreference>
): NotificationPreference {
  const current = getNotificationPrefs(userId);
  const updated = {
    ...current,
    ...prefs,
    userId,
    channels: { ...current.channels, ...(prefs.channels || {}) },
    triggers: { ...current.triggers, ...(prefs.triggers || {}) },
  };
  prefsStore.set(userId, updated);
  return updated;
}

export function isInQuietHours(prefs: NotificationPreference): boolean {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [startH, startM] = prefs.quietHoursStart.split(":").map(Number);
  const [endH, endM] = prefs.quietHoursEnd.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Overnight quiet hours (e.g., 22:00 - 08:00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function shouldNotify(
  userId: string,
  trigger: keyof NotificationPreference["triggers"],
  channel: keyof NotificationPreference["channels"]
): boolean {
  const prefs = getNotificationPrefs(userId);
  if (isInQuietHours(prefs)) return false;
  return prefs.triggers[trigger] && prefs.channels[channel];
}

// ─── F7: SLA Monitoring ─────────────────────────────────────────────────────
export interface SLAPolicy {
  id: string;
  name: string;
  priority: "low" | "medium" | "high" | "critical";
  firstResponseTimeMs: number;
  resolutionTimeMs: number;
  escalationTimeMs: number;
  breachNotifyChannels: string[];
}

const DEFAULT_SLA_POLICIES: SLAPolicy[] = [
  {
    id: "critical",
    name: "Critical Priority",
    priority: "critical",
    firstResponseTimeMs: 5 * 60 * 1000, // 5 min
    resolutionTimeMs: 60 * 60 * 1000, // 1 hour
    escalationTimeMs: 15 * 60 * 1000, // 15 min
    breachNotifyChannels: ["email", "push", "sms"],
  },
  {
    id: "high",
    name: "High Priority",
    priority: "high",
    firstResponseTimeMs: 15 * 60 * 1000, // 15 min
    resolutionTimeMs: 4 * 60 * 60 * 1000, // 4 hours
    escalationTimeMs: 30 * 60 * 1000, // 30 min
    breachNotifyChannels: ["email", "push"],
  },
  {
    id: "medium",
    name: "Medium Priority",
    priority: "medium",
    firstResponseTimeMs: 60 * 60 * 1000, // 1 hour
    resolutionTimeMs: 24 * 60 * 60 * 1000, // 24 hours
    escalationTimeMs: 2 * 60 * 60 * 1000, // 2 hours
    breachNotifyChannels: ["email"],
  },
  {
    id: "low",
    name: "Low Priority",
    priority: "low",
    firstResponseTimeMs: 4 * 60 * 60 * 1000, // 4 hours
    resolutionTimeMs: 72 * 60 * 60 * 1000, // 72 hours
    escalationTimeMs: 8 * 60 * 60 * 1000, // 8 hours
    breachNotifyChannels: ["email"],
  },
];

export function getSLAPolicy(priority: string): SLAPolicy {
  return (
    DEFAULT_SLA_POLICIES.find(p => p.priority === priority) ||
    DEFAULT_SLA_POLICIES[2]
  );
}

export function getAllSLAPolicies(): SLAPolicy[] {
  return [...DEFAULT_SLA_POLICIES];
}

export interface SLAStatus {
  sessionId: number;
  priority: string;
  firstResponseBreached: boolean;
  resolutionBreached: boolean;
  escalationBreached: boolean;
  firstResponseRemainingMs: number;
  resolutionRemainingMs: number;
  escalationRemainingMs: number;
}

export function checkSLAStatus(
  sessionId: number,
  priority: string,
  createdAt: Date | string,
  firstResponseAt: Date | string | null,
  resolvedAt: Date | string | null
): SLAStatus {
  const policy = getSLAPolicy(priority);
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const elapsed = now - created;

  const firstResponseBreached =
    !firstResponseAt && elapsed > policy.firstResponseTimeMs;
  const resolutionBreached = !resolvedAt && elapsed > policy.resolutionTimeMs;
  const escalationBreached =
    !firstResponseAt && elapsed > policy.escalationTimeMs;

  return {
    sessionId,
    priority,
    firstResponseBreached,
    resolutionBreached,
    escalationBreached,
    firstResponseRemainingMs: firstResponseAt
      ? 0
      : Math.max(0, policy.firstResponseTimeMs - elapsed),
    resolutionRemainingMs: resolvedAt
      ? 0
      : Math.max(0, policy.resolutionTimeMs - elapsed),
    escalationRemainingMs: firstResponseAt
      ? 0
      : Math.max(0, policy.escalationTimeMs - elapsed),
  };
}

// ─── F8: Knowledge Base / FAQ ───────────────────────────────────────────────
export interface KBArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  helpfulness: number;
  viewCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const kbArticles: KBArticle[] = [
  {
    id: "kb-001",
    title: "How to process a premium collection transaction",
    content:
      "Navigate to Cash In on the POS terminal. Enter the customer phone number, amount, and confirm. The transaction will be processed and a receipt generated automatically. Float will be deducted from your agent balance.",
    category: "Transactions",
    tags: ["premium collection", "deposit", "float"],
    helpfulness: 92,
    viewCount: 1540,
    createdAt: new Date("2024-01-15"),
    updatedAt: new Date("2024-06-01"),
  },
  {
    id: "kb-002",
    title: "How to reverse a failed transaction",
    content:
      "Go to Transaction History, find the transaction by reference number, and tap 'Reverse'. Reversals must be initiated within 24 hours. The amount will be credited back to the agent float and customer account.",
    category: "Transactions",
    tags: ["reversal", "refund", "failed"],
    helpfulness: 88,
    viewCount: 980,
    createdAt: new Date("2024-01-20"),
    updatedAt: new Date("2024-05-15"),
  },
  {
    id: "kb-003",
    title: "Float top-up request process",
    content:
      "Submit a float top-up request from the Float Management screen. Your supervisor will approve or reject the request. Once approved, the float is credited immediately. You can track request status in the Float History tab.",
    category: "Float Management",
    tags: ["float", "top-up", "balance"],
    helpfulness: 95,
    viewCount: 2100,
    createdAt: new Date("2024-02-01"),
    updatedAt: new Date("2024-07-10"),
  },
  {
    id: "kb-004",
    title: "Understanding commission tiers",
    content:
      "Commission rates vary by agent tier: Bronze (1.5%), Silver (2.0%), Gold (2.5%), Platinum (3.0%). Tiers are determined by monthly transaction volume. Commission is calculated automatically on each successful transaction.",
    category: "Commission",
    tags: ["commission", "tier", "earnings"],
    helpfulness: 90,
    viewCount: 1800,
    createdAt: new Date("2024-02-15"),
    updatedAt: new Date("2024-06-20"),
  },
  {
    id: "kb-005",
    title: "KYC document requirements",
    content:
      "Required documents: Valid government ID (NIN, Passport, or Driver's License), proof of address (utility bill dated within 3 months), passport photograph. Upload documents via the KYC section in your agent profile.",
    category: "Compliance",
    tags: ["kyc", "documents", "verification"],
    helpfulness: 85,
    viewCount: 1200,
    createdAt: new Date("2024-03-01"),
    updatedAt: new Date("2024-08-01"),
  },
  {
    id: "kb-006",
    title: "Handling network errors during transactions",
    content:
      "If a transaction fails due to network error, it is automatically queued for retry when connectivity is restored. Do NOT retry manually as this may cause duplicate transactions. Check the Offline Queue for pending items.",
    category: "Troubleshooting",
    tags: ["network", "offline", "error", "retry"],
    helpfulness: 93,
    viewCount: 2500,
    createdAt: new Date("2024-03-15"),
    updatedAt: new Date("2024-09-01"),
  },
  {
    id: "kb-007",
    title: "Fraud alert response procedures",
    content:
      "When a fraud alert triggers: 1) Do NOT process the flagged transaction. 2) Verify customer identity with additional questions. 3) Report the alert via the Fraud Dashboard. 4) Contact your supervisor if the customer becomes aggressive.",
    category: "Security",
    tags: ["fraud", "alert", "security", "procedure"],
    helpfulness: 97,
    viewCount: 3200,
    createdAt: new Date("2024-04-01"),
    updatedAt: new Date("2024-10-01"),
  },
  {
    id: "kb-008",
    title: "PIN reset procedure",
    content:
      "If you forget your PIN: 1) Tap 'Forgot PIN?' on the login screen. 2) Enter your agent ID and registered phone number. 3) Enter the OTP sent via SMS. 4) Set a new 4-digit PIN. Contact support if you don't receive the OTP.",
    category: "Account",
    tags: ["pin", "reset", "login", "otp"],
    helpfulness: 91,
    viewCount: 1900,
    createdAt: new Date("2024-04-15"),
    updatedAt: new Date("2024-08-15"),
  },
];

export function searchKnowledgeBase(
  query: string,
  limit: number = 5
): KBArticle[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return kbArticles.slice(0, limit);

  return kbArticles
    .map(article => {
      const text =
        `${article.title} ${article.content} ${article.tags.join(" ")}`.toLowerCase();
      const matchCount = terms.filter(t => text.includes(t)).length;
      return { article, score: matchCount / terms.length };
    })
    .filter(r => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.article.helpfulness - a.article.helpfulness
    )
    .slice(0, limit)
    .map(r => r.article);
}

export function getKBArticleById(id: string): KBArticle | undefined {
  return kbArticles.find(a => a.id === id);
}

export function getKBCategories(): string[] {
  return [...new Set(kbArticles.map(a => a.category))];
}

export function getKBByCategory(category: string): KBArticle[] {
  return kbArticles.filter(a => a.category === category);
}

// ─── F9: Canned Response Management ─────────────────────────────────────────
export interface CannedResponse {
  id: string;
  title: string;
  content: string;
  category: string;
  variables: string[]; // e.g., ["{{agent_name}}", "{{ticket_id}}"]
  usageCount: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const cannedResponses: CannedResponse[] = [
  {
    id: "cr-001",
    title: "Greeting",
    content:
      "Hello {{customer_name}}! Thank you for contacting InsurePortal support. My name is {{agent_name}} and I'll be happy to assist you today. How can I help?",
    category: "General",
    variables: ["{{customer_name}}", "{{agent_name}}"],
    usageCount: 450,
    createdBy: "system",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "cr-002",
    title: "Transaction Investigation",
    content:
      "I'm looking into your transaction (Ref: {{transaction_ref}}). This may take a few minutes. I'll update you as soon as I have more information.",
    category: "Transactions",
    variables: ["{{transaction_ref}}"],
    usageCount: 320,
    createdBy: "system",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "cr-003",
    title: "Escalation Notice",
    content:
      "I'm escalating your case to our senior support team for further investigation. You'll receive an update within {{sla_time}}. Your case reference is #{{ticket_id}}.",
    category: "Escalation",
    variables: ["{{sla_time}}", "{{ticket_id}}"],
    usageCount: 180,
    createdBy: "system",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "cr-004",
    title: "Resolution Confirmation",
    content:
      "Great news! Your issue has been resolved. {{resolution_details}} Is there anything else I can help you with?",
    category: "Resolution",
    variables: ["{{resolution_details}}"],
    usageCount: 290,
    createdBy: "system",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "cr-005",
    title: "Float Top-Up Guidance",
    content:
      "To request a float top-up: 1) Go to Float Management, 2) Tap 'Request Top-Up', 3) Enter the amount needed, 4) Your supervisor will review and approve. Current processing time is approximately {{processing_time}}.",
    category: "Float",
    variables: ["{{processing_time}}"],
    usageCount: 210,
    createdBy: "system",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
  {
    id: "cr-006",
    title: "Closing",
    content:
      "Thank you for contacting InsurePortal support, {{customer_name}}. If you need further assistance, don't hesitate to reach out. Have a great day!",
    category: "General",
    variables: ["{{customer_name}}"],
    usageCount: 400,
    createdBy: "system",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  },
];

export function getCannedResponses(category?: string): CannedResponse[] {
  if (category) return cannedResponses.filter(r => r.category === category);
  return [...cannedResponses];
}

export function getCannedResponseById(id: string): CannedResponse | undefined {
  return cannedResponses.find(r => r.id === id);
}

export function getCannedCategories(): string[] {
  return [...new Set(cannedResponses.map(r => r.category))];
}

export function applyCannedVariables(
  content: string,
  variables: Record<string, string>
): string {
  let result = content;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(escapeRegexStr(key), "g"), value);
  }
  return result;
}

function escapeRegexStr(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── F10: Chat Tags and Labels ──────────────────────────────────────────────
export interface ChatTag {
  id: string;
  name: string;
  color: string; // hex
  description: string;
  usageCount: number;
}

const chatTags: ChatTag[] = [
  {
    id: "tag-urgent",
    name: "Urgent",
    color: "#ef4444",
    description: "Requires immediate attention",
    usageCount: 120,
  },
  {
    id: "tag-vip",
    name: "VIP Customer",
    color: "#f59e0b",
    description: "High-value customer",
    usageCount: 85,
  },
  {
    id: "tag-bug",
    name: "Bug Report",
    color: "#8b5cf6",
    description: "Technical issue reported",
    usageCount: 95,
  },
  {
    id: "tag-feature",
    name: "Feature Request",
    color: "#3b82f6",
    description: "New feature suggestion",
    usageCount: 60,
  },
  {
    id: "tag-billing",
    name: "Billing Issue",
    color: "#10b981",
    description: "Payment or billing related",
    usageCount: 110,
  },
  {
    id: "tag-fraud",
    name: "Fraud Concern",
    color: "#dc2626",
    description: "Potential fraud activity",
    usageCount: 45,
  },
  {
    id: "tag-kyc",
    name: "KYC Related",
    color: "#6366f1",
    description: "KYC verification issue",
    usageCount: 70,
  },
  {
    id: "tag-training",
    name: "Training Needed",
    color: "#14b8a6",
    description: "Agent needs additional training",
    usageCount: 30,
  },
  {
    id: "tag-followup",
    name: "Follow-Up Required",
    color: "#f97316",
    description: "Needs follow-up action",
    usageCount: 90,
  },
  {
    id: "tag-resolved",
    name: "Resolved",
    color: "#22c55e",
    description: "Issue has been resolved",
    usageCount: 200,
  },
];

export function getAllTags(): ChatTag[] {
  return [...chatTags];
}

export function getTagById(id: string): ChatTag | undefined {
  return chatTags.find(t => t.id === id);
}

export function getTagsByIds(ids: string[]): ChatTag[] {
  return chatTags.filter(t => ids.includes(t.id));
}

export function searchTags(query: string): ChatTag[] {
  const q = query.toLowerCase();
  return chatTags.filter(
    t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
  );
}
