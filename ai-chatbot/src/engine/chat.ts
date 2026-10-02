import { KnowledgeBase } from "../knowledge/base";
import { LanguageDetector, SupportedLanguage } from "../language/detector";
// 2026-10-02 (C2-b11b12, audit B12): sessions persisted in Redis (hash + idle
// TTL, history capped at HISTORY_CAP) so restarts no longer wipe chat
// context; in-memory only as a loudly-logged outage fallback.
import { RedisSessionStore, HISTORY_CAP } from "../lib/sessionStore";

export { RedisSessionStore, HISTORY_CAP };

interface ChatResponse {
  reply: string;
  language: SupportedLanguage;
  confidence: number;
  intent: string;
  suggested_actions: Array<{ label: string; action: string }>;
  session_id: string;
}

export class ChatEngine {
  private kb: KnowledgeBase;
  private langDetector: LanguageDetector;
  // 2026-10-02 (C2-b11b12, audit B12): was `sessions: Map<sessionId, ...>` —
  // lost on restart. Now Redis-backed with TTL + capped history.
  private store: RedisSessionStore;

  constructor(kb: KnowledgeBase, langDetector: LanguageDetector, store?: RedisSessionStore) {
    this.kb = kb;
    this.langDetector = langDetector;
    this.store = store ?? new RedisSessionStore();
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
        ig: "Lelee Iwu m", pcm: "Check My Policy", fr: "Vérifier Police", ar: "تحقق من وثيقتي",
      },
      "Talk to Agent": {
        en: "Talk to Agent", ha: "Yi magana da wakili", yo: "Bá Aṣoju sọrọ",
        ig: "Kwurịtara Onye nnọchite", pcm: "Talk to Person", fr: "Parler à Agent", ar: "تحدث إلى وكيل",
      },
    };
    return translations[text]?.[lang] || text;
  }
}
