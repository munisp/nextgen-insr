/**
 * ProactiveHelp — Detects user struggle patterns and proactively offers help
 *
 * Now deeply integrated with LiveChatWidget:
 * - When struggle is detected, offers to open chat with pre-filled context
 * - Sends the current page context and detected issue to the AI assistant
 * - Dispatches custom events that LiveChatWidget listens for
 *
 * Heuristics:
 * - Long idle time on a page (>45s without interaction)
 * - Rapid page navigation (>4 navigations in 10s = "thrashing")
 * - Multiple visits to the same page in a short window
 * - Error toast detection (monitors for error events)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  HelpCircle,
  X,
  MessageCircle,
  BookOpen,
  Lightbulb,
  Zap,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Custom Event for Chat Integration ──────────────────────────────────────
// LiveChatWidget listens for this event to auto-open with context
export function dispatchProactiveChat(context: {
  page: string;
  issue: string;
  suggestions: string[];
}) {
  window.dispatchEvent(
    new CustomEvent("proactive-help-chat", { detail: context })
  );
}

// ─── Page-Specific Help Suggestions ─────────────────────────────────────────
const pageHelpSuggestions: Record<
  string,
  { title: string; tips: string[]; guideLink?: string; chatPrompt?: string }
> = {
  "/": {
    title: "Insurance Service Help",
    tips: [
      "Enter your Agent Code (e.g., AGT001) and PIN to log in",
      "Use the PIN pad to enter your 4-digit PIN",
      "If you forgot your PIN, click 'Forgot PIN?' below the login form",
    ],
    guideLink: "/user-guide",
    chatPrompt:
      "I need help logging into the insurance service. Can you walk me through the login process?",
  },
  "/hub": {
    title: "Platform Hub",
    tips: [
      "The Hub is your central navigation point — click any portal card to enter",
      "Use Ctrl+K to quickly search for any feature or page",
      "Your recent activity and quick stats are shown on the dashboard",
    ],
    guideLink: "/user-guide",
    chatPrompt:
      "I'm on the Platform Hub and need help navigating to the right section.",
  },
  "/admin": {
    title: "Admin Panel Help",
    tips: [
      "Use the sidebar tabs to navigate between Overview, Fraud, Audit, Analytics, and Agents",
      "Click 'Run Settlement Now' in Overview to trigger manual settlement",
      "Export transaction data as CSV from the Analytics tab",
    ],
    guideLink: "/user-guide",
    chatPrompt:
      "I need help with the Admin Panel. Can you explain the available features?",
  },
  "/admin/fraud": {
    title: "Fraud Dashboard Help",
    tips: [
      "Critical alerts appear at the top — review and action them first",
      "Click an alert to see full details and AI analysis",
      "Use 'Escalate', 'Snooze', or 'Resolve' to manage each alert",
    ],
    guideLink: "/user-guide",
    chatPrompt:
      "I need help managing fraud alerts. How do I review and resolve them?",
  },
  "/kyc-verification": {
    title: "KYC Verification Help",
    tips: [
      "Upload identity documents (NIN, BVN, or Passport) in the submission form",
      "Documents are reviewed within 24-48 hours for standard processing",
      "Use 'Fast-Track' option for priority 24-hour verification",
    ],
    guideLink: "/user-guide",
    chatPrompt:
      "I need help with KYC verification. What documents do I need and how do I submit them?",
  },
  "/commission-payouts": {
    title: "Commission Payouts Help",
    tips: [
      "View your earned commissions by date range",
      "Commissions are automatically calculated per transaction type",
      "Payouts are processed during daily settlement at 5:00 PM WAT",
    ],
    chatPrompt:
      "I have questions about my commission payouts. Can you help me understand how they work?",
  },
  "/settlement-reconciliation": {
    title: "Settlement Help",
    tips: [
      "Reconciliation runs automatically at end of day",
      "Discrepancies are flagged for manual review",
      "Click any settlement record to see the full breakdown",
    ],
    chatPrompt:
      "I need help understanding the settlement reconciliation process.",
  },
  "/payments": {
    title: "Payments & Subscriptions",
    tips: [
      "Choose a subscription plan that fits your transaction volume",
      "Use test card 4242 4242 4242 4242 for testing payments",
      "View your payment history and active subscription status below",
    ],
    chatPrompt:
      "I need help with payments and subscriptions. Which plan should I choose?",
  },
  "/weekly-reports": {
    title: "Weekly Reports Help",
    tips: [
      "Reports are generated every Monday for the previous week",
      "Use the comparison tool to compare any two reports side-by-side",
      "Download reports as PDF for offline review",
    ],
    chatPrompt:
      "I need help understanding my weekly reports. Can you walk me through the metrics?",
  },
  "/notification-inbox": {
    title: "Notification Inbox Help",
    tips: [
      "Filter notifications by channel (email, SMS, push, in-app)",
      "Star important notifications for quick access later",
      "Critical alerts are highlighted in red — review them promptly",
    ],
    chatPrompt:
      "I need help managing my notifications. How do I filter and prioritize them?",
  },
};

// Default help for pages without specific suggestions
const defaultHelp = {
  title: "Need Help?",
  tips: [
    "Press Ctrl+K to search for any feature or page",
    "Visit the User Guide for step-by-step walkthroughs",
    "Click the chat bubble to talk with our AI assistant",
  ],
  guideLink: "/user-guide",
  chatPrompt: "I need help navigating the platform. Can you assist me?",
};

// ─── Struggle Detection Config ──────────────────────────────────────────────
const IDLE_THRESHOLD_MS = 45000;
const THRASH_WINDOW_MS = 10000;
const THRASH_COUNT = 4;
const REVISIT_WINDOW_MS = 30000;
const REVISIT_COUNT = 3;
const COOLDOWN_MS = 120000;

// ═══════════════════════════════════════════════════════════════════════════════
export function ProactiveHelp() {
  const [showPopup, setShowPopup] = useState(false);
  const [triggerReason, setTriggerReason] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [quickActions, setQuickActions] = useState<string[]>([]);
  const [location, navigate] = useLocation();

  // Tracking refs
  const lastActivityRef = useRef(Date.now());
  const navHistoryRef = useRef<{ path: string; time: number }[]>([]);
  const lastOfferRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Get help content for current page
  const helpContent = pageHelpSuggestions[location] || defaultHelp;

  // Reset activity timer on user interaction
  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      const now = Date.now();
      if (now - lastOfferRef.current > COOLDOWN_MS && !dismissed) {
        setTriggerReason("You've been on this page for a while");
        setQuickActions([
          "Show me how to use this page",
          "I'm looking for something else",
        ]);
        setShowPopup(true);
        lastOfferRef.current = now;
      }
    }, IDLE_THRESHOLD_MS);
  }, [dismissed]);

  // Track user activity events
  useEffect(() => {
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach(e =>
      window.addEventListener(e, resetActivity, { passive: true })
    );
    resetActivity();
    return () => {
      events.forEach(e => window.removeEventListener(e, resetActivity));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetActivity]);

  // Track navigation patterns
  useEffect(() => {
    const now = Date.now();
    navHistoryRef.current.push({ path: location, time: now });
    navHistoryRef.current = navHistoryRef.current.filter(
      entry => now - entry.time < Math.max(THRASH_WINDOW_MS, REVISIT_WINDOW_MS)
    );

    const recentNavs = navHistoryRef.current.filter(
      entry => now - entry.time < THRASH_WINDOW_MS
    );
    if (
      recentNavs.length >= THRASH_COUNT &&
      now - lastOfferRef.current > COOLDOWN_MS &&
      !dismissed
    ) {
      setTriggerReason("You seem to be looking for something");
      setQuickActions(["Help me find what I need", "Show me the site map"]);
      setShowPopup(true);
      lastOfferRef.current = now;
      return;
    }

    const revisits = navHistoryRef.current.filter(
      entry => entry.path === location && now - entry.time < REVISIT_WINDOW_MS
    );
    if (
      revisits.length >= REVISIT_COUNT &&
      now - lastOfferRef.current > COOLDOWN_MS &&
      !dismissed
    ) {
      setTriggerReason("You've visited this page multiple times");
      setQuickActions([
        "I'm having trouble with this page",
        "Walk me through the steps",
      ]);
      setShowPopup(true);
      lastOfferRef.current = now;
    }

    setDismissed(false);
    setShowPopup(false);
  }, [location, dismissed]);

  const handleDismiss = () => {
    setShowPopup(false);
    setDismissed(true);
    lastOfferRef.current = Date.now();
  };

  // ─── Deep Chat Integration ──────────────────────────────────────────────────
  const handleOpenChatWithContext = (customMessage?: string) => {
    setShowPopup(false);
    setDismissed(true);

    // Dispatch event to LiveChatWidget with full context
    dispatchProactiveChat({
      page: location,
      issue: customMessage || helpContent.chatPrompt || triggerReason,
      suggestions: helpContent.tips,
    });

    // Also try to click the chat widget button as fallback
    setTimeout(() => {
      const chatBtn = document.querySelector(
        '[data-chat-toggle="true"]'
      ) as HTMLButtonElement;
      if (chatBtn) chatBtn.click();
    }, 100);
  };

  const handleQuickAction = (action: string) => {
    handleOpenChatWithContext(action);
  };

  const handleOpenGuide = () => {
    setShowPopup(false);
    setDismissed(true);
    navigate(helpContent.guideLink || "/user-guide");
  };

  if (!showPopup) return null;

  return (
    <div
      className={cn(
        "fixed bottom-24 right-6 z-[49] w-[340px] rounded-xl border border-primary/30 bg-background shadow-xl",
        "animate-in slide-in-from-bottom-4 fade-in duration-300"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary/5 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Lightbulb className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">{helpContent.title}</p>
            <p className="text-[10px] text-muted-foreground">{triggerReason}</p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="h-6 w-6 rounded-md hover:bg-muted flex items-center justify-center"
        >
          <X className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </div>

      {/* Tips */}
      <div className="p-4 space-y-2">
        {helpContent.tips.map((tip, i) => (
          <div key={i} className="flex items-start gap-2">
            <HelpCircle className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {tip}
            </p>
          </div>
        ))}
      </div>

      {/* Quick Actions — sent directly to chat */}
      {quickActions.length > 0 && (
        <div className="px-4 pb-2 space-y-1.5">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Quick Actions
          </p>
          {quickActions.map((action, i) => (
            <button
              key={i}
              onClick={() => handleQuickAction(action)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted text-xs text-foreground transition-colors"
            >
              <span className="flex items-center gap-2">
                <Zap className="h-3 w-3 text-amber-500" />
                {action}
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {/* Primary Actions */}
      <div className="flex items-center gap-2 px-4 pb-4 pt-2">
        <Button
          size="sm"
          variant="default"
          className="flex-1 text-xs h-8"
          onClick={() => handleOpenChatWithContext()}
        >
          <MessageCircle className="h-3 w-3 mr-1" />
          Chat with AI
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 text-xs h-8"
          onClick={handleOpenGuide}
        >
          <BookOpen className="h-3 w-3 mr-1" />
          User Guide
        </Button>
      </div>
    </div>
  );
}

export default ProactiveHelp;
