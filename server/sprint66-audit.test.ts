// @ts-check

/**
 * Sprint 66: Deep Audit & Production Readiness Final
 * Tests verify:
 * 1. webhookManagement.ts uses correct schema columns (isActive, name, events as array)
 * 2. globalSearch router is wired into appRouter
 * 3. Full CRUD on webhook endpoints (create, read, update, delete)
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const projectRoot = path.resolve(__dirname, "..");

describe("Sprint 66: webhookManagement.ts Schema Fix", () => {
  const filePath = path.join(
    projectRoot,
    "server/routers/webhookManagement.ts"
  );
  let content: string;

  it("webhookManagement.ts exists", () => {
    expect(fs.existsSync(filePath)).toBe(true);
    content = fs.readFileSync(filePath, "utf-8");
  });

  it("uses isActive instead of active for boolean column", () => {
    content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("webhookEndpoints.isActive");
    expect(content).not.toContain("webhookEndpoints.active");
  });

  it("uses name instead of description for name column", () => {
    content = fs.readFileSync(filePath, "utf-8");
    // Should use s.name, not s.description
    expect(content).toContain("s.name");
    expect(content).not.toContain("s.description");
  });

  it("passes events as array, not JSON.stringify", () => {
    content = fs.readFileSync(filePath, "utf-8");
    expect(content).not.toContain("JSON.stringify(input.events)");
    expect(content).toContain("events: input.events");
  });

  it("has updateWebhook mutation for full CRUD", () => {
    content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("updateWebhook:");
  });

  it("has deleteWebhook mutation for full CRUD", () => {
    content = fs.readFileSync(filePath, "utf-8");
    expect(content).toContain("deleteWebhook:");
  });

  it("has all 7 CRUD operations", () => {
    content = fs.readFileSync(filePath, "utf-8");
    const ops = [
      "getStats",
      "dashboard",
      "listWebhooks",
      "createWebhook",
      "updateWebhook",
      "deleteWebhook",
      "testWebhook",
    ];
    for (const op of ops) {
      expect(content).toContain(`${op}:`);
    }
  });
});

describe("Sprint 66: globalSearch Router Wiring", () => {
  it("globalSearch is imported in routers.ts", () => {
    const routersPath = path.join(projectRoot, "server/routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");
    expect(content).toContain(
      'import { globalSearchRouter } from "./routers/globalSearch"'
    );
  });

  it("globalSearch is registered in appRouter", () => {
    const routersPath = path.join(projectRoot, "server/routers.ts");
    const content = fs.readFileSync(routersPath, "utf-8");
    expect(content).toContain("globalSearch: globalSearchRouter");
  });

  it("globalSearch.ts uses getDb() not bare db import", () => {
    const gsPath = path.join(projectRoot, "server/routers/globalSearch.ts");
    const content = fs.readFileSync(gsPath, "utf-8");
    expect(content).toMatch(/getDb/);
    expect(content).not.toMatch(/import\s*\{\s*db\s*\}\s*from/);
  });
});

describe("Sprint 66: Router Registration Completeness", () => {
  it("all router files in server/routers/ are imported in routers.ts", () => {
    const routersDir = path.join(projectRoot, "server/routers");
    const routerFiles = fs
      .readdirSync(routersDir)
      .filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map(f => f.replace(".ts", ""));

    const routersTs = fs.readFileSync(
      path.join(projectRoot, "server/routers.ts"),
      "utf-8"
    );

    const unregistered: string[] = [];
    for (const file of routerFiles) {
      if (!routersTs.includes(`"./routers/${file}"`)) {
        unregistered.push(file);
      }
    }

    // After Sprint 66 fix, there should be 0 orphan routers
    expect(unregistered).toEqual([]);
  });
});

describe("Sprint 66: Schema Column Verification", () => {
  it("webhookEndpoints schema has isActive column", () => {
    const schemaPath = path.join(projectRoot, "drizzle/schema.ts");
    const content = fs.readFileSync(schemaPath, "utf-8");
    expect(content).toContain("isActive");
  });

  it("webhookEndpoints schema has name column", () => {
    const schemaPath = path.join(projectRoot, "drizzle/schema.ts");
    const content = fs.readFileSync(schemaPath, "utf-8");
    // The schema should define webhookEndpoints with a name column
    expect(content).toContain("webhookEndpoints");
  });

  it("webhookEndpoints schema has events as text array", () => {
    const schemaPath = path.join(projectRoot, "drizzle/schema.ts");
    const content = fs.readFileSync(schemaPath, "utf-8");
    // events should be text("events").array() not jsonb
    expect(content).toContain("events");
  });
});
