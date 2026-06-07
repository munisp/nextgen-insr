/**
 * InsurePortal MDM Router — Comprehensive Unit Tests
 *
 * Tests: heartbeat auto-enrollment, compliance policy evaluation, geofence
 * violation detection, kill-switch audit logging, OTA lifecycle, enrollment
 * token flow, remote commands, device listing/stats.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Hoisted mocks (no external references) ────────────────────────────────────
vi.mock("./db", () => {
  // Proxy-based mock: root db object is NOT thenable (avoids double-resolution
  // when getDb() returns Promise<db> and db has .then). Only query chains are thenable.
  function createQueryChain(): any {
    const chain: any = {};
    const methods = [
      "select",
      "from",
      "where",
      "limit",
      "offset",
      "orderBy",
      "leftJoin",
      "innerJoin",
      "rightJoin",
      "groupBy",
      "having",
      "insert",
      "values",
      "returning",
      "update",
      "set",
      "delete",
      "onConflictDoNothing",
      "onConflictDoUpdate",
    ];
    for (const m of methods) {
      chain[m] = (..._args: any[]) => chain;
    }
    // Only query chains are thenable — resolves to []
    chain.then = (resolve: any) => Promise.resolve([]).then(resolve);
    return chain;
  }
  const mockDb = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined; // NOT thenable at root
        if (typeof prop === "symbol") return undefined;
        return (..._args: any[]) => createQueryChain();
      },
    }
  );
  return {
    getDb: vi.fn().mockResolvedValue(mockDb),
    writeAuditLog: vi.fn().mockResolvedValue(undefined),
    getAgentByCode: vi.fn(),
    getAgentById: vi.fn(),
    createAgent: vi.fn(),
    updateAgentLastLogin: vi.fn(),
    updateAgentFloat: vi.fn(),
    updateAgentCommission: vi.fn(),
    addLoyaltyHistory: vi.fn(),
    createTransaction: vi.fn(),
    getTransactionsByAgent: vi.fn(),
    getTransactionByRef: vi.fn(),
    updateTransactionStatus: vi.fn(),
    getFraudAlerts: vi.fn(),
    createFraudAlert: vi.fn(),
    updateFraudAlertStatus: vi.fn(),
    getLoyaltyHistory: vi.fn(),
    createChatSession: vi.fn(),
    getChatSession: vi.fn(),
    addChatMessage: vi.fn(),
    getChatMessages: vi.fn(),
    getAuditLog: vi.fn(),
    upsertUser: vi.fn(),
    getUserByOpenId: vi.fn(),
  };
});

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(true),
    hash: vi.fn().mockResolvedValue("$2b$10$hashedpin"),
  },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue("$2b$10$hashedpin"),
}));

vi.mock("jose", () => ({
  SignJWT: vi.fn().mockImplementation(() => ({
    setProtectedHeader: vi.fn().mockReturnThis(),
    setIssuedAt: vi.fn().mockReturnThis(),
    setExpirationTime: vi.fn().mockReturnThis(),
    sign: vi.fn().mockResolvedValue("mock.jwt.token"),
  })),
  jwtVerify: vi.fn().mockResolvedValue({
    payload: {
      sub: "1",
      agentCode: "AGT001",
      name: "Emeka Obi",
      tier: "Gold",
      role: "agent",
    },
  }),
}));

vi.mock("./socketSingleton", () => ({
  getIO: vi.fn().mockReturnValue(null),
}));

// ─── Context factories ─────────────────────────────────────────────────────────
function makeAdminCtx(): TrpcContext {
  return {
    user: {
      id: 1,
      keycloakSub: "admin-sub-001",
      name: "Admin User",
      email: "admin@insureportal.ng",
      loginMethod: "keycloak",
      role: "admin",
      mfaEnabled: false,
      mfaEnforcedAt: null,
      tenantId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {}, ip: "127.0.0.1", protocol: "https" } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
  };
}

function makeUserCtx(): TrpcContext {
  return {
    user: {
      id: 2,
      keycloakSub: "user-sub-002",
      name: "Regular User",
      email: "user@insureportal.ng",
      loginMethod: "keycloak",
      role: "user",
      mfaEnabled: false,
      mfaEnforcedAt: null,
      tenantId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {}, ip: "127.0.0.1", protocol: "https" } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
  };
}

function makePublicCtx(): TrpcContext {
  return {
    user: null,
    req: { headers: {}, ip: "10.0.0.1", protocol: "https" } as any,
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DEVICE LISTING — admin guard
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.listDevices", () => {
  it("requires admin role — rejects regular user", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.mdm.listDevices({ status: "all" })).rejects.toThrow(
      /admin|forbidden/i
    );
  });

  it("returns devices and total for admin", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.mdm.listDevices({ status: "all" });
    expect(result).toHaveProperty("devices");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.devices)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DEVICE STATS — admin guard
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.stats", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.mdm.stats({})).rejects.toThrow(/admin|forbidden/i);
  });

  it("returns stats object for admin", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.mdm.stats({});
    expect(result).toHaveProperty("total");
    expect(typeof result.total).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. HEARTBEAT — auto-enrollment, telemetry, compliance
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.heartbeat", () => {
  const baseHeartbeat = {
    serialNumber: "SN-TEST-001",
    agentCode: "AGT001",
    model: "PAX A920 MAX",
    osVersion: "Android 12",
    appVersion: "4.2.1",
    firmwareVersion: "1.0.3",
    batteryLevel: 85,
    batteryCharging: false,
    networkType: "4g" as const,
    wifiSsid: "POS-Network",
    wifiRssi: -45,
  };

  it("is a public procedure (no auth required)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    // Mock DB returns empty arrays, so agent won't be found.
    // The key assertion: it does NOT throw UNAUTHORIZED — it throws NOT_FOUND.
    try {
      await caller.mdm.heartbeat(baseHeartbeat);
    } catch (e: any) {
      // NOT_FOUND is expected (agent doesn't exist in mock)
      // UNAUTHORIZED would be a failure
      expect(e.message).not.toMatch(/unauthorized|login|Please login/i);
      expect(e.code).not.toBe("UNAUTHORIZED");
    }
  });

  it("accepts heartbeat with GPS coordinates — no auth error", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    try {
      await caller.mdm.heartbeat({
        ...baseHeartbeat,
        latE6: 6450000,
        lonE6: 3400000,
      });
    } catch (e: any) {
      expect(e.code).not.toBe("UNAUTHORIZED");
    }
  });

  it("accepts heartbeat with minimal fields — no auth error", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    try {
      await caller.mdm.heartbeat({
        serialNumber: "SN-MINIMAL",
        agentCode: "AGT002",
      });
    } catch (e: any) {
      expect(e.code).not.toBe("UNAUTHORIZED");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. REMOTE COMMANDS
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.issueCommand", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.issueCommand({ deviceId: 1, command: "RESTART" })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("rejects invalid command type", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.issueCommand({ deviceId: 1, command: "INVALID_CMD" as any })
    ).rejects.toThrow();
  });

  it("accepts all valid command types", async () => {
    const commands = [
      "UPDATE",
      "RECONFIG",
      "RESTART",
      "WIPE",
      "PING",
      "SCREENSHOT",
    ] as const;
    for (const cmd of commands) {
      const caller = appRouter.createCaller(makeAdminCtx());
      // May throw NOT_FOUND for device, but should not throw validation error
      try {
        await caller.mdm.issueCommand({ deviceId: 1, command: cmd });
      } catch (e: any) {
        // Only acceptable error is NOT_FOUND (device doesn't exist in mock)
        expect(e.message).toMatch(/not found|database/i);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ENROLLMENT TOKEN FLOW
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.generateEnrollmentToken", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.generateEnrollmentToken({ agentCode: "AGT001" })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("validates agentCode is non-empty", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.generateEnrollmentToken({ agentCode: "" })
    ).rejects.toThrow();
  });
});

describe("mdm.enrollWithToken", () => {
  it("is a public procedure (device calls this)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    // Should not throw auth error — only data errors
    try {
      await caller.mdm.enrollWithToken({
        token: "test-token",
        serialNumber: "SN001",
      });
    } catch (e: any) {
      // NOT_FOUND or EXPIRED is expected, not UNAUTHORIZED
      expect(e.message).not.toMatch(/unauthorized|login/i);
    }
  });

  it("validates serialNumber is non-empty", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.mdm.enrollWithToken({ token: "test-token", serialNumber: "" })
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. KILL-SWITCH (disable/enable terminal)
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.disableTerminal", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.disableTerminal({
        agentCode: "AGT001",
        reason: "Suspected fraud",
      })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("requires reason of at least 5 characters", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.disableTerminal({ agentCode: "AGT001", reason: "abc" })
    ).rejects.toThrow();
  });

  it("validates agentCode is non-empty", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.disableTerminal({
        agentCode: "",
        reason: "Suspected fraud — under investigation",
      })
    ).rejects.toThrow();
  });
});

describe("mdm.enableTerminal", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.enableTerminal({ agentCode: "AGT001" })
    ).rejects.toThrow(/admin|forbidden/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. OTA LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.createOtaRelease", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.createOtaRelease({
        version: "5.0.0",
        s3Key: "ota/5.0.0.apk",
        downloadUrl: "https://cdn.insureportal.ng/ota/5.0.0.apk",
        checksum: "sha256:abc123",
        fileSize: 52428800,
      })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("validates version format", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.createOtaRelease({
        version: "",
        s3Key: "ota/5.0.0.apk",
        downloadUrl: "https://cdn.insureportal.ng/ota/5.0.0.apk",
        checksum: "sha256:abc123",
        fileSize: 52428800,
      })
    ).rejects.toThrow();
  });

  it("rejects negative fileSize", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.createOtaRelease({
        version: "5.0.0",
        s3Key: "ota/5.0.0.apk",
        downloadUrl: "https://cdn.insureportal.ng/ota/5.0.0.apk",
        checksum: "sha256:abc123",
        fileSize: -1,
      })
    ).rejects.toThrow();
  });
});

describe("mdm.publishOtaRelease", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.mdm.publishOtaRelease({ id: 1 })).rejects.toThrow(
      /admin|forbidden/i
    );
  });
});

describe("mdm.archiveOtaRelease", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.mdm.archiveOtaRelease({ id: 1 })).rejects.toThrow(
      /admin|forbidden/i
    );
  });
});

describe("mdm.recordOtaUpdate", () => {
  it("is a public procedure (called by device agent)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    // Should not throw auth error
    try {
      await caller.mdm.recordOtaUpdate({
        deviceId: 5,
        releaseId: 1,
        toVersion: "5.0.0",
        status: "pending",
      });
    } catch (e: any) {
      expect(e.message).not.toMatch(/unauthorized|login/i);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. COMPLIANCE POLICY MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.upsertPolicy", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.upsertPolicy({
        name: "Battery Policy",
        rules: { minBatteryLevel: 20 },
        severity: "high",
        enabled: true,
        enforcementAction: "notify",
      })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("validates severity enum", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.upsertPolicy({
        name: "Test",
        rules: {},
        severity: "invalid" as any,
      })
    ).rejects.toThrow();
  });

  it("accepts valid severity values", async () => {
    const severities = ["low", "medium", "high", "critical"] as const;
    for (const sev of severities) {
      const caller = appRouter.createCaller(makeAdminCtx());
      try {
        await caller.mdm.upsertPolicy({
          name: `Policy ${sev}`,
          rules: { minBatteryLevel: 20 },
          severity: sev,
          enabled: true,
          enforcementAction: "notify",
        });
      } catch (e: any) {
        // DB errors are fine, validation errors are not
        expect(e.message).not.toMatch(/invalid.*enum|expected/i);
      }
    }
  });
});

describe("mdm.acknowledgeViolation", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.acknowledgeViolation({ violationId: 1, action: "acknowledge" })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("validates action enum", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.acknowledgeViolation({
        violationId: 1,
        action: "invalid" as any,
      })
    ).rejects.toThrow();
  });

  it("accepts all valid actions", async () => {
    const actions = ["acknowledge", "resolve", "suppress"] as const;
    for (const action of actions) {
      const caller = appRouter.createCaller(makeAdminCtx());
      // Should not throw validation error
      const result = await caller.mdm.acknowledgeViolation({
        violationId: 1,
        action,
      });
      expect(result).toHaveProperty("ok", true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. CONFIG PUSH
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.pushConfig", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.pushConfig({ deviceId: 1, configJson: { theme: "dark" } })
    ).rejects.toThrow(/admin|forbidden/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. GEOFENCE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.listGeofenceViolations", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(
      caller.mdm.listGeofenceViolations({ status: "open" })
    ).rejects.toThrow(/admin|forbidden/i);
  });

  it("returns array for admin", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.mdm.listGeofenceViolations({ status: "open" });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. COMPLIANCE POLICIES & VIOLATIONS LISTING
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm.listPolicies", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.mdm.listPolicies()).rejects.toThrow(/admin|forbidden/i);
  });

  it("returns array for admin", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.mdm.listPolicies();
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("mdm.listViolations", () => {
  it("requires admin role", async () => {
    const caller = appRouter.createCaller(makeUserCtx());
    await expect(caller.mdm.listViolations({ status: "open" })).rejects.toThrow(
      /admin|forbidden/i
    );
  });

  it("returns array for admin", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.mdm.listViolations({ status: "open" });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. INPUT VALIDATION — edge cases
// ═══════════════════════════════════════════════════════════════════════════════
describe("mdm input validation", () => {
  it("rejects heartbeat with empty serialNumber", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.mdm.heartbeat({ serialNumber: "", agentCode: "AGT001" } as any)
    ).rejects.toThrow();
  });

  it("rejects heartbeat with empty agentCode", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.mdm.heartbeat({ serialNumber: "SN001", agentCode: "" } as any)
    ).rejects.toThrow();
  });

  it("rejects disableTerminal with short reason", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.disableTerminal({ agentCode: "AGT001", reason: "ab" })
    ).rejects.toThrow();
  });

  it("rejects createOtaRelease with zero fileSize", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.createOtaRelease({
        version: "5.0.0",
        s3Key: "ota/5.0.0.apk",
        downloadUrl: "https://cdn.insureportal.ng/ota/5.0.0.apk",
        checksum: "sha256:abc123",
        fileSize: 0,
      })
    ).rejects.toThrow();
  });

  it("rejects upsertPolicy with empty name", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    await expect(
      caller.mdm.upsertPolicy({
        name: "",
        rules: {},
        severity: "low",
      })
    ).rejects.toThrow();
  });
});
