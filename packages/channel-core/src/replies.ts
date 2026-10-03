// 2026-10-03 (W8-B1): Shared honest reply templates extracted from
// whatsapp-bot/src/engine/conversation.ts (R1a / R-fix finding 2).
// Contact details come from configuration — never invent phone numbers,
// emails, prices, claim references, or SLAs.

export interface ReplyTemplateConfig {
  /** Brand name used in menu/greeting text (e.g. "InsurePortal"). */
  brandName: string;
  /** Support contact details from env/config; null when unset. */
  supportPhone?: string | null;
  supportEmail?: string | null;
}

/** Honest "how to reach support" sentence fragment (no invented details). */
export function supportContactLine(cfg: ReplyTemplateConfig): string {
  const parts: string[] = [];
  if (cfg.supportPhone?.trim()) parts.push(`call ${cfg.supportPhone.trim()}`);
  if (cfg.supportEmail?.trim()) parts.push(`email ${cfg.supportEmail.trim()}`);
  return parts.length > 0
    ? `contact our support team — ${parts.join(" or ")}`
    : `contact our support team via the ${cfg.brandName} app`;
}

/**
 * Fail-closed reply used whenever the platform backend cannot verify or
 * execute a request. NEVER invent references, amounts, or statuses.
 */
export function unavailableReply(cfg: ReplyTemplateConfig): string {
  return (
    "I couldn't verify that right now — please use the " +
    `${cfg.brandName} app or ${supportContactLine(cfg)}. ` +
    "Nothing has been registered or charged."
  );
}

/**
 * Honest fallback for messages whose intent could not be determined. We say
 * what we can do instead of pretending to understand or fabricating an answer.
 */
export function unknownIntentReply(cfg: ReplyTemplateConfig): string {
  return (
    "Sorry, I didn't understand that. I can help you buy insurance, " +
    "get a quote, file a claim, check a policy, or pay a premium. " +
    `Type "menu" to see options, or ${supportContactLine(cfg)}.`
  );
}

/** Honest reply when a handler itself fails unexpectedly (fail-closed). */
export function handlerErrorReply(cfg: ReplyTemplateConfig): string {
  return (
    "Something went wrong on our side and your request was NOT completed. " +
    `Please try again later or ${supportContactLine(cfg)}.`
  );
}
