export interface ReplyTemplateConfig {
    /** Brand name used in menu/greeting text (e.g. "InsurePortal"). */
    brandName: string;
    /** Support contact details from env/config; null when unset. */
    supportPhone?: string | null;
    supportEmail?: string | null;
}
/** Honest "how to reach support" sentence fragment (no invented details). */
export declare function supportContactLine(cfg: ReplyTemplateConfig): string;
/**
 * Fail-closed reply used whenever the platform backend cannot verify or
 * execute a request. NEVER invent references, amounts, or statuses.
 */
export declare function unavailableReply(cfg: ReplyTemplateConfig): string;
/**
 * Honest fallback for messages whose intent could not be determined. We say
 * what we can do instead of pretending to understand or fabricating an answer.
 */
export declare function unknownIntentReply(cfg: ReplyTemplateConfig): string;
/** Honest reply when a handler itself fails unexpectedly (fail-closed). */
export declare function handlerErrorReply(cfg: ReplyTemplateConfig): string;
//# sourceMappingURL=replies.d.ts.map