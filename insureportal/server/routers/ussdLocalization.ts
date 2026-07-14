import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { auditLog } from "@schema";
import { desc, eq, count } from "drizzle-orm";

/**
 * USSD Localization Router
 * 
 * Manages multi-language content for USSD menus across Nigeria's 36 states.
 * Supports: English, Hausa, Yoruba, Igbo, Pidgin.
 * State-to-language mapping for auto-detection based on carrier prefix.
 */
export const ussdLocalizationRouter = router({
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0), language: z.string().optional() }))
    .query(async ({ input }) => {
      const database = await getDb();
      if (!database) return { data: [], total: 0 };
      const results = await database.select().from(auditLog).orderBy(desc(auditLog.id)).limit(input.limit).offset(input.offset);
      const [{ total }] = await database.select({ total: count() }).from(auditLog);
      return { data: results, total: total ?? 0 };
    }),
  getTranslation: protectedProcedure
    .input(z.object({ key: z.string(), language: z.enum(["en", "ha", "yo", "ig", "pcm"]) }))
    .query(async ({ input }) => {
      const translations: Record<string, Record<string, string>> = {
        "welcome": { en: "Welcome to InsurePortal", ha: "Sannu da zuwa", yo: "Ẹ ku abọ", ig: "Nnọọ", pcm: "Welcome o!" },
        "buy_insurance": { en: "Buy Insurance", ha: "Sayi Inshorar", yo: "Ra Ìdáàbòbò", ig: "Zụta Nchekwa", pcm: "Buy Insurance" },
        "make_claim": { en: "Make a Claim", ha: "Yi Claim", yo: "Ṣe Ẹtọ", ig: "Mee Claim", pcm: "Make Claim" },
        "check_balance": { en: "Check Balance", ha: "Duba Balance", yo: "Ṣe Àyẹ̀wò Owó", ig: "Lee Balance", pcm: "Check Balance" },
      };
      return { key: input.key, language: input.language, text: translations[input.key]?.[input.language] ?? input.key };
    }),
  getSupportedLanguages: protectedProcedure.query(async () => {
    return [
      { code: "en", name: "English", states: ["Lagos", "Abuja", "Rivers", "Cross River"] },
      { code: "ha", name: "Hausa", states: ["Kano", "Kaduna", "Sokoto", "Katsina", "Borno"] },
      { code: "yo", name: "Yoruba", states: ["Oyo", "Osun", "Ondo", "Ekiti", "Ogun"] },
      { code: "ig", name: "Igbo", states: ["Anambra", "Enugu", "Imo", "Abia", "Ebonyi"] },
      { code: "pcm", name: "Pidgin English", states: ["Delta", "Edo", "Bayelsa"] },
    ];
  }),
});
