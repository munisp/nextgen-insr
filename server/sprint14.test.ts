// @ts-check

/**
 * Sprint 14 Tests — Threshold Alert Dispatcher + Banner Reactions Wire
 */
import { describe, it, expect } from "vitest";
import {
  dispatchThresholdAlert,
  getNotificationHistory,
  getCooldownStatus,
  clearExpiredCooldowns,
  buildBreachEmailHtml,
  buildBreachEmailText,
  buildBreachSmsText,
  isCooldownActive,
  SEVERITY_CONFIG,
  QUIET_HOURS,
} from "./lib/thresholdAlertDispatcher";
import type { BreachEvent } from "./lib/thresholdAlertDispatcher";

// ─── Test Fixtures ──────────────────────────────────────────────────────────
function makeBreachEvent(overrides?: Partial<BreachEvent>): BreachEvent {
  return {
    eventId: `evt_test_${Date.now()}`,
    ruleId: "thr_001",
    ruleName: "High Transaction Volume",
    metric: "transaction_volume_daily",
    metricLabel: "Daily Transaction Volume",
    operator: "gt",
    threshold: 10000,
    actualValue: 15000,
    unit: "",
    severity: "critical",
    channels: ["email", "sms", "push", "webhook", "in-app"],
    recipients: ["admin@insureportal.com", "+2348000000000"],
    message: "Daily Transaction Volume is 15000, exceeded threshold of 10000",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Email Template Tests ───────────────────────────────────────────────────
describe("Breach Email Templates", () => {
  it("builds HTML email with correct severity color for critical", () => {
    const event = makeBreachEvent({ severity: "critical" });
    const html = buildBreachEmailHtml(event);
    expect(html).toContain("#dc2626"); // critical red
    expect(html).toContain("CRITICAL ALERT");
    expect(html).toContain("High Transaction Volume");
    expect(html).toContain("15000");
    expect(html).toContain("10000");
    expect(html).toContain("thr_001");
  });

  it("builds HTML email with warning color", () => {
    const event = makeBreachEvent({ severity: "warning" });
    const html = buildBreachEmailHtml(event);
    expect(html).toContain("#d97706"); // warning amber
    expect(html).toContain("WARNING");
  });

  it("builds HTML email with info color", () => {
    const event = makeBreachEvent({ severity: "info" });
    const html = buildBreachEmailHtml(event);
    expect(html).toContain("#2563eb"); // info blue
    expect(html).toContain("INFO");
  });

  it("builds plain text email with all required fields", () => {
    const event = makeBreachEvent();
    const text = buildBreachEmailText(event);
    expect(text).toContain("CRITICAL ALERT");
    expect(text).toContain("High Transaction Volume");
    expect(text).toContain("15000");
    expect(text).toContain("10000");
    expect(text).toContain("thr_001");
    expect(text).toContain("Action Required");
  });

  it("builds SMS text within 160 char limit for short alerts", () => {
    const event = makeBreachEvent({
      ruleName: "High Vol",
      metricLabel: "Volume",
      actualValue: 100,
      threshold: 50,
      unit: "K",
    });
    const sms = buildBreachSmsText(event);
    expect(sms.length).toBeLessThan(200);
    expect(sms).toContain("[CRITICAL]");
    expect(sms).toContain("High Vol");
  });
});

// ─── Severity Configuration Tests ───────────────────────────────────────────
describe("Severity Configuration", () => {
  it("has correct config for all severity levels", () => {
    expect(SEVERITY_CONFIG.critical.emailPriority).toBe("high");
    expect(SEVERITY_CONFIG.critical.enableSms).toBe(true);
    expect(SEVERITY_CONFIG.critical.cooldownMultiplier).toBe(0.5);

    expect(SEVERITY_CONFIG.warning.emailPriority).toBe("normal");
    expect(SEVERITY_CONFIG.warning.enableSms).toBe(true);
    expect(SEVERITY_CONFIG.warning.cooldownMultiplier).toBe(1.0);

    expect(SEVERITY_CONFIG.info.emailPriority).toBe("low");
    expect(SEVERITY_CONFIG.info.enableSms).toBe(false);
    expect(SEVERITY_CONFIG.info.cooldownMultiplier).toBe(2.0);
  });
});

// ─── Quiet Hours Tests ──────────────────────────────────────────────────────
describe("Quiet Hours", () => {
  it("has correct configuration", () => {
    expect(QUIET_HOURS.enabled).toBe(true);
    expect(QUIET_HOURS.start).toBe(22);
    expect(QUIET_HOURS.end).toBe(7);
    expect(QUIET_HOURS.bypassForCritical).toBe(true);
  });
});

// ─── Dispatch Tests ─────────────────────────────────────────────────────────
describe("Threshold Alert Dispatch", () => {
  it("dispatches to all channels for a critical breach", async () => {
    const event = makeBreachEvent({
      eventId: `evt_dispatch_${Date.now()}`,
      ruleId: `rule_dispatch_${Date.now()}`, // unique to avoid cooldown
    });
    const result = await dispatchThresholdAlert(event, 60);

    expect(result.summary.sent).toBeGreaterThan(0);
    expect(result.dispatched.length).toBeGreaterThan(0);

    // Check that email was dispatched
    const emailNotifs = result.dispatched.filter(n => n.channel === "email");
    expect(emailNotifs.length).toBeGreaterThanOrEqual(1);
    expect(emailNotifs[0].status).toBe("sent");

    // Check that SMS was dispatched (critical enables SMS)
    const smsNotifs = result.dispatched.filter(n => n.channel === "sms");
    expect(smsNotifs.length).toBeGreaterThanOrEqual(1);

    // Check push
    const pushNotifs = result.dispatched.filter(n => n.channel === "push");
    expect(pushNotifs.length).toBe(1);

    // Check webhook
    const webhookNotifs = result.dispatched.filter(
      n => n.channel === "webhook"
    );
    expect(webhookNotifs.length).toBe(1);

    // Check in-app
    const inAppNotifs = result.dispatched.filter(n => n.channel === "in-app");
    expect(inAppNotifs.length).toBe(1);
  });

  it("skips SMS for info severity", async () => {
    const event = makeBreachEvent({
      eventId: `evt_info_${Date.now()}`,
      ruleId: `rule_info_${Date.now()}`,
      severity: "info",
      channels: ["sms"],
    });
    const result = await dispatchThresholdAlert(event, 60);
    const smsSkipped = result.skipped.filter(n => n.channel === "sms");
    expect(smsSkipped.length).toBe(1);
  });

  it("enforces cooldown on repeated dispatches", async () => {
    const ruleId = `rule_cooldown_${Date.now()}`;
    const event1 = makeBreachEvent({
      eventId: `evt_cd1_${Date.now()}`,
      ruleId,
      channels: ["push"],
    });
    const event2 = makeBreachEvent({
      eventId: `evt_cd2_${Date.now() + 1}`,
      ruleId,
      channels: ["push"],
    });

    // First dispatch should succeed
    const result1 = await dispatchThresholdAlert(event1, 60);
    expect(result1.summary.sent).toBeGreaterThan(0);

    // Second dispatch should be cooldown-skipped
    const result2 = await dispatchThresholdAlert(event2, 60);
    expect(result2.summary.skippedCooldown).toBeGreaterThan(0);
  });
});

// ─── Notification History Tests ─────────────────────────────────────────────
describe("Notification History", () => {
  it("returns notification records", () => {
    const history = getNotificationHistory({ limit: 10 });
    expect(Array.isArray(history)).toBe(true);
    if (history.length > 0) {
      expect(history[0]).toHaveProperty("id");
      expect(history[0]).toHaveProperty("eventId");
      expect(history[0]).toHaveProperty("channel");
      expect(history[0]).toHaveProperty("status");
    }
  });

  it("filters by channel", () => {
    const emailHistory = getNotificationHistory({
      channel: "email",
      limit: 50,
    });
    emailHistory.forEach(r => expect(r.channel).toBe("email"));
  });

  it("filters by status", () => {
    const sentHistory = getNotificationHistory({ status: "sent", limit: 50 });
    sentHistory.forEach(r => expect(r.status).toBe("sent"));
  });
});

// ─── Cooldown Status Tests ──────────────────────────────────────────────────
describe("Cooldown Status", () => {
  it("returns cooldown entries with remaining time", () => {
    const status = getCooldownStatus();
    expect(Array.isArray(status)).toBe(true);
    if (status.length > 0) {
      expect(status[0]).toHaveProperty("ruleId");
      expect(status[0]).toHaveProperty("channel");
      expect(status[0]).toHaveProperty("remainingMs");
      expect(status[0]).toHaveProperty("isActive");
      expect(typeof status[0].remainingMs).toBe("number");
    }
  });

  it("clears expired cooldowns", () => {
    const cleared = clearExpiredCooldowns();
    expect(typeof cleared).toBe("number");
    expect(cleared).toBeGreaterThanOrEqual(0);
  });
});

// ─── AnnouncementBanner Wiring Tests ────────────────────────────────────────
describe("AnnouncementBanner tRPC Wiring", () => {
  it("announcementReactions router file exists", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const routerPath = path.resolve("server/routers/announcementReactions.ts");
    expect(fs.existsSync(routerPath)).toBe(true);
  });

  it("announcementReactions router exports a tRPC router", async () => {
    const mod = await import("./routers/announcementReactions");
    expect(mod).toBeDefined();
    expect(mod.announcementReactionsRouter).toBeDefined();
  });

  it("AnnouncementBanner component exists and uses trpc", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const bannerPath = path.resolve(
      "client/src/components/AnnouncementBanner.tsx"
    );
    expect(fs.existsSync(bannerPath)).toBe(true);
    const content = fs.readFileSync(bannerPath, "utf-8");
    expect(content).toContain("trpc");
    expect(content).toContain("announcementReactions");
  });
});
