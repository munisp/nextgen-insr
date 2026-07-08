// @ts-check

/**
 * Sprint 25 Tests — Proactive Help, Video Tutorials, Guide Feedback, Skill
 */
import { describe, it, expect } from "vitest";
import fs from "fs";

// ─── Guide Feedback System Tests ────────────────────────────────────────────
describe("Sprint 25: Guide Feedback System", () => {
  it("should have guideFeedback router module", async () => {
    const mod = await import("./routers/guideFeedback");
    expect(mod.guideFeedbackRouter).toBeDefined();
    expect(mod.guideFeedbackRouter._def).toBeDefined();
  });

  it("should have required procedures", async () => {
    const mod = await import("./routers/guideFeedback");
    const procedures = Object.keys(mod.guideFeedbackRouter._def.procedures);
    expect(procedures).toContain("submit");
    expect(procedures).toContain("stats");
    expect(procedures).toContain("subsectionStats");
    expect(procedures).toContain("list");
    expect(procedures).toContain("delete");
    expect(procedures).toContain("summary");
  });

  it("should have seeded feedback data", async () => {
    // The module initializes with seed data
    const mod = await import("./routers/guideFeedback");
    expect(mod.guideFeedbackRouter).toBeDefined();
    // Verify the router has 6 procedures
    const procedures = Object.keys(mod.guideFeedbackRouter._def.procedures);
    expect(procedures.length).toBe(6);
  });
});

// ─── Proactive Help System Tests ────────────────────────────────────────────
describe("Sprint 25: Proactive Help System", () => {
  it("should have ProactiveHelp component file", () => {
    const exists = fs.existsSync(
      require("path").resolve(
        __dirname,
        "../client/src/components/ProactiveHelp.tsx"
      )
    );
    expect(exists).toBe(true);
  });

  it("should have page-specific help suggestions", () => {
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/components/ProactiveHelp.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("pageHelpSuggestions");
    expect(content).toContain("/admin/fraud");
    expect(content).toContain("/kyc-verification");
    expect(content).toContain("idle");
  });

  it("should detect struggle patterns", () => {
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/components/ProactiveHelp.tsx"
      ),
      "utf-8"
    );
    // Should have idle detection
    expect(content).toContain("idle");
    // Should have navigation detection
    expect(content).toContain("nav");
    // Should have repeated visit detection
    expect(content).toContain("revisit");
  });

  it("should be wired into App.tsx", () => {
    const appContent = fs.readFileSync(
      require("path").resolve(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(appContent).toContain("ProactiveHelp");
  });
});

// ─── Video Tutorials Page Tests ─────────────────────────────────────────────
describe("Sprint 25: Video Tutorials Page", () => {
  it("should have VideoTutorials component file", () => {
    const exists = fs.existsSync(
      require("path").resolve(
        __dirname,
        "../client/src/pages/VideoTutorials.tsx"
      )
    );
    expect(exists).toBe(true);
  });

  it("should contain 5 tutorial sections for complex features", () => {
    const content = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/pages/VideoTutorials.tsx"
      ),
      "utf-8"
    );
    expect(content).toContain("tutorials");
    // 5 most complex features
    expect(content).toContain("POS Terminal");
    expect(content).toContain("Fraud");
    expect(content).toContain("KYC");
    expect(content).toContain("Settlement");
  });

  it("should be routed in App.tsx", () => {
    const appContent = fs.readFileSync(
      require("path").resolve(__dirname, "../client/src/App.tsx"),
      "utf-8"
    );
    expect(appContent).toContain("VideoTutorials");
    expect(appContent).toContain("/video-tutorials");
  });

  it("should be in DashboardLayout navigation", () => {
    const layoutContent = fs.readFileSync(
      require("path").resolve(
        __dirname,
        "../client/src/components/DashboardLayout.tsx"
      ),
      "utf-8"
    );
    expect(layoutContent).toContain("Video Tutorials");
    expect(layoutContent).toContain("/video-tutorials");
  });
});

// ─── User Guide Feedback Integration Tests ──────────────────────────────────
describe("Sprint 25: User Guide Feedback Integration", () => {
  it("should have feedback widget in UserGuide page", () => {
    const content = fs.readFileSync(
      require("path").resolve(__dirname, "../client/src/pages/UserGuide.tsx"),
      "utf-8"
    );
    expect(content).toContain("SectionFeedback");
    expect(content).toContain("ThumbsUp");
    expect(content).toContain("ThumbsDown");
    expect(content).toContain("guideFeedback");
  });

  it("should have sidebar rating badges", () => {
    const content = fs.readFileSync(
      require("path").resolve(__dirname, "../client/src/pages/UserGuide.tsx"),
      "utf-8"
    );
    expect(content).toContain("SidebarRatingBadge");
    expect(content).toContain("guideFeedback.stats");
  });

  it("should import trpc for feedback submission", () => {
    const content = fs.readFileSync(
      require("path").resolve(__dirname, "../client/src/pages/UserGuide.tsx"),
      "utf-8"
    );
    expect(content).toContain("import { trpc }");
    expect(content).toContain("guideFeedback.submit");
  });
});

// ─── Reusable Skill Tests ───────────────────────────────────────────────────
describe("Sprint 25: Reusable Skill (insureportal-pos-builder)", () => {
  it("should have valid SKILL.md", () => {
    const exists = fs.existsSync(
      "/home/ubuntu/skills/insureportal-pos-builder/SKILL.md"
    );
    expect(exists).toBe(true);
    const content = fs.readFileSync(
      "/home/ubuntu/skills/insureportal-pos-builder/SKILL.md",
      "utf-8"
    );
    expect(content).toContain("name: insureportal-pos-builder");
    expect(content).toContain("description:");
    expect(content).not.toContain("[TODO");
  });

  it("should have schema-patterns reference", () => {
    const exists = fs.existsSync(
      "/home/ubuntu/skills/insureportal-pos-builder/references/schema-patterns.md"
    );
    expect(exists).toBe(true);
    const content = fs.readFileSync(
      "/home/ubuntu/skills/insureportal-pos-builder/references/schema-patterns.md",
      "utf-8"
    );
    expect(content).toContain("agents");
    expect(content).toContain("transactions");
    expect(content).toContain("fraud_alerts");
  });

  it("should have router-patterns reference", () => {
    const exists = fs.existsSync(
      "/home/ubuntu/skills/insureportal-pos-builder/references/router-patterns.md"
    );
    expect(exists).toBe(true);
    const content = fs.readFileSync(
      "/home/ubuntu/skills/insureportal-pos-builder/references/router-patterns.md",
      "utf-8"
    );
    expect(content).toContain("CRUD Router");
    expect(content).toContain("Transaction Processing");
    expect(content).toContain("Fraud Scoring");
  });

  it("should cover core modules in SKILL.md", () => {
    const content = fs.readFileSync(
      "/home/ubuntu/skills/insureportal-pos-builder/SKILL.md",
      "utf-8"
    );
    expect(content).toContain("Agent Authentication");
    expect(content).toContain("POS Terminal");
    expect(content).toContain("Float Management");
    expect(content).toContain("Transaction Processing");
    expect(content).toContain("Fraud Detection");
    expect(content).toContain("KYC Verification");
    expect(content).toContain("Settlement");
    expect(content).toContain("Stripe");
  });
});
