/**
 * 2026-10-01 (R1d): Honest user-facing copy.
 *
 * Audit finding: the monolith (server/restBridge.ts, mounted at /api/v1) only
 * exposes authenticated, admin-oriented routes, and the tRPC routers expose no
 * public member self-service procedures for policies/claims/premiums, no
 * member payment collection procedure, and no Telegram-to-member account
 * linking mechanism. The previous bot called /api/v1/policies, /api/v1/claims,
 * /api/v1/premiums/due and /api/v1/agents/nearby — none of which exist — and
 * swallowed the resulting errors, showing users silent empty lists. It also
 * presented hardcoded bank account numbers in /pay.
 *
 * Until a real member-facing backend exists, these commands answer honestly
 * instead of fabricating data. Never invent payment details, hotlines or
 * policy data here.
 */

export const MEMBER_DATA_UNAVAILABLE =
  "⚠️ *Not available in this bot yet*\n\n" +
  "Your Telegram account is not linked to an InsurePortal member profile, and " +
  "member self-service is not exposed to this bot by the platform yet.\n\n" +
  "To view your policies, claims and premiums, please use the official " +
  "InsurePortal app or the USSD service, or contact your agent.";

export const CLAIM_FILE_UNAVAILABLE =
  "⚠️ *Claims cannot be filed via Telegram yet*\n\n" +
  "This bot is not connected to the claims system. To file a claim, please use " +
  "the official InsurePortal app, the USSD service, or contact your agent or " +
  "the claims hotline shown on your policy document.\n\n" +
  "In an emergency, use /emergency.";

export const CLAIM_STATUS_UNAVAILABLE =
  "⚠️ *Claim status lookup is not available in this bot yet*\n\n" +
  "This bot cannot access the claims system. Please check claim status in the " +
  "official InsurePortal app or via your agent.";

export const AGENT_LOCATOR_UNAVAILABLE =
  "⚠️ *Agent locator is not available in this bot yet*\n\n" +
  "This bot cannot query the agent directory. Please use the official " +
  "InsurePortal app or USSD service to find an agent near you.";

export const PAY_VIA_OFFICIAL_CHANNELS =
  "💳 *Premium payments*\n\n" +
  "For your security, this bot does not collect payments and does not display " +
  "account details. Please pay only through official InsurePortal channels:\n\n" +
  "• The official InsurePortal app\n" +
  "• The official USSD service\n" +
  "• Your registered agent\n\n" +
  "_Never transfer money to account numbers sent via chat._";

export const SERVICE_ERROR =
  "❌ Sorry — something went wrong on our side while handling that. " +
  "Please try again later.";

export const CLAIM_EVIDENCE_UNSUPPORTED =
  "📸 Thanks — but this bot cannot attach evidence to a claim yet. " +
  "Please submit photos and documents through the official InsurePortal app " +
  "or to your agent.";
