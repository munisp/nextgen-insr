// TypeScript enabled — Sprint 96 security audit
/**
 * Sprint 64 — Platform Hardening Module
 * F16: Chat audit trail
 * F17: Chat rate limiting
 * F18: File attachment support
 * F19: Chat message templates with variable substitution
 * F20: Multi-language support (i18n)
 */

// ─── F16: Chat Audit Trail ──────────────────────────────────────────────────
export type AuditAction =
  | "session_created"
  | "session_assigned"
  | "session_escalated"
  | "session_transferred"
  | "session_resolved"
  | "session_reopened"
  | "message_sent"
  | "message_deleted"
  | "tag_added"
  | "tag_removed"
  | "priority_changed"
  | "agent_joined"
  | "agent_left"
  | "file_uploaded"
  | "survey_submitted"
  | "sla_breached"
  | "routing_applied";

export interface AuditEntry {
  id: string;
  sessionId: number;
  action: AuditAction;
  performedBy: string;
  performedByRole: "user" | "agent" | "admin" | "system";
  details: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  timestamp: number;
}

const auditLog: AuditEntry[] = [];
let auditCounter = 0;

export function logAuditEvent(
  sessionId: number,
  action: AuditAction,
  performedBy: string,
  role: AuditEntry["performedByRole"],
  details: Record<string, unknown> = {},
  ipAddress: string = "0.0.0.0",
  userAgent: string = "system"
): AuditEntry {
  auditCounter++;
  const entry: AuditEntry = {
    id: `audit-${Date.now()}-${auditCounter}`,
    sessionId,
    action,
    performedBy,
    performedByRole: role,
    details,
    ipAddress,
    userAgent,
    timestamp: Date.now(),
  };
  auditLog.push(entry);
  // Keep last 10000 entries in memory
  if (auditLog.length > 10000) auditLog.splice(0, auditLog.length - 10000);
  return entry;
}

export function getAuditLog(
  sessionId?: number,
  opts?: { limit?: number; offset?: number; action?: AuditAction }
): { entries: AuditEntry[]; total: number } {
  let filtered = auditLog;
  if (sessionId) filtered = filtered.filter(e => e.sessionId === sessionId);
  if (opts?.action) filtered = filtered.filter(e => e.action === opts.action);
  const total = filtered.length;
  const start = opts?.offset ?? 0;
  const limit = opts?.limit ?? 50;
  return {
    entries: filtered.slice(start, start + limit).reverse(),
    total,
  };
}

export function getAuditStats(): {
  totalEvents: number;
  actionCounts: Record<string, number>;
  topActors: Array<{ actor: string; count: number }>;
} {
  const actionCounts: Record<string, number> = {};
  const actorCounts = new Map<string, number>();
  for (const entry of auditLog) {
    actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
    actorCounts.set(
      entry.performedBy,
      (actorCounts.get(entry.performedBy) || 0) + 1
    );
  }
  const topActors = Array.from(actorCounts.entries())
    .map(([actor, count]) => ({ actor, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { totalEvents: auditLog.length, actionCounts, topActors };
}

// ─── F17: Chat Rate Limiting ────────────────────────────────────────────────
interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

const rateBuckets = new Map<string, RateLimitBucket>();

const CHAT_RATE_CONFIG = {
  maxMessagesPerMinute: 20,
  maxMessagesPerHour: 200,
  burstLimit: 5, // max messages in 10 seconds
  cooldownMs: 30000, // 30s cooldown after burst
};

export function checkChatRateLimit(userId: string): {
  allowed: boolean;
  remainingTokens: number;
  retryAfterMs: number;
} {
  const key = `chat:${userId}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);

  if (!bucket) {
    bucket = { tokens: CHAT_RATE_CONFIG.maxMessagesPerMinute, lastRefill: now };
    rateBuckets.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsedMs = now - bucket.lastRefill;
  const refillRate = CHAT_RATE_CONFIG.maxMessagesPerMinute / 60000; // tokens per ms
  const refillTokens = elapsedMs * refillRate;
  bucket.tokens = Math.min(
    CHAT_RATE_CONFIG.maxMessagesPerMinute,
    bucket.tokens + refillTokens
  );
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillRate);
    return { allowed: false, remainingTokens: 0, retryAfterMs };
  }

  bucket.tokens -= 1;
  return {
    allowed: true,
    remainingTokens: Math.floor(bucket.tokens),
    retryAfterMs: 0,
  };
}

export function getChatRateConfig(): typeof CHAT_RATE_CONFIG {
  return { ...CHAT_RATE_CONFIG };
}

// ─── F18: File Attachment Support ───────────────────────────────────────────
export interface ChatAttachment {
  id: string;
  sessionId: number;
  messageId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageUrl: string;
  uploadedBy: string;
  uploadedAt: number;
}

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export function validateAttachment(
  fileName: string,
  mimeType: string,
  sizeBytes: number
): { valid: boolean; error?: string } {
  if (sizeBytes > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return {
      valid: false,
      error: `File type '${mimeType}' is not allowed. Allowed: ${Array.from(ALLOWED_MIME_TYPES).join(", ")}`,
    };
  }
  // Check for dangerous file extensions
  const dangerousExts = [
    ".exe",
    ".bat",
    ".cmd",
    ".sh",
    ".ps1",
    ".vbs",
    ".js",
    ".mjs",
  ];
  const ext = fileName.toLowerCase().slice(fileName.lastIndexOf("."));
  if (dangerousExts.includes(ext)) {
    return {
      valid: false,
      error: `File extension '${ext}' is not allowed for security reasons`,
    };
  }
  return { valid: true };
}

export function createAttachmentRecord(
  sessionId: number,
  messageId: number,
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  storageUrl: string,
  uploadedBy: string
): ChatAttachment {
  return {
    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    messageId,
    fileName: sanitizeFileName(fileName),
    mimeType,
    sizeBytes,
    storageUrl,
    uploadedBy,
    uploadedAt: Date.now(),
  };
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 255);
}

export function getAttachmentConfig(): {
  maxSizeBytes: number;
  allowedMimeTypes: string[];
} {
  return {
    maxSizeBytes: MAX_FILE_SIZE,
    allowedMimeTypes: Array.from(ALLOWED_MIME_TYPES),
  };
}

// ─── F19: Chat Message Templates ────────────────────────────────────────────
export interface MessageTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  category: string;
  language: string;
  isActive: boolean;
}

const messageTemplates: MessageTemplate[] = [
  {
    id: "tpl-welcome",
    name: "Welcome Message",
    content:
      "Welcome to InsurePortal Support, {{customer_name}}! I'm {{agent_name}}, and I'll be assisting you today. How can I help?",
    variables: ["{{customer_name}}", "{{agent_name}}"],
    category: "greeting",
    language: "en",
    isActive: true,
  },
  {
    id: "tpl-hold",
    name: "Please Hold",
    content:
      "Thank you for your patience, {{customer_name}}. I'm looking into this for you. It should take approximately {{wait_time}}.",
    variables: ["{{customer_name}}", "{{wait_time}}"],
    category: "status",
    language: "en",
    isActive: true,
  },
  {
    id: "tpl-resolved",
    name: "Issue Resolved",
    content:
      "Great news! Your issue regarding {{issue_topic}} has been resolved. {{resolution_details}} Is there anything else I can help with?",
    variables: ["{{issue_topic}}", "{{resolution_details}}"],
    category: "resolution",
    language: "en",
    isActive: true,
  },
  {
    id: "tpl-escalate",
    name: "Escalation Notice",
    content:
      "I'm escalating your case to our {{team_name}} team for specialized assistance. Your reference number is #{{ticket_id}}. You'll hear back within {{sla_time}}.",
    variables: ["{{team_name}}", "{{ticket_id}}", "{{sla_time}}"],
    category: "escalation",
    language: "en",
    isActive: true,
  },
  {
    id: "tpl-closing",
    name: "Closing Message",
    content:
      "Thank you for contacting InsurePortal support, {{customer_name}}! If you have any more questions, feel free to reach out. Have a wonderful day!",
    variables: ["{{customer_name}}"],
    category: "closing",
    language: "en",
    isActive: true,
  },
  // French templates
  {
    id: "tpl-welcome-fr",
    name: "Message de bienvenue",
    content:
      "Bienvenue au support InsurePortal, {{customer_name}} ! Je suis {{agent_name}}, et je vais vous assister aujourd'hui. Comment puis-je vous aider ?",
    variables: ["{{customer_name}}", "{{agent_name}}"],
    category: "greeting",
    language: "fr",
    isActive: true,
  },
  {
    id: "tpl-closing-fr",
    name: "Message de clôture",
    content:
      "Merci d'avoir contacté le support InsurePortal, {{customer_name}} ! Si vous avez d'autres questions, n'hésitez pas à nous contacter. Bonne journée !",
    variables: ["{{customer_name}}"],
    category: "closing",
    language: "fr",
    isActive: true,
  },
  // Hausa templates
  {
    id: "tpl-welcome-ha",
    name: "Sakon Maraba",
    content:
      "Barka da zuwa goyon bayan InsurePortal, {{customer_name}}! Ni ne {{agent_name}}, kuma zan taimake ku yau. Ta yaya zan iya taimaka?",
    variables: ["{{customer_name}}", "{{agent_name}}"],
    category: "greeting",
    language: "ha",
    isActive: true,
  },
  // Yoruba templates
  {
    id: "tpl-welcome-yo",
    name: "Ifiranṣẹ Kaabo",
    content:
      "Kaabo si atilẹyin InsurePortal, {{customer_name}}! Mo jẹ {{agent_name}}, ati pe emi yoo ṣe iranlọwọ fun yin loni. Bawo ni mo ṣe le ṣe iranlọwọ?",
    variables: ["{{customer_name}}", "{{agent_name}}"],
    category: "greeting",
    language: "yo",
    isActive: true,
  },
];

export function getMessageTemplates(opts?: {
  category?: string;
  language?: string;
}): MessageTemplate[] {
  let filtered = messageTemplates.filter(t => t.isActive);
  if (opts?.category)
    filtered = filtered.filter(t => t.category === opts.category);
  if (opts?.language)
    filtered = filtered.filter(t => t.language === opts.language);
  return filtered;
}

export function renderTemplate(
  templateId: string,
  variables: Record<string, string>
): string | null {
  const tpl = messageTemplates.find(t => t.id === templateId);
  if (!tpl) return null;
  let content = tpl.content;
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(escapeRegex(key), "g"), value);
  }
  return content;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── F20: Multi-Language Support (i18n) ─────────────────────────────────────
export type SupportedLanguage =
  | "en"
  | "fr"
  | "ha"
  | "yo"
  | "ig"
  | "ar"
  | "pt"
  | "sw";

export interface I18nStrings {
  // Chat widget
  chatTitle: string;
  chatPlaceholder: string;
  chatSend: string;
  chatClose: string;
  chatMinimize: string;
  chatNewConversation: string;
  chatTyping: string;
  chatOffline: string;
  chatOnline: string;
  // Survey
  surveyTitle: string;
  surveyQuestion: string;
  surveyComment: string;
  surveySubmit: string;
  surveyThankYou: string;
  // Queue
  queueMessage: string;
  queuePosition: string;
  queueEstimatedWait: string;
  // General
  loading: string;
  error: string;
  retry: string;
  cancel: string;
  confirm: string;
}

const translations: Record<SupportedLanguage, I18nStrings> = {
  en: {
    chatTitle: "Live Support",
    chatPlaceholder: "Type your message...",
    chatSend: "Send",
    chatClose: "Close",
    chatMinimize: "Minimize",
    chatNewConversation: "New Conversation",
    chatTyping: "is typing...",
    chatOffline: "Support is offline",
    chatOnline: "We're online!",
    surveyTitle: "Rate Your Experience",
    surveyQuestion: "How was your support experience?",
    surveyComment: "Any additional comments?",
    surveySubmit: "Submit Feedback",
    surveyThankYou: "Thank you for your feedback!",
    queueMessage: "You're in the queue",
    queuePosition: "Position",
    queueEstimatedWait: "Estimated wait",
    loading: "Loading...",
    error: "Something went wrong",
    retry: "Try Again",
    cancel: "Cancel",
    confirm: "Confirm",
  },
  fr: {
    chatTitle: "Support en direct",
    chatPlaceholder: "Tapez votre message...",
    chatSend: "Envoyer",
    chatClose: "Fermer",
    chatMinimize: "Réduire",
    chatNewConversation: "Nouvelle conversation",
    chatTyping: "est en train d'écrire...",
    chatOffline: "Le support est hors ligne",
    chatOnline: "Nous sommes en ligne !",
    surveyTitle: "Évaluez votre expérience",
    surveyQuestion: "Comment était votre expérience de support ?",
    surveyComment: "Des commentaires supplémentaires ?",
    surveySubmit: "Soumettre",
    surveyThankYou: "Merci pour votre retour !",
    queueMessage: "Vous êtes dans la file d'attente",
    queuePosition: "Position",
    queueEstimatedWait: "Temps d'attente estimé",
    loading: "Chargement...",
    error: "Quelque chose s'est mal passé",
    retry: "Réessayer",
    cancel: "Annuler",
    confirm: "Confirmer",
  },
  ha: {
    chatTitle: "Tallafin Kai Tsaye",
    chatPlaceholder: "Rubuta sakonku...",
    chatSend: "Aika",
    chatClose: "Rufe",
    chatMinimize: "Ragewa",
    chatNewConversation: "Sabuwar Tattaunawa",
    chatTyping: "yana rubuta...",
    chatOffline: "Tallafi ba ya nan",
    chatOnline: "Muna nan!",
    surveyTitle: "Kimanta Kwarewarku",
    surveyQuestion: "Yaya kwarewar tallafin ku?",
    surveyComment: "Wani sharhi?",
    surveySubmit: "Aika Sharhi",
    surveyThankYou: "Na gode da shawarar ku!",
    queueMessage: "Kuna cikin jerin",
    queuePosition: "Matsayi",
    queueEstimatedWait: "Lokacin jira",
    loading: "Ana lodi...",
    error: "Wani abu ya faru",
    retry: "Sake gwadawa",
    cancel: "Soke",
    confirm: "Tabbatar",
  },
  yo: {
    chatTitle: "Atilẹyin Taara",
    chatPlaceholder: "Tẹ ifiranṣẹ rẹ...",
    chatSend: "Firanṣẹ",
    chatClose: "Pa",
    chatMinimize: "Dinku",
    chatNewConversation: "Ifọrọwanilẹnuwo Tuntun",
    chatTyping: "n tẹ...",
    chatOffline: "Atilẹyin ko si",
    chatOnline: "A wa nibi!",
    surveyTitle: "Ṣe ayẹwo Iriri Rẹ",
    surveyQuestion: "Bawo ni iriri atilẹyin rẹ ṣe ri?",
    surveyComment: "Ero afikun?",
    surveySubmit: "Fi silẹ",
    surveyThankYou: "O ṣeun fun esi rẹ!",
    queueMessage: "O wa ninu ila",
    queuePosition: "Ipo",
    queueEstimatedWait: "Akoko iduro",
    loading: "Ń gbé...",
    error: "Nkan kan ṣẹlẹ",
    retry: "Gbiyanju lẹẹkansi",
    cancel: "Fagile",
    confirm: "Jẹrisi",
  },
  ig: {
    chatTitle: "Nkwado Ozugbo",
    chatPlaceholder: "Dee ozi gị...",
    chatSend: "Zipu",
    chatClose: "Mechie",
    chatMinimize: "Belata",
    chatNewConversation: "Mkparịta Ụka Ọhụrụ",
    chatTyping: "na-ede...",
    chatOffline: "Nkwado anọghị",
    chatOnline: "Anyị nọ ebe a!",
    surveyTitle: "Nyochaa Ahụmịhe Gị",
    surveyQuestion: "Kedu ka nkwado gị si dị?",
    surveyComment: "Okwu ọzọ?",
    surveySubmit: "Nyefee",
    surveyThankYou: "Daalụ maka nzaghachi gị!",
    queueMessage: "Ị nọ n'ahịrị",
    queuePosition: "Ọnọdụ",
    queueEstimatedWait: "Oge nchere",
    loading: "Na-ebu...",
    error: "Ihe mere",
    retry: "Nwaa ọzọ",
    cancel: "Kagbuo",
    confirm: "Kwenye",
  },
  ar: {
    chatTitle: "الدعم المباشر",
    chatPlaceholder: "اكتب رسالتك...",
    chatSend: "إرسال",
    chatClose: "إغلاق",
    chatMinimize: "تصغير",
    chatNewConversation: "محادثة جديدة",
    chatTyping: "يكتب...",
    chatOffline: "الدعم غير متصل",
    chatOnline: "نحن متصلون!",
    surveyTitle: "قيّم تجربتك",
    surveyQuestion: "كيف كانت تجربة الدعم؟",
    surveyComment: "تعليقات إضافية؟",
    surveySubmit: "إرسال التقييم",
    surveyThankYou: "شكراً لملاحظاتك!",
    queueMessage: "أنت في قائمة الانتظار",
    queuePosition: "الموقع",
    queueEstimatedWait: "وقت الانتظار المقدر",
    loading: "جاري التحميل...",
    error: "حدث خطأ",
    retry: "إعادة المحاولة",
    cancel: "إلغاء",
    confirm: "تأكيد",
  },
  pt: {
    chatTitle: "Suporte ao Vivo",
    chatPlaceholder: "Digite sua mensagem...",
    chatSend: "Enviar",
    chatClose: "Fechar",
    chatMinimize: "Minimizar",
    chatNewConversation: "Nova Conversa",
    chatTyping: "está digitando...",
    chatOffline: "Suporte offline",
    chatOnline: "Estamos online!",
    surveyTitle: "Avalie sua Experiência",
    surveyQuestion: "Como foi sua experiência de suporte?",
    surveyComment: "Comentários adicionais?",
    surveySubmit: "Enviar Feedback",
    surveyThankYou: "Obrigado pelo seu feedback!",
    queueMessage: "Você está na fila",
    queuePosition: "Posição",
    queueEstimatedWait: "Tempo estimado de espera",
    loading: "Carregando...",
    error: "Algo deu errado",
    retry: "Tentar novamente",
    cancel: "Cancelar",
    confirm: "Confirmar",
  },
  sw: {
    chatTitle: "Msaada wa Moja kwa Moja",
    chatPlaceholder: "Andika ujumbe wako...",
    chatSend: "Tuma",
    chatClose: "Funga",
    chatMinimize: "Punguza",
    chatNewConversation: "Mazungumzo Mapya",
    chatTyping: "anaandika...",
    chatOffline: "Msaada hauko mtandaoni",
    chatOnline: "Tuko mtandaoni!",
    surveyTitle: "Kadiria Uzoefu Wako",
    surveyQuestion: "Uzoefu wako wa msaada ulikuwaje?",
    surveyComment: "Maoni ya ziada?",
    surveySubmit: "Tuma Maoni",
    surveyThankYou: "Asante kwa maoni yako!",
    queueMessage: "Uko kwenye foleni",
    queuePosition: "Nafasi",
    queueEstimatedWait: "Muda wa kusubiri",
    loading: "Inapakia...",
    error: "Kitu kilienda vibaya",
    retry: "Jaribu tena",
    cancel: "Ghairi",
    confirm: "Thibitisha",
  },
};

export function getTranslations(lang: SupportedLanguage): I18nStrings {
  return translations[lang] || translations.en;
}

export function getSupportedLanguages(): Array<{
  code: SupportedLanguage;
  name: string;
  nativeName: string;
}> {
  return [
    { code: "en", name: "English", nativeName: "English" },
    { code: "fr", name: "French", nativeName: "Français" },
    { code: "ha", name: "Hausa", nativeName: "Hausa" },
    { code: "yo", name: "Yoruba", nativeName: "Yorùbá" },
    { code: "ig", name: "Igbo", nativeName: "Igbo" },
    { code: "ar", name: "Arabic", nativeName: "العربية" },
    { code: "pt", name: "Portuguese", nativeName: "Português" },
    { code: "sw", name: "Swahili", nativeName: "Kiswahili" },
  ];
}

export function detectLanguage(text: string): SupportedLanguage {
  const lower = text.toLowerCase();
  // Simple keyword-based detection
  const langIndicators: Record<SupportedLanguage, string[]> = {
    fr: ["bonjour", "merci", "comment", "aide", "problème", "s'il vous plaît"],
    ha: ["sannu", "nagode", "yaya", "taimako", "matsala"],
    yo: ["bawo", "ṣeun", "iranlọwọ", "iṣoro", "jọwọ"],
    ig: ["kedu", "daalụ", "enyemaka", "nsogbu"],
    ar: ["مرحبا", "شكرا", "مساعدة", "مشكلة"],
    pt: ["olá", "obrigado", "ajuda", "problema", "por favor"],
    sw: ["habari", "asante", "msaada", "tatizo", "tafadhali"],
    en: [], // default
  };

  for (const [lang, keywords] of Object.entries(langIndicators)) {
    if (lang === "en") continue;
    if (keywords.some(kw => lower.includes(kw))) {
      return lang as SupportedLanguage;
    }
  }
  return "en";
}
