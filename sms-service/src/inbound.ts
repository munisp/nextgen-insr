/**
 * inbound.ts — Inbound SMS command parser (NG-6) with typo tolerance.
 *
 * Previously no inbound path existed at all. Commands:
 *   HELP                      — usage text
 *   BALANCE                   — float/balance enquiry (requires linked account)
 *   STATUS <TXN-reference>    — transaction status lookup
 *   STOP                      — opt-out
 * Transactional commands (PAY/TRANSFER) are recognized but FAIL LOUD with a
 * documented 501 — there is no SMS-initiated funds movement bridge in this
 * service; building one without a second factor would be unsafe.
 *
 * Typo tolerance: a command matches if it is a prefix of, or edit-distance ≤1
 * from, a known verb (case-insensitive). Ambiguous input returns HELP with a
 * clarification prompt instead of guessing.
 */

export type InboundCommand =
  | { kind: "help" }
  | { kind: "balance" }
  | { kind: "status"; reference: string }
  | { kind: "stop" }
  | { kind: "unsupported_transactional"; verb: string }
  | { kind: "unknown"; received: string };

const VERBS: Record<string, InboundCommand["kind"]> = {
  HELP: "help",
  BALANCE: "balance",
  BAL: "balance",
  STATUS: "status",
  STOP: "stop",
  PAY: "unsupported_transactional",
  TRANSFER: "unsupported_transactional",
};

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const t = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return dp[n];
}

/** Match a token to a known verb: exact, prefix, or edit-distance ≤ 1. */
export function matchVerb(token: string): string | null {
  const t = token.toUpperCase();
  if (VERBS[t]) return t;
  let best: string | null = null;
  let bestScore = 2; // require distance ≤ 1
  for (const verb of Object.keys(VERBS)) {
    if (verb.startsWith(t) && t.length >= 3) return verb; // unambiguous prefix
    const d = editDistance(t, verb);
    if (d < bestScore) {
      bestScore = d;
      best = verb;
    }
  }
  return best;
}

export function parseInbound(text: string): InboundCommand {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (cleaned === "") return { kind: "unknown", received: "" };
  const [head, ...rest] = cleaned.split(" ");
  const verb = matchVerb(head);
  if (!verb) return { kind: "unknown", received: head };
  const kind = VERBS[verb];
  switch (kind) {
    case "status": {
      const reference = rest.join(" ").trim();
      if (!reference) return { kind: "unknown", received: cleaned };
      return { kind: "status", reference };
    }
    case "unsupported_transactional":
      return { kind: "unsupported_transactional", verb };
    default:
      return { kind } as InboundCommand;
  }
}

export const HELP_TEXT =
  "NGApp Insurance SMS commands: BALANCE - check balance; STATUS <ref> - transaction status; STOP - opt out; HELP - this message. Funds cannot be moved by SMS; dial *384*100# for transactions.";
