// 2026-10-03 (W8-B4): Honest reply configuration for ai-chatbot. The W8-B1
// triplication audit flagged that ai-chatbot LACKED the fail-closed reply
// templates the other bots had, and its knowledge base shipped fabricated
// contact details (a demo phone number, USSD code, portal URL) and invented
// prices/SLAs. Those are now replaced by channel-core's honest templates
// (replies.ts) driven by this config: support contact details come from env
// (SUPPORT_PHONE / SUPPORT_EMAIL); when unset, templates honestly point at
// the NGApp app instead of inventing contacts.
import {
  ReplyTemplateConfig,
  supportContactLine,
  unavailableReply,
  unknownIntentReply,
  handlerErrorReply,
} from "@insureportal/channel-core";

export { supportContactLine, unavailableReply, unknownIntentReply, handlerErrorReply };

/** Env-driven template config; re-read per call so tests can set env. */
export function replyConfig(
  env: NodeJS.ProcessEnv = process.env
): ReplyTemplateConfig {
  return {
    brandName: "NGApp",
    supportPhone: env.SUPPORT_PHONE ?? null,
    supportEmail: env.SUPPORT_EMAIL ?? null,
  };
}
