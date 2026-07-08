// @ts-check

/**
 * Sprint 63: Live Chat Support Widget & Admin Support Inbox Tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Sprint 63: Live Chat Support Widget & Admin Inbox", () => {
  // ── Chat Router Enhancement Tests ──────────────────────────────────────
  describe("Chat Router Admin Endpoints", () => {
    it("should have admin assignment endpoint structure", async () => {
      const { chatRouter } = await import("../../routers/chat");
      expect(chatRouter).toBeDefined();
      // Verify the router has all expected procedures
      const procedures = Object.keys(chatRouter._def.procedures);
      expect(procedures).toContain("startSession");
      expect(procedures).toContain("sendMessage");
      expect(procedures).toContain("getMessages");
      expect(procedures).toContain("listSessions");
      expect(procedures).toContain("closeSession");
      expect(procedures).toContain("adminListSessions");
      expect(procedures).toContain("adminGetMessages");
      expect(procedures).toContain("adminDeleteSession");
      expect(procedures).toContain("adminStats");
      expect(procedures).toContain("adminAssignSession");
      expect(procedures).toContain("adminReply");
      expect(procedures).toContain("adminEscalate");
      expect(procedures).toContain("adminResolve");
    });

    it("should have at least 13 procedures for full CRUD + admin ops", async () => {
      const { chatRouter } = await import("../../routers/chat");
      const procedures = Object.keys(chatRouter._def.procedures);
      expect(procedures.length).toBeGreaterThanOrEqual(13);
    });
  });

  // ── Socket.IO Chat Namespace Tests ─────────────────────────────────────
  describe("Socket.IO Chat Namespace", () => {
    it("should have chat namespace setup in socket.ts", async () => {
      // Verify the socket module exports exist
      const socketModule = await import("../../socket");
      expect(socketModule).toBeDefined();
      expect(typeof socketModule.initSocketIO).toBe("function");
    });
  });

  // ── Chat Session Schema Tests ──────────────────────────────────────────
  describe("Chat Schema", () => {
    it("should have chatSessions table with required columns", async () => {
      const schema = await import("../../../drizzle/schema");
      expect(schema.chatSessions).toBeDefined();
      // Verify key columns exist
      // chatSessions is a pgTable - check its column config
      const columns = Object.keys(
        (schema.chatSessions as any)?._ ?? schema.chatSessions
      );
      expect(columns).toContain("id");
      expect(columns).toContain("agentId");
      expect(columns).toContain("status");
      expect(columns).toContain("category");
      expect(columns).toContain("subject");
      expect(columns).toContain("supportAgentName");
    });

    it("should have chatMessages table with required columns", async () => {
      const schema = await import("../../../drizzle/schema");
      expect(schema.chatMessages).toBeDefined();
      const columns = Object.keys(schema.chatMessages);
      expect(columns).toContain("id");
      expect(columns).toContain("sessionId");
      expect(columns).toContain("senderType");
      expect(columns).toContain("senderName");
      expect(columns).toContain("content");
    });
  });

  // ── Admin Support Inbox Page Tests ─────────────────────────────────────
  describe("Admin Support Inbox Page", () => {
    it("should export a default component", async () => {
      // Verify the page module exists and exports default
      const fs = await import("fs");
      const path = require("path").resolve(
        __dirname,
        "../../../client/src/pages/AdminSupportInbox.tsx"
      );
      const exists = fs.existsSync(path);
      expect(exists).toBe(true);

      const content = fs.readFileSync(path, "utf-8");
      expect(content).toContain("export default function AdminSupportInbox");
      expect(content).toContain("DashboardLayout");
      expect(content).toContain("trpc.chat.adminListSessions");
      expect(content).toContain("trpc.chat.adminGetMessages");
      expect(content).toContain("trpc.chat.adminReply");
      expect(content).toContain("trpc.chat.adminAssignSession");
      expect(content).toContain("trpc.chat.adminEscalate");
      expect(content).toContain("trpc.chat.adminResolve");
      expect(content).toContain("trpc.chat.adminStats");
    });

    it("should have canned admin responses", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/pages/AdminSupportInbox.tsx"
        ),
        "utf-8"
      );
      expect(content).toContain("ADMIN_CANNED");
      expect(content).toContain("Greeting");
      expect(content).toContain("Investigating");
      expect(content).toContain("Escalating");
      expect(content).toContain("Resolved");
    });

    it("should have session status filters", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/pages/AdminSupportInbox.tsx"
        ),
        "utf-8"
      );
      expect(content).toContain("statusFilter");
      expect(content).toContain('"open"');
      expect(content).toContain('"assigned"');
      expect(content).toContain('"escalated"');
      expect(content).toContain('"resolved"');
    });

    it("should have assign and escalate dialogs", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/pages/AdminSupportInbox.tsx"
        ),
        "utf-8"
      );
      expect(content).toContain("showAssignDialog");
      expect(content).toContain("showEscalateDialog");
      expect(content).toContain("SUPPORT_AGENTS");
      expect(content).toContain("escalateReason");
    });
  });

  // ── Route Registration Tests ───────────────────────────────────────────
  describe("Route Registration", () => {
    it("should have admin-support-inbox route in App.tsx", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        require("path").resolve(__dirname, "../../../client/src/App.tsx"),
        "utf-8"
      );
      expect(content).toContain("/admin-support-inbox");
      expect(content).toContain("AdminSupportInbox");
    });

    it("should have Support Inbox in DashboardLayout navigation", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/components/DashboardLayout.tsx"
        ),
        "utf-8"
      );
      expect(content).toContain("Support Inbox");
      expect(content).toContain("/admin-support-inbox");
    });
  });

  // ── LiveChatWidget Tests ───────────────────────────────────────────────
  describe("LiveChatWidget", () => {
    it("should exist with AI-powered chat capabilities", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/components/LiveChatWidget.tsx"
        ),
        "utf-8"
      );
      expect(content).toContain("LiveChatWidget");
      // Should have escalation capability
      expect(content).toContain("escalat");
    });
  });

  // ── Socket Hook Tests ──────────────────────────────────────────────────
  describe("Chat Socket Hook", () => {
    it("should have useChatSocket hook", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        require("path").resolve(
          __dirname,
          "../../../client/src/hooks/useSocket.ts"
        ),
        "utf-8"
      );
      expect(content).toContain("useChatSocket");
      expect(content).toContain("chat:message");
      expect(content).toContain("chat:join");
    });
  });

  // ── Integration: Admin Reply via Socket.IO ─────────────────────────────
  describe("Admin Reply Socket.IO Integration", () => {
    it("should emit chat:message via Socket.IO in adminReply", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync(
        require("path").resolve(__dirname, "../../../server/routers/chat.ts"),
        "utf-8"
      );
      // adminReply should emit via Socket.IO
      expect(content).toContain('io.of("/chat")');
      expect(content).toContain("chat:message");
      expect(content).toContain("getIO");
    });
  });
});
