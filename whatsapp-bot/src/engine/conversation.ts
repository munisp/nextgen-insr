import { InsuranceIntentClassifier, InsuranceIntent } from "./intent";
import { PlatformClient, PlatformUnavailableError } from "../clients/platform";
// 2026-10-02 (C2-b11b12, audit B11): state shape + Redis store live in
// src/lib/conversationStore.ts (re-exported here for existing imports).
import {
  ConversationState,
  RedisConversationStore,
  CONVERSATION_IDLE_TIMEOUT_MS,
} from "../lib/conversationStore";

export { ConversationState, RedisConversationStore };

export interface BotResponse {
  text: string;
  buttons?: Array<{ id: string; title: string }>;
  list?: {
    title: string;
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
}

// 2026-10-01 (R1a): Honest fail-closed reply used whenever the platform
// backend cannot verify or execute a request. NEVER invent references,
// amounts, or statuses.
// 2026-10-01 (R-fix, finding 2): contact details come from env — never
// invent phone numbers or emails. When unset we refer honestly to
// "our support team" with no fabricated details and no SLA promises.
const SUPPORT_PHONE = process.env.SUPPORT_PHONE?.trim() || null;
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL?.trim() || null;

/** Honest "how to reach support" sentence fragment (no invented details). */
function supportContactLine(): string {
  const parts: string[] = [];
  if (SUPPORT_PHONE) parts.push(`call ${SUPPORT_PHONE}`);
  if (SUPPORT_EMAIL) parts.push(`email ${SUPPORT_EMAIL}`);
  return parts.length > 0
    ? `contact our support team — ${parts.join(" or ")}`
    : "contact our support team via the InsurePortal app";
}

const UNAVAILABLE_MESSAGE =
  "I couldn't verify that right now — please use the InsurePortal app or " +
  `${supportContactLine()}. Nothing has been registered or charged.`;

function logLoud(operation: string, phone: string, err?: unknown): void {
  console.error(
    `[whatsapp-bot] FAIL-CLOSED: ${operation} unavailable for ${phone}: ${
      err instanceof Error ? err.message : String(err ?? "no backend path")
    }`
  );
}

// 2026-10-01 (R1a): Interactive button/list reply ids previously fell through
// the regex classifier (underscores never match) and landed on "unknown".
// Map them explicitly so the real flows are reachable.
const BUTTON_ID_INTENTS: Record<string, InsuranceIntent> = {
  buy_motor: "buy_motor_insurance",
  buy_life: "buy_life_insurance",
  buy_health: "buy_health_insurance",
  buy_funeral: "buy_funeral_cover",
  check_policy: "check_policy",
  file_claim: "file_claim",
  pay_premium: "pay_premium",
  talk_agent: "talk_to_agent",
};

const BUTTON_ID_VALUES: Record<string, string> = {
  motor_tp: "Third Party",
  motor_comp: "Comprehensive",
  motor_quote: "Quote",
  claim_accident: "Accident",
  claim_theft: "Theft",
  claim_other: "Other",
};

export class ConversationEngine {
  // 2026-10-02 (C2-b11b12, audit B11): state now persisted in Redis
  // (hash + idle TTL) via RedisConversationStore so restarts no longer wipe
  // multi-step conversations; in-memory only as a loudly-logged outage
  // fallback. See src/lib/conversationStore.ts.
  private store: RedisConversationStore;
  private classifier: InsuranceIntentClassifier;
  private platform: PlatformClient | null;

  constructor(
    classifier: InsuranceIntentClassifier,
    platform?: PlatformClient,
    store?: RedisConversationStore
  ) {
    this.classifier = classifier;
    this.platform = platform ?? null;
    this.store = store ?? new RedisConversationStore();
  }

  async processMessage(phone: string, text: string): Promise<BotResponse> {
    let state = await this.store.get(phone);
    if (!state || Date.now() - state.lastActive > CONVERSATION_IDLE_TIMEOUT_MS) {
      state = { phone, intent: null, step: 0, data: {}, lastActive: Date.now() };
    }
    state.lastActive = Date.now();

    const response = await this.dispatch(state, text);
    await this.store.set(state);
    return response;
  }

  private async dispatch(state: ConversationState, text: string): Promise<BotResponse> {
    const normalized = BUTTON_ID_VALUES[text] ?? text;

    if (normalized.toLowerCase() === "menu" || normalized === "0") {
      state.intent = null;
      state.step = 0;
      return this.mainMenu();
    }

    if (!state.intent || state.step === 0) {
      const intent = BUTTON_ID_INTENTS[text] ?? this.classifier.classify(normalized);
      state.intent = intent;
      state.step = 1;
      return this.handleIntent(state, normalized);
    }

    return this.continueFlow(state, normalized);
  }

  private mainMenu(): BotResponse {
    // 2026-10-01 (R1a): removed unverified hardcoded prices ("from ₦5,000/yr"
    // etc.) — prices must come from the real catalog or not be shown.
    return {
      text:
        "Welcome to *InsurePortal* \u{1F6E1}\n\n" +
        "How can I help you today?\n\n" +
        "Type a number or describe what you need:",
      list: {
        title: "Insurance Services",
        sections: [
          {
            title: "Buy Insurance",
            rows: [
              { id: "buy_motor", title: "Motor Insurance", description: "Third party & comprehensive" },
              { id: "buy_life", title: "Life Cover" },
              { id: "buy_funeral", title: "Funeral Cover" },
              { id: "buy_health", title: "Hospital Cash" },
            ],
          },
          {
            title: "Manage",
            rows: [
              { id: "check_policy", title: "Check My Policy" },
              { id: "file_claim", title: "File a Claim" },
              { id: "pay_premium", title: "Pay Premium" },
              { id: "talk_agent", title: "Talk to Agent" },
            ],
          },
        ],
      },
    };
  }

  private handleIntent(state: ConversationState, _text: string): BotResponse | Promise<BotResponse> {
    switch (state.intent) {
      case "greeting":
        state.intent = null;
        state.step = 0;
        return this.mainMenu();

      case "buy_motor_insurance":
        return {
          text: "*Motor Insurance* \u{1F697}\n\nWhich type of cover?",
          buttons: [
            { id: "motor_tp", title: "Third Party" },
            { id: "motor_comp", title: "Comprehensive" },
            { id: "motor_quote", title: "Get a Quote" },
          ],
        };

      case "buy_life_insurance":
      case "buy_health_insurance":
      case "buy_funeral_cover":
        // 2026-10-01 (R1a): no real purchase/quote flow exists on this channel
        // for these products — direct honestly instead of faking one.
        state.intent = null;
        state.step = 0;
        return {
          text:
            "That cover isn't available on WhatsApp yet.\n\n" +
            // 2026-10-01 (R-fix, finding 2): env-driven contact, no invented number.
            "You can buy it in the InsurePortal app, or " +
            `${supportContactLine()}.`,
        };

      case "file_claim":
        return {
          text: "I'm sorry to hear that. Let me help you file a claim.\n\nPlease enter your *policy number*:",
        };

      case "check_policy":
        return {
          text: "Please enter your *policy number* and I'll look it up for you:",
        };

      case "pay_premium":
        // 2026-10-01 (R1a): premium amounts and payment initiation previously
        // fabricated here (hardcoded ₦5,000, fake PAY- refs). There is no
        // customer-authenticated payment endpoint callable from this channel,
        // so fail closed immediately rather than collect details we cannot use.
        state.intent = null;
        state.step = 0;
        logLoud("pay_premium", state.phone);
        return { text: UNAVAILABLE_MESSAGE };

      case "get_quote":
        // 2026-10-01 (R1a): route generic quote requests into the real
        // catalog-backed motor quote flow.
        state.intent = "buy_motor_insurance";
        return {
          text: "*Motor Insurance Quote* \u{1F697}\n\nWhich type of cover?",
          buttons: [
            { id: "motor_tp", title: "Third Party" },
            { id: "motor_comp", title: "Comprehensive" },
          ],
        };

      case "talk_to_agent":
        state.intent = null;
        state.step = 0;
        return {
          // 2026-10-01 (R-fix, finding 2): only real (env-configured) contact
          // channels are shown; the invented 15-minute callback SLA is removed.
          text:
            "I'll connect you with our support team.\n\n" +
            (SUPPORT_PHONE ? `\u{1F4DE} Call: ${SUPPORT_PHONE}\n` : "") +
            (SUPPORT_EMAIL ? `\u{1F4E7} Email: ${SUPPORT_EMAIL}\n` : "") +
            (SUPPORT_PHONE || SUPPORT_EMAIL
              ? "\nOur support team will assist you during business hours."
              : "Please reach our support team via the InsurePortal app during business hours."),
        };

      case "help":
        state.intent = null;
        state.step = 0;
        return this.mainMenu();

      default:
        state.intent = null;
        state.step = 0;
        return {
          text:
            "I didn't quite understand that. Here's what I can help with:\n\n" +
            "\u2022 Buy motor insurance\n" +
            "\u2022 File a claim\n" +
            "\u2022 Check your policy status\n" +
            "\u2022 Pay your premium\n\n" +
            "Type *menu* to see all options.",
        };
    }
  }

  private continueFlow(state: ConversationState, text: string): Promise<BotResponse> {
    switch (state.intent) {
      case "file_claim":
        return this.claimFlow(state, text);
      case "check_policy":
        return this.policyCheckFlow(state, text);
      case "pay_premium":
        // 2026-10-01 (R1a): fail-closed at entry; no multi-step flow remains.
        state.intent = null;
        state.step = 0;
        logLoud("pay_premium", state.phone);
        return Promise.resolve({ text: UNAVAILABLE_MESSAGE });
      case "buy_motor_insurance":
        return this.motorFlow(state, text);
      default:
        state.intent = null;
        state.step = 0;
        return Promise.resolve(this.mainMenu());
    }
  }

  private claimFlow(state: ConversationState, text: string): Promise<BotResponse> {
    if (state.step === 1) {
      state.data.policyNumber = text;
      state.step = 2;
      return Promise.resolve({
        text: "What type of claim?",
        buttons: [
          { id: "claim_accident", title: "Accident" },
          { id: "claim_theft", title: "Theft" },
          { id: "claim_other", title: "Other" },
        ],
      });
    }
    if (state.step === 2) {
      state.data.claimType = text;
      state.step = 3;
      return Promise.resolve({ text: "Please describe what happened:" });
    }
    if (state.step === 3) {
      state.data.description = text;
      state.step = 4;
      return Promise.resolve({
        text: "Please send a photo of the damage/incident (or type *skip*):",
      });
    }

    // 2026-10-01 (R1a): previously this fabricated a claim reference
    // ("NGA-CLM-...") without registering anything. The real claims endpoint
    // (insuranceWorkflows.fileClaim) requires an authenticated customer
    // session and a numeric policyId — neither exists on this channel — so we
    // FAIL CLOSED: register nothing, invent nothing, tell the user honestly.
    state.intent = null;
    state.step = 0;
    logLoud(
      `file_claim (policy=${state.data.policyNumber}, type=${state.data.claimType})`,
      state.phone
    );
    return Promise.resolve({ text: UNAVAILABLE_MESSAGE });
  }

  private policyCheckFlow(state: ConversationState, text: string): Promise<BotResponse> {
    // 2026-10-01 (R1a): previously returned a hardcoded "Active" status,
    // type, expiry and next payment for ANY policy number. There is no
    // backend procedure to look up an arbitrary policy by number from an
    // unauthenticated channel, so FAIL CLOSED with an honest message.
    state.intent = null;
    state.step = 0;
    logLoud(`check_policy (policy=${text})`, state.phone);
    return Promise.resolve({ text: UNAVAILABLE_MESSAGE });
  }

  private async motorFlow(state: ConversationState, text: string): Promise<BotResponse> {
    if (state.step === 1) {
      state.data.coverType = text;
      state.step = 2;
      return { text: "Enter your *vehicle registration number*:" };
    }
    if (state.step === 2) {
      state.data.vehicleReg = text;
      state.step = 3;
      return { text: "Enter your *vehicle value* in Naira:" };
    }
    state.intent = null;
    state.step = 0;

    // 2026-10-01 (R1a): previously fabricated a flat ₦5,000 premium and a
    // fake policy reference (NGA-MTR-...). Now the premium comes from the
    // REAL product catalog (insuranceProductCatalog.listProducts +
    // calculatePremium). Any failure fails closed — no invented numbers.
    const vehicleValue = Number(String(text).replace(/[^\d.]/g, ""));
    if (!Number.isFinite(vehicleValue) || vehicleValue <= 0) {
      return {
        text:
          "That doesn't look like a valid vehicle value. " +
          "Type *menu* to start again.",
      };
    }
    if (!this.platform) {
      logLoud("motor_quote", state.phone, "platform client not configured");
      return { text: UNAVAILABLE_MESSAGE };
    }
    try {
      const products = await this.platform.listMotorProducts();
      const product = products[0];
      if (!product) {
        throw new PlatformUnavailableError("catalog has no active motor product");
      }
      const calc = await this.platform.calculatePremium(product.id, vehicleValue);
      const premium = calc.premium ?? calc.annualPremium;
      if (typeof premium !== "number" || !(premium > 0)) {
        throw new PlatformUnavailableError(
          `catalog returned no usable premium: ${JSON.stringify(calc).slice(0, 200)}`
        );
      }
      const naira = new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: calc.currency === "NGN" || !calc.currency ? "NGN" : calc.currency,
        maximumFractionDigits: 2,
      }).format(premium);
      // NOTE: no policy reference is shown — a policy only exists after a real
      // purchase in the app. The quote itself is real (catalog-computed).
      return {
        text:
          `*Quote Ready* \u{1F4B0}\n\n` +
          `Vehicle: ${state.data.vehicleReg}\n` +
          `Cover: ${state.data.coverType}\n` +
          `Product: ${product.name ?? "Motor Insurance"}\n` +
          `Indicative premium: *${naira}/year*\n\n` +
          // 2026-10-01 (R-fix, finding 2): env-driven contact, no invented number.
          `To purchase, use the InsurePortal app or ${supportContactLine()}.`,
      };
    } catch (err) {
      logLoud("motor_quote", state.phone, err);
      return { text: UNAVAILABLE_MESSAGE };
    }
  }
}
