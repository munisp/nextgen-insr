import { KnowledgeBase } from "../knowledge/base";
import { LanguageDetector, SupportedLanguage } from "../language/detector";
// 2026-10-02 (C2-b11b12, audit B12): sessions persisted in Redis (idle TTL,
// history capped at HISTORY_CAP) so restarts no longer wipe chat context;
// in-memory only as a loudly-logged outage fallback.
// 2026-10-03 (W8-B4): the store internals are delegated to channel-core —
// see lib/sessionStore.ts.
import { RedisSessionStore, HISTORY_CAP } from "../lib/sessionStore";
// 2026-10-03 (W8-B4): honest fail-closed templates from channel-core
// (audit gap: ai-chatbot previously lacked these). No invented contacts,
// references, prices, or statuses.
import { replyConfig, unavailableReply } from "../lib/replies";
// 2026-10-03 (W8-B4): catalog intents are answered from the REAL platform
// catalog when a PlatformClient is configured; failures fail closed.
import { PlatformClient, PlatformUnavailableError } from "../clients/platform";

export { RedisSessionStore, HISTORY_CAP };

interface ChatResponse {
  reply: string;
  language: SupportedLanguage;
  confidence: number;
  intent: string;
  suggested_actions: Array<{ label: string; action: string }>;
  session_id: string;
}

// 2026-10-03 (W8-B4): intents that map to a real member-safe monolith
// procedure (insuranceProductCatalog.listProducts — a serviceOrUserProcedure
// exposing only catalog data). All other member intents (file_claim,
// check_policy, talk_to_agent, pay_premium) require member auth this service
// does not have; they stay honest-unavailable (knowledge-base answers say so)
// and are NEVER fabricated.
const CATALOG_INTENT_PRODUCT_TYPE: Record<string, string> = {
  buy_motor: "motor",
  microinsurance_info: "micro",
};

export class ChatEngine {
  private kb: KnowledgeBase;
  private langDetector: LanguageDetector;
  // 2026-10-02 (C2-b11b12, audit B12): was `sessions: Map<sessionId, ...>` —
  // lost on restart. Now Redis-backed with TTL + capped history.
  private store: RedisSessionStore;
  // 2026-10-03 (W8-B4): optional — absent when the platform API is not
  // configured; catalog answers then stay at the honest static FAQ text.
  private platform: PlatformClient | null;

  constructor(
    kb: KnowledgeBase,
    langDetector: LanguageDetector,
    store?: RedisSessionStore,
    platform?: PlatformClient | null
  ) {
    this.kb = kb;
    this.langDetector = langDetector;
    this.store = store ?? new RedisSessionStore();
    this.platform = platform ?? null;
  }

  async respond(sessionId: string, message: string, preferredLang?: string): Promise<ChatResponse> {
    const lang = (preferredLang as SupportedLanguage) || this.langDetector.detect(message);

    const session = (await this.store.get(sessionId)) ?? { language: lang, history: [] };
    session.history.push(message);
    // Bound history in memory too (store.set also enforces HISTORY_CAP).
    if (session.history.length > HISTORY_CAP) {
      session.history = session.history.slice(-HISTORY_CAP);
    }
    await this.store.set(sessionId, session);

    const faqMatch = this.kb.findAnswer(message, lang);
    if (faqMatch) {
      // 2026-10-03 (W8-B4): enrich catalog intents with real product data.
      // Fail-closed: if the platform cannot verify the catalog, the reply is
      // the honest unavailable template — never stale/invented product info.
      const productType = CATALOG_INTENT_PRODUCT_TYPE[faqMatch.intent];
      if (productType && this.platform) {
        try {
          const products = await this.platform.listProducts(productType);
          const names = products.map((p) => p.name).filter((n): n is string => !!n);
          if (names.length > 0) {
            faqMatch.answer +=
              `\n\nCurrent ${productType} products from our live catalog: ` +
              names.join(", ") +
              ". See the NGApp app for exact prices and coverage.";
          }
        } catch (err) {
          // Loud log, honest reply — nothing fabricated.
          console.error(
            `[ai-chatbot] platform catalog lookup failed for intent ${faqMatch.intent}: ` +
              (err instanceof Error ? err.message : String(err))
          );
          return {
            reply: unavailableReply(replyConfig()),
            language: lang,
            confidence: 0,
            intent: faqMatch.intent,
            suggested_actions: faqMatch.actions,
            session_id: sessionId,
          };
        }
      }
      return {
        reply: faqMatch.answer,
        language: lang,
        confidence: faqMatch.confidence,
        intent: faqMatch.intent,
        suggested_actions: faqMatch.actions,
        session_id: sessionId,
      };
    }

    const greeting = this.getGreeting(lang);
    return {
      reply: greeting,
      language: lang,
      confidence: 0.7,
      intent: "general_inquiry",
      // 2026-10-03 (W8-B4): action ids are the shared channel-core intent ids
      // (KnownIntent) so all channels route them identically.
      suggested_actions: [
        { label: this.translate("Buy Insurance", lang), action: "buy_insurance" },
        { label: this.translate("File a Claim", lang), action: "file_claim" },
        { label: this.translate("Check My Policy", lang), action: "check_policy" },
        { label: this.translate("Talk to Agent", lang), action: "talk_to_agent" },
      ],
      session_id: sessionId,
    };
  }

  private getGreeting(lang: SupportedLanguage): string {
    const greetings: Record<SupportedLanguage, string> = {
      en: "Hello! I'm your NGApp insurance assistant. How can I help you today?",
      ha: "Sannu! Ni ne mataimakin inshorar NGApp. Yaya zan taimaka muku yau?",
      yo: "Pele o! Mo je iranlowo iṣeduro NGApp rẹ. Bawo ni mo ṣe le ran ọ lọwọ loni?",
      ig: "Ndewo! Abu m onye enyemaka mkpuchi NGApp gi. Kedu ka m ga-esi nyere gi aka taa?",
      pcm: "How far! I be your NGApp insurance helper. Wetin I fit help you with today?",
      fr: "Bonjour! Je suis votre assistant assurance NGApp. Comment puis-je vous aider?",
      ar: "مرحبا! أنا مساعد التأمين NGApp الخاص بك. كيف يمكنني مساعدتك اليوم؟",
    };
    return greetings[lang] || greetings.en;
  }

  private translate(text: string, lang: SupportedLanguage): string {
    const translations: Record<string, Record<SupportedLanguage, string>> = {
      "Buy Insurance": {
        en: "Buy Insurance", ha: "Sayi Inshora", yo: "Ra Iṣeduro",
        ig: "Zụta Mkpuchi", pcm: "Buy Insurance", fr: "Acheter Assurance", ar: "شراء تأمين",
      },
      "File a Claim": {
        en: "File a Claim", ha: "Shigar da Ƙara", yo: "Ṣe Ẹtọ",
        ig: "Tinye Arịrịọ", pcm: "Make Claim", fr: "Déposer Réclamation", ar: "تقديم مطالبة",
      },
      "Check My Policy": {
        en: "Check My Policy", ha: "Duba Siyasar ta", yo: "Ṣayẹwo Eto mi",
        ig: "Lelee Iwu m", pcm: "Check My Policy", fr: "Vérifier Police", ar: "تحقق من وثيقتك",
      },
      "Talk to Agent": {
        en: "Talk to Agent", ha: "Yi magana da wakili", yo: "Bá Aṣoju sọrọ",
        ig: "Kwurịtara Onye nnọchite", pcm: "Talk to Person", fr: "Parler à Agent", ar: "تحدث إلى وكيل",
      },
    };
    return translations[text]?.[lang] || text;
  }
}

// Re-export so callers/tests can detect catalog failures without importing
// the client module directly.
export { PlatformUnavailableError };
