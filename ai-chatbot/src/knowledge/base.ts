// 2026-10-03 (W8-B4, honest-replies fix from the W8-B1 triplication audit):
// the pre-W8 FAQ answers FABRICATED contact details ("+234-800-NGAPP",
// "*384*NGAPP#", "portal.ngapp.ng"), invented prices ("₦5,000/year",
// "₦500/month", ...), and an invented SLA ("auto-approved in under 4 hours").
// None of those are backed by configuration or the platform API. Answers are
// now honest: they say what this chat can actually do and point at the NGApp
// app or the env-configured support line (the "{support}" token below is
// replaced at match time by channel-core's supportContactLine, which emits
// SUPPORT_PHONE/SUPPORT_EMAIL when set and an honest app pointer when not).
// Product names/prices, when asked for, come from the real catalog via
// PlatformClient in engine/chat.ts — never from this file.
import { SupportedLanguage } from "../language/detector";
import { replyConfig, supportContactLine } from "../lib/replies";

interface FAQEntry {
  question: Record<string, string>;
  answer: Record<string, string>;
  intent: string;
  keywords: string[];
  actions: Array<{ label: string; action: string }>;
}

interface MatchResult {
  answer: string;
  confidence: number;
  intent: string;
  actions: Array<{ label: string; action: string }>;
}

export class KnowledgeBase {
  private faqs: FAQEntry[] = [
    {
      question: {
        en: "How do I buy motor insurance?",
        ha: "Yaya zan sayi inshorar mota?",
        pcm: "How I go buy motor insurance?",
      },
      answer: {
        en: "You can buy motor insurance in the NGApp app. If you ask me for motor products, I can list our current ones from the live catalog — I never quote prices I cannot verify. For personal help, {support}.",
        ha: "Kuna iya sayen inshorar mota a cikin app na NGApp. Idan ka tambaye ni game da kayayyakin mota, zan iya lissafa waɗanda muke da su yanzu daga catalog ɗin mu. Don taimako na kashin ka, {support}.",
        pcm: "You fit buy motor insurance inside the NGApp app. If you ask me for motor products, I go list the ones we get now from our live catalog — I no dey quote price wey I no fit verify. For personal help, {support}.",
      },
      intent: "buy_motor",
      keywords: ["motor", "car", "vehicle", "insurance", "buy", "mota", "sayi"],
      actions: [
        { label: "Get a Quote", action: "get_quote" },
        { label: "Talk to Agent", action: "talk_to_agent" },
      ],
    },
    {
      question: {
        en: "How do I file a claim?",
        pcm: "How I go file claim?",
      },
      answer: {
        en: "To file a claim, please use the NGApp app, or {support}. I cannot register a claim in this chat yet, and I will never invent a claim reference or approval time — once you file through the app you get a real reference you can track.",
        pcm: "To file claim, abeg use the NGApp app, or {support}. I no fit register claim inside this chat yet, and I no go ever invent claim reference or approval time — once you file am for app you go get correct reference wey you fit track.",
      },
      intent: "file_claim",
      keywords: ["claim", "file", "accident", "stolen", "damage", "report"],
      actions: [
        { label: "File Claim Now", action: "file_claim" },
        { label: "Check Claim Status", action: "check_policy" },
      ],
    },
    {
      question: { en: "What is microinsurance?" },
      answer: {
        en: "Microinsurance is affordable insurance with low, regular premiums. NGApp offers microinsurance products — I can list the current ones from the live catalog if you ask, and the NGApp app shows exact prices and coverage for each. For help choosing, {support}.",
      },
      intent: "microinsurance_info",
      keywords: ["micro", "cheap", "affordable", "small", "low cost"],
      actions: [
        { label: "View Products", action: "get_quote" },
        { label: "Sign Up", action: "buy_insurance" },
      ],
    },
  ];

  findAnswer(query: string, lang: SupportedLanguage): MatchResult | null {
    const lowerQuery = query.toLowerCase();

    for (const faq of this.faqs) {
      const matchScore = faq.keywords.reduce((score, kw) => {
        return score + (lowerQuery.includes(kw.toLowerCase()) ? 1 : 0);
      }, 0);

      if (matchScore >= 2) {
        const template = faq.answer[lang] || faq.answer.en || Object.values(faq.answer)[0];
        // 2026-10-03 (W8-B4): substitute the honest, env-driven support line.
        const answer = template.split("{support}").join(supportContactLine(replyConfig()));
        return {
          answer,
          confidence: Math.min(0.95, 0.5 + matchScore * 0.15),
          intent: faq.intent,
          actions: faq.actions,
        };
      }
    }
    return null;
  }

  getFAQ() {
    return this.faqs.map((f) => ({
      question: f.question.en || Object.values(f.question)[0],
      intent: f.intent,
    }));
  }
}
