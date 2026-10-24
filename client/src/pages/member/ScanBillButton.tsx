/**
 * ScanBillButton.tsx — 2026-10-25 (W11-B4c-2): OCR "Scan a bill" intake for
 * the member bill/airtime forms, consuming the merged server proc
 * memberBillScan.parse (server/routers/memberBillScan.ts, W11-B4c-1):
 *   input  { imageBase64, rail: "bill" | "airtime" }
 *   output { status: "ok" | "unavailable" | "low_confidence" | "error",
 *            mode: "prefill" | "manual_entry",
 *            prefill?: { billerCode?, customerNumber?, amountKobo? },
 *            confidence?, message }
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PREFILL-ONLY CONTRACT (funds-critical):                              │
 * │   - NOTHING here pays, submits, or validates. A successful scan is   │
 * │     a REVIEW CARD ("Scanned from photo — review before paying"); the │
 * │     member taps "Apply" to feed the extracted IDENTIFIERS through    │
 * │     the EXISTING onPayeeSelect path (the same contract the recent-   │
 * │     payee picker uses: catalog-matched biller only, amount ALWAYS    │
 * │     cleared, validation/pay state reset). The scanned AMOUNT is only │
 * │     ever a suggestion chip the member taps explicitly — it is NEVER  │
 * │     auto-filled and NEVER auto-submitted. The normal validate + Pay  │
 * │     + anomaly-gate flow is untouched.                                │
 * │   - unavailable / low_confidence / error (and any network failure)   │
 * │     render an honest inline message and leave the form fully usable. │
 * │     No extraction is ever fabricated.                                │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Capture: a plain <input type="file" accept="image/*" capture="environment">
 * (the mobile-web camera affordance) — no camera modal, no getUserMedia.
 * Oversized images are downscaled via canvas (max dimension ~1600px) before
 * base64 encoding; when canvas/Image is unavailable or the result would
 * exceed the server cap (14M base64 chars ≈ 10 MB binary, see
 * memberBillScan.ts imageSchema) the scan fails closed with an honest
 * message — the form is untouched.
 *
 * Instrumentation (flow "bill_scan"): scan_started, scan_succeeded,
 * scan_failed with metadata {rail, status} ONLY — the extracted biller /
 * meter / amount values are NEVER tracked. NOTE (2026-10-25): these three
 * kinds are client-side vocabulary ahead of the server UX_EVENT_KINDS enum
 * (same pattern as the W11-B4b omnibox kinds pre-B4c-1) — uxTrack drops
 * them fail-silently at the enqueue boundary until a server batch extends
 * the enum; the server already records its own privacy-minimal bill_scan
 * telemetry row per attempt (memberBillScan.ts recordOutcome).
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { trackEvent } from "@/lib/uxTrack";
import { Button } from "@/components/ui/button";
import type { RecentPayee } from "./RecentPayeePicker";

export type ScanRail = "bill" | "airtime";

/** Instrumentation flow name (metadata: rail + status only, never values). */
const SCAN_FLOW = "bill_scan";

/** Provenance label the parent's onPayeeSelect stores; the page hint
 *  copy special-cases it (mirrors the "omnibox" label). */
export const SCAN_PREFILL_LABEL = "scanned photo";

/** Downscale ceiling — OCR needs legibility, not megapixels. */
const MAX_DIM = 1600;
/** Files above this go through the canvas downscale before encoding. */
const DOWNSCALE_ABOVE_BYTES = 2_000_000;
/** Server cap is 14M base64 chars (memberBillScan.ts); stay below it. */
const MAX_BASE64_CHARS = 13_000_000;

/** Client view of the server prefill proposal (all fields optional). */
interface ScanPrefill {
  billerCode?: string;
  customerNumber?: string;
  amountKobo?: number;
}

interface ScanParseResult {
  status: "ok" | "unavailable" | "low_confidence" | "error";
  mode: "prefill" | "manual_entry";
  prefill?: ScanPrefill;
  confidence?: number;
  message?: string;
}

const fmtNgnFromKobo = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    kobo / 100
  );

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Downscale via canvas to MAX_DIM on the long edge; returns a JPEG data
 *  URL. Throws when Image/canvas is unavailable (caller falls back). */
async function downscaleToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("image decode failed"));
      el.src = objectUrl;
    });
    const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * File → base64 (no data-URL prefix) for memberBillScan.parse. Oversized
 * files are downscaled first; anything that still exceeds the server cap
 * (or cannot be read at all) returns null → the caller fails closed with
 * an honest message. Never throws.
 */
async function fileToBase64(file: File): Promise<string | null> {
  let dataUrl: string;
  try {
    dataUrl =
      file.size > DOWNSCALE_ABOVE_BYTES
        ? await downscaleToDataUrl(file)
        : await readAsDataUrl(file);
  } catch {
    try {
      dataUrl = await readAsDataUrl(file);
    } catch {
      return null;
    }
  }
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (base64.length < 100 || base64.length > MAX_BASE64_CHARS) return null;
  return base64;
}

/**
 * "Scan a bill" button + review card. The parent passes its EXISTING
 * payee-select handler (onApply) — the amount-clearing / state-reset /
 * prefill_accepted tracking contract is inherited from it verbatim.
 */
export function ScanBillButton({
  rail,
  onApply,
  onAmountSuggestion,
}: {
  rail: ScanRail;
  /** The parent's existing onPayeeSelect-equivalent. Called with a
   *  scan-shaped payee (identifiers ONLY — never an amount). */
  onApply: (payee: RecentPayee) => void;
  /** Called ONLY when the member explicitly taps the amount suggestion
   *  chip; the parent fills its normal (editable) amount field. */
  onAmountSuggestion: (amountNGN: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<ScanPrefill | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const parseMutation = trpc.memberBillScan.parse.useMutation({
    onSuccess: (data: ScanParseResult) => {
      setBusy(false);
      const prefill = data?.prefill;
      const hasFields =
        prefill !== undefined &&
        (prefill.billerCode !== undefined ||
          prefill.customerNumber !== undefined ||
          prefill.amountKobo !== undefined);
      if (data?.status === "ok" && data.mode === "prefill" && hasFields) {
        // Metadata: rail + status ONLY — never the extracted values.
        trackEvent(SCAN_FLOW, "scan_succeeded", {
          metadata: { rail, status: "ok" },
        });
        setMessage(null);
        setProposal(prefill);
      } else {
        // unavailable / low_confidence / error / empty prefill — honest
        // manual-entry message, form untouched, nothing fabricated.
        trackEvent(SCAN_FLOW, "scan_failed", {
          metadata: { rail, status: String(data?.status ?? "error") },
        });
        setProposal(null);
        setMessage(
          data?.message ||
            "Bill scan could not extract anything — please enter the details manually."
        );
      }
    },
    onError: () => {
      // Network/server failure → fail closed. No extraction is fabricated.
      setBusy(false);
      trackEvent(SCAN_FLOW, "scan_failed", {
        metadata: { rail, status: "error" },
      });
      setProposal(null);
      setMessage(
        "Bill scan failed — please enter the details manually. Nothing was extracted."
      );
    },
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Allow re-selecting the same file after a failed/unwanted scan.
    e.target.value = "";
    if (!file) return;
    setMessage(null);
    setProposal(null);
    setBusy(true);
    trackEvent(SCAN_FLOW, "scan_started", { metadata: { rail } });
    const imageBase64 = await fileToBase64(file);
    if (!imageBase64) {
      setBusy(false);
      trackEvent(SCAN_FLOW, "scan_failed", {
        metadata: { rail, status: "error" },
      });
      setMessage(
        "Could not read that image (or it is too large) — please try a clearer photo or enter the details manually."
      );
      return;
    }
    parseMutation.mutate({ imageBase64, rail });
  };

  const onConfirmApply = () => {
    if (!proposal) return;
    // Feed the identifiers through the EXISTING payee-select path. The
    // amount is deliberately NOT included — the payee-select contract
    // clears it (the member confirms the amount via the suggestion chip
    // or by typing it).
    const payee: RecentPayee =
      rail === "bill"
        ? {
            id: "bill-scan",
            rail: "bill",
            label: SCAN_PREFILL_LABEL,
            billerCode: proposal.billerCode ?? null,
            meterNumber: proposal.customerNumber ?? null,
          }
        : {
            id: "bill-scan",
            rail: "airtime",
            label: SCAN_PREFILL_LABEL,
            network: proposal.billerCode ?? null,
            phone: proposal.customerNumber ?? null,
          };
    onApply(payee);
    setProposal(null);
  };

  const hasIdentifiers = Boolean(
    proposal && (proposal.billerCode || proposal.customerNumber)
  );

  return (
    <div className="space-y-3" data-testid="scan-bill">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="scan-file-input"
        onChange={(e) => void onFile(e)}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          {busy ? "Scanning…" : "Scan a bill"}
        </Button>
      </div>
      {message ? (
        <p
          role="status"
          data-testid="scan-message"
          className="text-sm text-muted-foreground border rounded-md p-3"
        >
          {message}
        </p>
      ) : null}
      {proposal ? (
        <div
          className="border rounded-md p-3 space-y-3"
          data-testid="scan-review"
        >
          <p className="text-sm font-medium">
            Scanned from photo — review before paying
          </p>
          <ul className="text-sm space-y-1">
            {proposal.billerCode ? (
              <li>
                {rail === "bill" ? "Biller" : "Network"}:{" "}
                <span className="font-medium">{proposal.billerCode}</span>
              </li>
            ) : null}
            {proposal.customerNumber ? (
              <li>
                {rail === "bill" ? "Meter / customer number" : "Phone"}:{" "}
                <span className="font-medium">{proposal.customerNumber}</span>
              </li>
            ) : null}
            {proposal.amountKobo !== undefined ? (
              <li>
                Amount on bill: {fmtNgnFromKobo(proposal.amountKobo)}{" "}
                <span className="text-muted-foreground">
                  (suggestion only — never filled automatically)
                </span>
              </li>
            ) : null}
          </ul>
          {proposal.amountKobo !== undefined ? (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="scan-amount-chip"
                onClick={() => {
                  if (proposal.amountKobo === undefined) return;
                  onAmountSuggestion(proposal.amountKobo / 100);
                }}
              >
                Use {fmtNgnFromKobo(proposal.amountKobo)} as the amount
              </Button>
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="scan-apply"
              onClick={onConfirmApply}
              disabled={!hasIdentifiers}
            >
              Apply
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="scan-dismiss"
              onClick={() => setProposal(null)}
            >
              Dismiss
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Nothing has been paid or saved — Apply fills the form for your
            review; you still validate and pay normally.
          </p>
        </div>
      ) : null}
    </div>
  );
}
