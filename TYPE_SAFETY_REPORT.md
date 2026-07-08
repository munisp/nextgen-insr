# TypeScript Type Safety Analysis Report


╔═══════════════════════════════════════════════════════════╗
║           TypeScript Type Safety Analysis Report          ║
╚═══════════════════════════════════════════════════════════╝

📊 Summary:
  • Total files analyzed: 760
  • Files with @ts-check: 760 (100%)
  • Files without @ts-check: 0 (0%)
  • Total 'as any' usages: 633
  • Console log statements: 60
  • Files fixed: 0

🔴 Critical Issues:
  • 640+ 'as any' usages found (type safety compromised)
  • 647+ files missing @ts-check (unchecked type drift)
  • 60 console.log statements (logging inconsistency)

💡 Recommendations:
  1. Enable strict ESLint rules for TypeScript
  2. Replace 'as any' with proper type definitions
  3. Add @ts-check to all files (automated fix available)
  4. Replace console.log with structured logger
  5. Enable CI checks for type safety

📝 Top Files by 'as any' Count:
  • server/routers/transactions.ts: 34 usages
  • server/routers/dynamicFeeEngine.ts: 21 usages
  • server/routers/commissionEngine.ts: 19 usages
  • server/routers/commissionClawback.ts: 14 usages
  • server/sprint46.test.ts: 14 usages
  • server/routers/disputeWorkflowEngine.ts: 13 usages
  • server/middleware/securityOrchestrator.ts: 12 usages
  • server/lib/realtimeNotifications.ts: 11 usages
  • server/mdm.test.ts: 11 usages
  • server/_core/kycClient.ts: 10 usages

## Detailed Findings

### server/_core/index.ts

9 'as any' usages found:

- Line 97: `logger.warn("[Shutdown] Setup failed:: " + (e as any).message);`
- Line 105: `logger.warn("[DBPool] Monitor failed:: " + (e as any).message);`
- Line 120: `logger.warn("[Cron] Registration failed:: " + (e as any).message);`
- Line 339: `logger.warn("[Security] Middleware load failed (non-fatal):: " + (secErr as any).message`
- Line 348: `logger.warn("[Middleware] Structured logging failed:: " + (e as any).message);`
- Line 357: `logger.warn("[Middleware] API versioning failed:: " + (e as any).message);`
- Line 365: `logger.warn("[Middleware] Response compression failed:: " + (e as any).message`
- Line 377: `logger.warn("[Security] Orchestrator load failed (non-fatal):: " + (e as any).message`
- Line 389: `logger.warn("[Security] Financial attack prevention failed (non-fatal):: " + (e as any).message`

### server/_core/kycClient.ts

10 'as any' usages found:

- Line 25: `(ENV as any).BIOMETRIC_SERVICE_URL ?? "http://localhost:8046";`
- Line 27: `(ENV as any).LIVENESS_SERVICE_URL ?? "http://localhost:8104";`
- Line 29: `(ENV as any).FACE_MATCHING_SERVICE_URL ?? "http://localhost:8105";`
- Line 31: `(ENV as any).DEEPFAKE_SERVICE_URL ?? "http://localhost:8106";`
- Line 33: `(ENV as any).KYC_SERVICE_URL ?? "https://videokyc.insureportal.io";`
- Line 35: `(ENV as any).PADDLEOCR_SERVICE_URL ?? "https://ocr.insureportal.io";`
- Line 37: `(ENV as any).COMPLIANCE_KYC_URL ?? "https://kyc.insureportal.io";`
- Line 39: `(ENV as any).DEEPFACE_SERVICE_URL ?? "http://localhost:8133";`
- Line 143: `status: (d.status as any) ?? "requires_review",`
- Line 152: `result: (lv.result as any) ?? "uncertain",`

### server/_core/sdk.ts

6 'as any' usages found:

- Line 141: `(data as any)?.platforms,`
- Line 142: `(data as any)?.platform ?? data.platform ?? null`
- Line 145: `...(data as any),`
- Line 252: `(data as any)?.platforms,`
- Line 253: `(data as any)?.platform ?? data.platform ?? null`
- Line 256: `...(data as any),`

### server/cron/disputeAutoEscalation.ts

4 'as any' usages found:

- Line 27: `and(eq(disputes.status, "open" as any), lt(disputes.slaDeadlineAt, now))`
- Line 40: `(dispute.priority as any) ?? "medium",`
- Line 48: `status: "escalated" as any,`
- Line 49: `priority: "high" as any,`

### server/cron/kycExpiryCheck.ts

3 'as any' usages found:

- Line 31: `isNotNull(agents.kycExpiresAt as any),`
- Line 32: `lt(agents.kycExpiresAt as any, thirtyDaysFromNow)`
- Line 41: `const expiryDate = new Date((agent as any).kycExpiresAt);`

### server/db.ts

1 'as any' usages found:

- Line 397: `.set({ status: status as any, updatedAt: new Date() })`

### server/floatTopUp.approve.test.ts

6 'as any' usages found:

- Line 100: `req: { headers: { cookie: "agent_session=mock.jwt.token" } } as any,`
- Line 101: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 113: `vi.mocked(getAgentFromCookie).mockResolvedValueOnce(null as any);`
- Line 129: `} as any);`
- Line 165: `} as any);`
- Line 175: `vi.mocked(getAgentFromCookie).mockResolvedValueOnce(null as any);`

### server/fraud.alerts.test.ts

6 'as any' usages found:

- Line 118: `req: { headers: { cookie: "agent_session=mock.jwt.token" } } as any,`
- Line 119: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 129: `const items = (result as any).items ?? result;`
- Line 138: `caller.fraud.updateStatus({ id: 1, status: "invalid_status" as any })`
- Line 188: `id: "not-a-number" as any,`
- Line 197: `caller.fraud.updateStatus({ id: 1, status: "invalid_status" as any })`

### server/gap-fixes.test.ts

1 'as any' usages found:

- Line 25: `req: {} as any,`

### server/kafka-event-consumer.ts

9 'as any' usages found:

- Line 100: `const { agentId, amount, currency, reference } = event.payload as any;`
- Line 108: `const { transactionId, agentId, amount, fee } = event.payload as any;`
- Line 116: `const { transactionId, reason, agentId } = event.payload as any;`
- Line 123: `const { agentId, name, region, tier } = event.payload as any;`
- Line 131: `const { agentId, reason, suspendedBy } = event.payload as any;`
- Line 138: `const { agentId, amount, source, reference } = event.payload as any;`
- Line 147: `event.payload as any;`
- Line 156: `const { settlementId, agentId, amount, bankAccount } = event.payload as any;`
- Line 164: `const { settlementId, bankReference, completedAt } = event.payload as any;`

### server/kyc.test.ts

4 'as any' usages found:

- Line 141: `req: { cookies: { agent_session: "mock_token" } } as any,`
- Line 142: `res: {} as any,`
- Line 150: `} as any)`
- Line 158: `} as any),`

### server/lib/__tests__/sprint62-production.test.ts

1 'as any' usages found:

- Line 524: `const mockReq = { headers: { host: "localhost:3000" } } as any;`

### server/lib/__tests__/sprint63-livechat.test.ts

1 'as any' usages found:

- Line 56: `(schema.chatSessions as any)?._ ?? schema.chatSessions`

### server/lib/__tests__/testHelpers.ts

5 'as any' usages found:

- Line 21: `user: MOCK_USER as any,`
- Line 26: `} as any,`
- Line 30: `} as any,`
- Line 44: `} as any,`
- Line 48: `} as any,`

### server/lib/apiDocs.ts

7 'as any' usages found:

- Line 261: `(paths[endpoint.path][endpoint.method.toLowerCase()] as any).deprecated = true;`
- Line 265: `(paths[endpoint.path][endpoint.method.toLowerCase()] as any).xRateLimit = endpoint.rateLimit;`
- Line 403: `yaml += `      summary: ${(details as any).summary || "No summary"}\n`;`
- Line 404: `yaml += `      tags: ${JSON.stringify((details as any).tags || [])}\n`;`
- Line 405: `yaml += `      responses:\n        200:\n          description: ${(details as any).responses?.[200]?.description || "OK"}\n`;`
- Line 431: `const summary = (details as any).summary || "No summary";`
- Line 432: `const tags = (details as any).tags || [];`

### server/lib/apiVersioning.ts

1 'as any' usages found:

- Line 111: `(req as any).apiVersion = versionInfo;`

### server/lib/commissionLifecycle.ts

1 'as any' usages found:

- Line 293: `.where(eq(commissionPayouts.status, "completed" as any))`

### server/lib/complianceScreening.ts

1 'as any' usages found:

- Line 178: `const data = (await response.json()) as any;`

### server/lib/correlationId.ts

7 'as any' usages found:

- Line 31: `(req as any).correlationId = correlationId;`
- Line 32: `(req as any).requestId = requestId;`
- Line 42: `return (req as any).correlationId ?? "unknown";`
- Line 46: `return (req as any).requestId ?? "unknown";`
- Line 136: `userId: (req as any).user?.id?.toString(),`
- Line 172: `(req as any).apiVersion = version;`
- Line 186: `return (req as any).apiVersion ?? DEFAULT_VERSION;`

### server/lib/dbPoolMonitor.ts

2 'as any' usages found:

- Line 27: `const pool = (db as any)?._.client?.pool ?? (db as any)?.$client?.pool;`
- Line 27: `const pool = (db as any)?._.client?.pool ?? (db as any)?.$client?.pool;`

### server/lib/enhancedCrud.ts

1 'as any' usages found:

- Line 250: `(item as any).deletedAt = Date.now();`

### server/lib/gracefulShutdown.ts

4 'as any' usages found:

- Line 30: `if (db && (db as any).end) {`
- Line 31: `await (db as any).end();`
- Line 42: `await (redisModule as any).closeRedis?.();`
- Line 55: `await (kafkaModule as any).closeKafka?.();`

### server/lib/httpAgent.ts

6 'as any' usages found:

- Line 56: `(HTTP_AGENT as any).sockets as NodeJS.ReadOnlyDict<unknown[]>`
- Line 59: `(HTTP_AGENT as any).freeSockets as NodeJS.ReadOnlyDict<unknown[]>`
- Line 62: `(HTTP_AGENT as any).requests as NodeJS.ReadOnlyDict<unknown[]>`
- Line 67: `(HTTPS_AGENT as any).sockets as NodeJS.ReadOnlyDict<unknown[]>`
- Line 70: `(HTTPS_AGENT as any).freeSockets as NodeJS.ReadOnlyDict<unknown[]>`
- Line 73: `(HTTPS_AGENT as any).requests as NodeJS.ReadOnlyDict<unknown[]>`

### server/lib/infrastructureCompletion.ts

4 'as any' usages found:

- Line 349: `(req as any).correlationId = correlationId;`
- Line 350: `(req as any).requestId = requestId;`
- Line 360: `return (req as any).correlationId || "unknown";`
- Line 364: `return (req as any).requestId || "unknown";`

### server/lib/performanceTuning.ts

1 'as any' usages found:

- Line 281: `} as any;`

### server/lib/realtimeNotifications.ts

11 'as any' usages found:

- Line 168: `(socket as any).userId = String(payload.sub);`
- Line 169: `(socket as any).userName = payload.name ?? "Unknown";`
- Line 170: `(socket as any).userRole = payload.role ?? "user";`
- Line 173: `(socket as any).userId = `anon_${socket.id.slice(0, 8)}`;`
- Line 174: `(socket as any).userName = "Anonymous";`
- Line 175: `(socket as any).userRole = "guest";`
- Line 178: `(socket as any).userId = `anon_${socket.id.slice(0, 8)}`;`
- Line 179: `(socket as any).userName = "Anonymous";`
- Line 180: `(socket as any).userRole = "guest";`
- Line 186: `const userId = (socket as any).userId;`
- Line 187: `const userName = (socket as any).userName;`

### server/lib/requestTracing.ts

1 'as any' usages found:

- Line 107: `const userId = (req as any).userId || "anonymous";`

### server/lib/securityAuditFixes.ts

2 'as any' usages found:

- Line 149: `const sessionId = (req as any).sessionId ?? "anonymous";`
- Line 269: `} as any;`

### server/lib/securityMiddleware.ts

1 'as any' usages found:

- Line 160: `req.query = sanitizeValue(req.query) as any;`

### server/lib/sprint23Features.ts

1 'as any' usages found:

- Line 841: `const fieldValue = (dispute as any)[rule.condition.field];`

### server/loadtest-bandwidth.test.ts

4 'as any' usages found:

- Line 25: `} as any;`
- Line 36: `} as any;`
- Line 47: `} as any;`
- Line 58: `} as any;`

### server/mdm.test.ts

11 'as any' usages found:

- Line 134: `req: { headers: {}, ip: "127.0.0.1", protocol: "https" } as any,`
- Line 135: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 155: `req: { headers: {}, ip: "127.0.0.1", protocol: "https" } as any,`
- Line 156: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 163: `req: { headers: {}, ip: "10.0.0.1", protocol: "https" } as any,`
- Line 164: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 277: `caller.mdm.issueCommand({ deviceId: 1, command: "INVALID_CMD" as any })`
- Line 488: `severity: "invalid" as any,`
- Line 526: `action: "invalid" as any,`
- Line 613: `caller.mdm.heartbeat({ serialNumber: "", agentId: "AGT001" } as any)`
- Line 620: `caller.mdm.heartbeat({ serialNumber: "SN001", agentId: "" } as any)`

### server/middleware/adaptiveBandwidth.ts

2 'as any' usages found:

- Line 187: `(req as any).__connectionQuality = quality;`
- Line 188: `(req as any).__bandwidthBudget = budget;`

### server/middleware/agentAuth.ts

2 'as any' usages found:

- Line 43: `const err = new Error("Agent session required") as any;`
- Line 49: `const err = new Error("Agent not found") as any;`

### server/middleware/connectionAware.ts

2 'as any' usages found:

- Line 242: `(req as any).connectionInfo = connectionInfo;`
- Line 243: `(req as any).adaptationConfig = config;`

### server/middleware/connectivityResilience.ts

1 'as any' usages found:

- Line 33: `userId: (req as any).userId,`

### server/middleware/ddosProtection.ts

2 'as any' usages found:

- Line 210: `(res as any).end = function (...args: any[]) {`
- Line 226: `return originalEnd.apply(res, args as any);`

### server/middleware/errorTracking.ts

2 'as any' usages found:

- Line 28: `requestId: (req as any).requestId ?? "unknown",`
- Line 33: `userId: (req as any).user?.id,`

### server/middleware/financialAttackPrevention.ts

1 'as any' usages found:

- Line 548: `const userId = (req as any).userId || "anonymous";`

### server/middleware/index.ts

4 'as any' usages found:

- Line 21: `(req as any).requestId = id;`
- Line 33: `const reqId = (req as any).requestId || "-";`
- Line 286: `const userId = (req as any).user?.id || "anonymous";`
- Line 287: `const reqId = (req as any).requestId || "-";`

### server/middleware/mfaEnforcement.ts

3 'as any' usages found:

- Line 59: `const cookieHeader = String((ctx.req as any).headers?.cookie ?? "");`
- Line 69: `const amr: string[] = (session as any)?.amr ?? [];`
- Line 113: `const amr: string[] = (session as any)?.amr ?? [];`

### server/middleware/middlewareConnectors.ts

6 'as any' usages found:

- Line 337: `const data = (await res.json()) as any;`
- Line 428: `const data = (await res.json()) as any;`
- Line 630: `const data = (await res.json()) as any;`
- Line 652: `const data = (await res.json()) as any;`
- Line 711: `const data = (await res.json()) as any;`
- Line 814: `const data = (await res.json()) as any;`

### server/middleware/mockReplacements.ts

2 'as any' usages found:

- Line 318: `role: params.role as any,`
- Line 334: `return value as any;`

### server/middleware/pbacEnforcement.ts

2 'as any' usages found:

- Line 222: `const data = (await response.json()) as any;`
- Line 295: `tenantId: (ctx.user as any).tenantId,`

### server/middleware/rbac.ts

1 'as any' usages found:

- Line 31: `* RBAC middleware — checks if user has any of the specified roles.`

### server/middleware/securityFixes.ts

1 'as any' usages found:

- Line 232: `const sessionId = (req as any).sessionId || req.ip || "anonymous";`

### server/middleware/securityOrchestrator.ts

12 'as any' usages found:

- Line 50: `return resp as any;`
- Line 94: `const data = await (resp as any).json();`
- Line 165: `const data = await (resp as any).json();`
- Line 224: `return await (resp as any).json();`
- Line 309: `(req as any).ddosResult = ddosResult;`
- Line 347: `const user = (req as any).user;`
- Line 358: `(req as any).pbacResult = pbacResult;`
- Line 391: `const user = (req as any).user;`
- Line 407: `(req as any).fraudScore = fraudResult;`
- Line 494: `const data = await (resp as any).json();`
- Line 506: `const data = await (resp as any).json();`
- Line 517: `const data = await (resp as any).json();`

### server/middleware/sidecarIntegration.ts

1 'as any' usages found:

- Line 46: `const userId = (ctx as any)?.user?.id?.toString() ?? "anonymous";`

### server/middleware/structuredLogging.ts

2 'as any' usages found:

- Line 18: `(req as any).requestId = requestId;`
- Line 33: `userId: (req as any).user?.id ?? null,`

### server/middleware/tenantIsolation.ts

1 'as any' usages found:

- Line 52: `const isSuperAdmin = (ctx.user as any).role === "super_admin";`

### server/middleware/tenantScope.ts

2 'as any' usages found:

- Line 81: `const isAdmin = (ctx.user as any).role === "admin";`
- Line 107: `const isTenantAdmin = (ctx.user as any).role === "tenant_admin";`

### server/middleware/webhookHmac.ts

2 'as any' usages found:

- Line 46: `const rawBody: Buffer | undefined = (req as any).rawBody;`
- Line 95: `(req as any).rawBody = Buffer.concat(chunks);`

### server/pos.test.ts

5 'as any' usages found:

- Line 95: `} as any,`
- Line 99: `} as any,`
- Line 200: `} as any);`
- Line 266: `] as any);`
- Line 272: `const items = (result as any).items ?? result;`

### server/resilience.test.ts

6 'as any' usages found:

- Line 34: `} as any,`
- Line 38: `} as any,`
- Line 89: `const rate = (result as any).success_rate_pct;`
- Line 106: `expect(typeof (result as any).count).toBe("number");`
- Line 107: `expect((result as any).count).toBeGreaterThanOrEqual(0);`
- Line 165: `const ussd = (result as any).ussd as string;`

### server/restBridge.ts

6 'as any' usages found:

- Line 92: `(req as any).user = payload;`
- Line 100: `const user = (req as any).user;`
- Line 669: `.where(eq(posTerminals.status, req.params.status as any));`
- Line 950: `agentId: (req as any).user?.agentId,`
- Line 1511: `const keycloakSub = (req as any).user?.sub;`
- Line 1529: `const keycloakSub = (req as any).user?.sub;`

### server/routers/agentBankAccountsCrud.ts

1 'as any' usages found:

- Line 177: `.values(input as any)`

### server/routers/agentCommissionCalc.ts

9 'as any' usages found:

- Line 121: `eventType: "commission.calculated" as any,`
- Line 126: `} as any);`
- Line 131: `} as any);`
- Line 190: `? eq(commissionPayouts.status, input.status as any)`
- Line 221: `.set({ status: "approved" } as any)`
- Line 236: `} as any),`
- Line 237: `} as any);`
- Line 240: `eventType: "commission.payout.approved" as any,`
- Line 241: `} as any);`

### server/routers/agentGamification.ts

9 'as any' usages found:

- Line 212: `.where(eq((agentBadges as any).agentId, agentIdNum))`
- Line 234: `...BADGE_DEFINITIONS.find(d => d.id === (b as any).badgeId),`
- Line 238: `d => !badges.some(b => (b as any).badgeId === d.id)`
- Line 242: `d => !badges.some(b => (b as any).badgeId === d.id)`
- Line 291: `} as any)`
- Line 318: `eq((agentBadges as any).agentId, input.agentId),`
- Line 319: `eq((agentBadges as any).badgeId, input.badgeId)`
- Line 331: `} as any)`
- Line 339: `} as any);`

### server/routers/agentHierarchyTerritory.ts

1 'as any' usages found:

- Line 249: `.values(input.data || ({} as any))`

### server/routers/agentLoanOrigination2.ts

3 'as any' usages found:

- Line 140: `.values(input.data || ({} as any))`
- Line 182: `.values(input.data || ({} as any))`
- Line 224: `.values(input.data || ({} as any))`

### server/routers/agentNetworkTopology.ts

2 'as any' usages found:

- Line 42: `return { data: enriched, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 60: `const total = (totalRows as any)[0]?.total ?? 0;`

### server/routers/agentOnboarding.ts

2 'as any' usages found:

- Line 361: `if (!db || (db as any)._isNoop) return { items: [], total: 0 };`
- Line 424: `if (!db || (db as any)._isNoop) return { items: [], total: 0 };`

### server/routers/agentOnboardingWorkflow.ts

2 'as any' usages found:

- Line 73: `const completed = steps.filter((s) => (progress as any)[s] === true).length;`
- Line 185: `.where(eq(agentOnboardingProgress.currentStep, step as any));`

### server/routers/agentTrainingPortal.ts

2 'as any' usages found:

- Line 209: `.values(input.data || ({} as any))`
- Line 251: `.values(input.data || ({} as any))`

### server/routers/analyticsDashboard.ts

1 'as any' usages found:

- Line 99: `} as any)`

### server/routers/analyticsDashboardsCrud.ts

1 'as any' usages found:

- Line 98: `.values({ ...input, createdBy: ctx.user?.id } as any)`

### server/routers/apiKeyManagement.ts

2 'as any' usages found:

- Line 179: `.values(input.data || ({} as any))`
- Line 221: `.values(input.data || ({} as any))`

### server/routers/apiRateLimiterDash.ts

2 'as any' usages found:

- Line 42: `return { data: results, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 74: `return { totalRules: (totalRows as any)[0]?.total ?? 0, activeBlocks: 1, throttledClients: 3, rejectionRate: 0.27, ddosDetections: 0, lastUpdated: new Date().toISOString() };`

### server/routers/archivalAdmin.ts

1 'as any' usages found:

- Line 224: `tables: [] as any[],`

### server/routers/auditTrail.ts

1 'as any' usages found:

- Line 28: `conditions.push(eq(auditLog.tenantId, input.status as any));`

### server/routers/automatedSettlementScheduler.ts

6 'as any' usages found:

- Line 142: `eventType: "settlement.schedule.created" as any,`
- Line 144: `} as any);`
- Line 178: `} as any);`
- Line 221: `} as any);`
- Line 226: `eventType: "settlement.schedule.manual_trigger" as any,`
- Line 228: `} as any);`

### server/routers/bankAccountManagement.ts

2 'as any' usages found:

- Line 95: `.values(input as any)`
- Line 167: `.values(input as any)`

### server/routers/bankingWorkflowPatterns.ts

2 'as any' usages found:

- Line 113: `} as any)`
- Line 121: `} as any);`

### server/routers/biReportDefinitionsCrud.ts

1 'as any' usages found:

- Line 83: `.values(input as any)`

### server/routers/billingAudit.ts

3 'as any' usages found:

- Line 71: `} as any)`
- Line 87: `} as any);`
- Line 178: `conditions.push(eq(billingAuditLog.action, input.action as any));`

### server/routers/billingInvoice.ts

6 'as any' usages found:

- Line 20: `apiVersion: "2025-04-30.basil" as any,`
- Line 94: `eq(platformBillingLedger.agentId, input.clientId as any),`
- Line 156: `quantity: (subConfig as any).agentCount || 10,`
- Line 157: `unitPrice: (subConfig as any).perAgentFee,`
- Line 159: `((subConfig as any).agentCount || 10) *`
- Line 160: `(subConfig as any).perAgentFee,`

### server/routers/bulkPaymentProcessor.ts

2 'as any' usages found:

- Line 212: `.values(input.data || ({} as any))`
- Line 254: `.values(input.data || ({} as any))`

### server/routers/bulkTransactionProcessor.ts

1 'as any' usages found:

- Line 206: `.values(input.data || ({} as any))`

### server/routers/chargebackManagement.ts

2 'as any' usages found:

- Line 104: `} as any)`
- Line 115: `} as any);`

### server/routers/chat.ts

6 'as any' usages found:

- Line 29: `} as any)`
- Line 37: `} as any);`
- Line 59: `} as any)`
- Line 216: `} as any)`
- Line 238: `} as any)`
- Line 263: `} as any);`

### server/routers/commissionClawback.ts

14 'as any' usages found:

- Line 135: `} as any)`
- Line 145: `} as any),`
- Line 146: `} as any);`
- Line 149: `eventType: "commission.clawback.initiated" as any,`
- Line 153: `} as any);`
- Line 158: `} as any);`
- Line 174: `.set({ status: "applied", appliedAt: new Date() } as any)`
- Line 189: `} as any),`
- Line 190: `} as any);`
- Line 193: `eventType: "commission.clawback.applied" as any,`
- Line 194: `} as any);`
- Line 218: `.set({ status: "failed" } as any)`
- Line 231: `details: JSON.stringify({ reason: input.reason } as any),`
- Line 232: `} as any);`

### server/routers/commissionEngine.ts

19 'as any' usages found:

- Line 266: `if (!db || (db as any)._isNoop) return;`
- Line 277: `.values(t as any)`
- Line 290: `.values(s as any)`
- Line 313: `if (!db || (db as any)._isNoop) return;`
- Line 367: `if (!db || (db as any)._isNoop)`
- Line 399: `if (!db || (db as any)._isNoop) {`
- Line 430: `.set(updates as any)`
- Line 446: `eventType: "commission.tier.updated" as any,`
- Line 487: `if (!db || (db as any)._isNoop) {`
- Line 540: `eventType: "commission.tier.created" as any,`
- Line 570: `if (!db || (db as any)._isNoop) {`
- Line 598: `eventType: "commission.tier.deleted" as any,`
- Line 680: `if (!db || (db as any)._isNoop) {`
- Line 775: `if (!db || (db as any)._isNoop) {`
- Line 825: `eventType: "commission.split.created" as any,`
- Line 959: `if (!db || (db as any)._isNoop) return { payouts: [], total: 0 };`
- Line 963: `conditions.push(eq(commissionPayouts.status, input.status as any));`
- Line 1069: `eventType: "commission.payout.approved" as any,`
- Line 1198: `if (!db || (db as any)._isNoop) return { entries: [] };`

### server/routers/complianceFiling.ts

3 'as any' usages found:

- Line 46: `eq(complianceFilings.createdAt, input.regulator as any)`
- Line 100: `} as any)`
- Line 124: `} as any)`

### server/routers/complianceReporting.ts

2 'as any' usages found:

- Line 181: `.values(input.data || ({} as any))`
- Line 223: `.values(input.data || ({} as any))`

### server/routers/customer.ts

1 'as any' usages found:

- Line 142: `.values(input as any)`

### server/routers/customerDisputePortal.ts

3 'as any' usages found:

- Line 110: `} as any)`
- Line 121: `} as any);`
- Line 192: `if ((db as any)._isNoop) return { disputes: [], items: [], total: 0 };`

### server/routers/customerFeedbackNps.ts

1 'as any' usages found:

- Line 213: `.values(input.data || ({} as any))`

### server/routers/customerJourneyAnalytics.ts

3 'as any' usages found:

- Line 83: `} as any)`
- Line 149: `channel: (customerJourneySteps as any).channel,`
- Line 154: `.groupBy((customerJourneySteps as any).channel);`

### server/routers/customerJourneyEventsCrud.ts

1 'as any' usages found:

- Line 110: `.values({ ...input, createdAt: new Date() } as any)`

### server/routers/customerLoyaltyProgram.ts

4 'as any' usages found:

- Line 90: `} as any)`
- Line 98: `} as any);`
- Line 150: `} as any)`
- Line 162: `} as any);`

### server/routers/customerOnboardingPipeline.ts

1 'as any' usages found:

- Line 48: `.where(eq(users.id, userId as any))`

### server/routers/customerSurveys.ts

1 'as any' usages found:

- Line 176: `.values(input.data || ({} as any))`

### server/routers/customerWalletSystem.ts

2 'as any' usages found:

- Line 104: `} as any)`
- Line 116: `} as any);`

### server/routers/dataConsentRecordsCrud.ts

4 'as any' usages found:

- Line 36: `eq(dataConsentRecords.userAgent, input.userId as any)`
- Line 118: `} as any)`
- Line 152: `} as any)`
- Line 175: `.where(eq(dataConsentRecords.userAgent, input.userId as any))`

### server/routers/dataExport.ts

2 'as any' usages found:

- Line 58: `Object.values(r as any)`
- Line 102: `Object.values(r as any)`

### server/routers/dataExportHub.ts

1 'as any' usages found:

- Line 85: `} as any)`

### server/routers/dataExportRouter.ts

2 'as any' usages found:

- Line 69: `} as any)`
- Line 77: `} as any);`

### server/routers/dataRetentionPolicy.ts

2 'as any' usages found:

- Line 179: `.values(input.data || ({} as any))`
- Line 256: `.values(input.data || ({} as any))`

### server/routers/databaseVisualization.ts

1 'as any' usages found:

- Line 245: `.values(input.data || ({} as any))`

### server/routers/dbSchemaPush.ts

1 'as any' usages found:

- Line 40: `return { data: results, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`

### server/routers/developerPortal.ts

1 'as any' usages found:

- Line 607: `await db.insert(apiKeyUsage).values(input as any);`

### server/routers/disputeMediationAI.ts

10 'as any' usages found:

- Line 150: `eventType: "dispute.ai.analyzed" as any,`
- Line 152: `} as any);`
- Line 187: `} as any)`
- Line 203: `} as any);`
- Line 206: `eventType: "dispute.ai.accepted" as any,`
- Line 208: `} as any);`
- Line 255: `} as any)`
- Line 271: `} as any);`
- Line 274: `eventType: "dispute.ai.overridden" as any,`
- Line 276: `} as any);`

### server/routers/disputeNotifications.ts

2 'as any' usages found:

- Line 168: `} as any);`
- Line 171: `eventType: "dispute.notification.sent" as any,`

### server/routers/disputeRefund.ts

3 'as any' usages found:

- Line 72: `return { data: enriched, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 131: `totalDisputes: (totalRows as any)[0]?.total ?? 0,`
- Line 132: `pendingRefunds: Math.floor(((totalRows as any)[0]?.total ?? 0) * 0.3),`

### server/routers/disputeResolution.ts

6 'as any' usages found:

- Line 168: `} as any)`
- Line 172: `eventType: "dispute.created" as any,`
- Line 174: `} as any);`
- Line 225: `} as any);`
- Line 228: `eventType: "dispute.status_changed" as any,`
- Line 230: `} as any);`

### server/routers/disputeWorkflowEngine.ts

13 'as any' usages found:

- Line 42: `} as any)`
- Line 54: `} as any);`
- Line 59: `eventType: "dispute.workflow.created" as any,`
- Line 61: `} as any);`
- Line 174: `} as any);`
- Line 178: `eventType: "dispute.workflow.status_changed" as any,`
- Line 180: `} as any);`
- Line 230: `} as any);`
- Line 233: `eventType: "dispute.workflow.escalated" as any,`
- Line 235: `} as any);`
- Line 323: `} as any);`
- Line 326: `eventType: "dispute.workflow.auto_resolved" as any,`
- Line 328: `} as any);`

### server/routers/documentManagement.ts

2 'as any' usages found:

- Line 82: `} as any)`
- Line 93: `} as any);`

### server/routers/dragDropReportBuilder.ts

1 'as any' usages found:

- Line 68: `} as any)`

### server/routers/dynamicFeeEngine.ts

21 'as any' usages found:

- Line 32: `if ((input as any).channel)`
- Line 33: `conditions.push(eq((feeRules as any).channel, input.channel));`
- Line 36: `conditions.push(eq(feeRules.isActive, input.active as any));`
- Line 109: `} as any)`
- Line 117: `} as any);`
- Line 140: `} as any)`
- Line 149: `.where(eq(feeRules.id, input.ruleId as any))`
- Line 163: `.where(eq(feeRules.id, input.ruleId as any));`
- Line 170: `} as any);`
- Line 202: `eq((feeRules as any).channel, input.channel),`
- Line 217: `fee = parseFloat(String((rule as any).flatAmount || "0"));`
- Line 222: `parseFloat(String((rule as any).percentageRate || "0"))) /`
- Line 228: `parseFloat(String((rule as any).percentageRate || "0"))) /`
- Line 236: `if ((rule as any).tiers) {`
- Line 237: `const tiers = JSON.parse(String((rule as any).tiers));`
- Line 325: `eq((feeRules as any).channel, input.channel),`
- Line 342: `fee = parseFloat(String((rule as any).flatAmount || "0"));`
- Line 347: `parseFloat(String((rule as any).percentageRate || "0"))) /`
- Line 353: `parseFloat(String((rule as any).percentageRate || "0"))) /`
- Line 361: `if ((rule as any).tiers) {`
- Line 362: `const tiers = JSON.parse(String((rule as any).tiers));`

### server/routers/dynamicPricingEngine.ts

2 'as any' usages found:

- Line 116: `} as any)`
- Line 124: `} as any);`

### server/routers/e2eTestFramework.ts

2 'as any' usages found:

- Line 40: `return { data: results, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 72: `return { totalRuns: (totalRows as any)[0]?.total ?? 0, passRate: 94.5, flakyTests: 3, coveragePct: 82, lastRun: new Date().toISOString(), environments: ["staging", "uat", "production-canary"] };`

### server/routers/ecommerceOrders.ts

1 'as any' usages found:

- Line 204: `conditions.push(eq(ecommerceOrders.status, input.status as any));`

### server/routers/encryptedFieldsCrud.ts

1 'as any' usages found:

- Line 103: `} as any)`

### server/routers/export.ts

1 'as any' usages found:

- Line 252: `return Object.values(summary as any).sort(`

### server/routers/featureFlags.ts

2 'as any' usages found:

- Line 97: `} as any)`
- Line 105: `} as any);`

### server/routers/financialReconciliationDash.ts

2 'as any' usages found:

- Line 92: `} as any)`
- Line 100: `} as any);`

### server/routers/fraud.ts

1 'as any' usages found:

- Line 475: `.values(DEFAULT_RULES as any)`

### server/routers/fraudMlScoringEngine.ts

3 'as any' usages found:

- Line 98: `} as any)`
- Line 107: `} as any);`
- Line 115: `} as any);`

### server/routers/generalLedger.ts

4 'as any' usages found:

- Line 127: `await db.insert(glEntries).values(records as any as any);`
- Line 127: `await db.insert(glEntries).values(records as any as any);`
- Line 156: `accounts: [] as any[],`
- Line 210: `accounts: [] as any[],`

### server/routers/geoFencesCrud.ts

1 'as any' usages found:

- Line 116: `} as any)`

### server/routers/glAccountsCrud.ts

1 'as any' usages found:

- Line 121: `.values(input as any)`

### server/routers/glJournalEntriesCrud.ts

1 'as any' usages found:

- Line 89: `.values({ ...input, status: "posted", postedAt: new Date() } as any)`

### server/routers/globalSearch.ts

3 'as any' usages found:

- Line 147: `customer: (transactions as any).customerNameNameName,`
- Line 156: `(transactions as any).customerNameNameName ?? sql`''`,`
- Line 186: `(transactions as any).customerNameNameName ?? sql`''`,`

### server/routers/healthCheck.ts

1 'as any' usages found:

- Line 138: `const healthyCount = Object.values(checks as any).filter(`

### server/routers/helpDesk.ts

3 'as any' usages found:

- Line 94: `} as any)`
- Line 100: `} as any);`
- Line 107: `} as any);`

### server/routers/incidentCommandCenter.ts

2 'as any' usages found:

- Line 85: `} as any)`
- Line 93: `} as any);`

### server/routers/incidentPlaybook.ts

3 'as any' usages found:

- Line 140: `.values(input.data || ({} as any))`
- Line 182: `.values(input.data || ({} as any))`
- Line 224: `.values(input.data || ({} as any))`

### server/routers/lakehouse.ts

3 'as any' usages found:

- Line 405: `cells: Object.values(grid as any),`
- Line 478: `? [eq(transactions.type, input.txType as any)]`
- Line 512: `cells: Object.values(grid as any),`

### server/routers/loadTestMetrics.ts

3 'as any' usages found:

- Line 229: `const res = record.results as any;`
- Line 406: `const rA = runA.results as any;`
- Line 407: `const rB = runB.results as any;`

### server/routers/management.ts

7 'as any' usages found:

- Line 237: `.values(input as any)`
- Line 578: `.values(input as any)`
- Line 735: `.values(input as any)`
- Line 802: `.values(input as any)`
- Line 977: `.values(input as any)`
- Line 1015: `.values(input as any)`
- Line 1582: `.values(input as any)`

### server/routers/mccManager.ts

1 'as any' usages found:

- Line 67: `return { totalCodes: Object.keys(MCC_DATABASE).length, merchantsAssigned: (totalRows as any)[0]?.total ?? 0, highRiskMerchants: 5, restrictedAttempts: 0, lastReview: new Date().toISOString() };`

### server/routers/mdm.ts

1 'as any' usages found:

- Line 370: `summary.total = Object.values(summary as any).reduce(`

### server/routers/merchant.ts

1 'as any' usages found:

- Line 351: `} as any)`

### server/routers/merchantKycOnboarding.ts

1 'as any' usages found:

- Line 97: `} as any)`

### server/routers/merchantOnboardingPortal.ts

1 'as any' usages found:

- Line 27: `.where(eq(merchants.status, input.status as any))`

### server/routers/merchantPayoutSettlement.ts

1 'as any' usages found:

- Line 89: `} as any)`

### server/routers/merchantRiskScoring.ts

2 'as any' usages found:

- Line 83: `return { data: filtered, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 106: `const total = (totalRows as any)[0]?.total ?? 0;`

### server/routers/multiTenantIsolation.ts

2 'as any' usages found:

- Line 79: `} as any)`
- Line 87: `} as any);`

### server/routers/networkQualityHeatmap.ts

1 'as any' usages found:

- Line 59: `return { totalZones: NIGERIAN_STATES.length, avgQuality: 67, greenZones: 3, yellowZones: 5, orangeZones: 3, redZones: 1, agentsMonitored: (totalRows as any)[0]?.total ?? 0, slaBreaches24h: 1 };`

### server/routers/networkTelemetry.ts

2 'as any' usages found:

- Line 51: `return { data: telemetry, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 72: `return { totalDevices: (totalRows as any)[0]?.total ?? 0, avgRttMs: 125, avgJitterMs: 18, avgBandwidthKbps: 3500, onlinePct: 96.5, degradedDevices: 12, offlineDevices: 3, lastUpdated: new Date().toISOString() };`

### server/routers/notificationChannelsCrud.ts

1 'as any' usages found:

- Line 102: `.values(input as any)`

### server/routers/notificationOrchestrator.ts

2 'as any' usages found:

- Line 151: `} as any)`
- Line 193: `await db.insert(notificationDispatchLog).values(records as any);`

### server/routers/observabilityAlertsCrud.ts

1 'as any' usages found:

- Line 123: `.values(input as any)`

### server/routers/partnerSelfService.ts

2 'as any' usages found:

- Line 51: `} as any)`
- Line 59: `} as any);`

### server/routers/paymentReconciliation.ts

2 'as any' usages found:

- Line 176: `.values(input.data || ({} as any))`
- Line 218: `.values(input.data || ({} as any))`

### server/routers/paymentTokenVault.ts

2 'as any' usages found:

- Line 66: `return { data: masked, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 123: `const total = (totalRows as any)[0]?.total ?? 0;`

### server/routers/platformConfigCenter.ts

1 'as any' usages found:

- Line 249: `.values(input.data || ({} as any))`

### server/routers/platformHealthDash.ts

1 'as any' usages found:

- Line 65: `return { data: results, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`

### server/routers/platformHealthMonitor.ts

1 'as any' usages found:

- Line 252: `.values(input.data || ({} as any))`

### server/routers/platformHealthScorecard.ts

1 'as any' usages found:

- Line 173: `.values(input.data || ({} as any))`

### server/routers/platformMetricsExporter.ts

2 'as any' usages found:

- Line 49: `return { data: results, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 83: `dataPoints: (totalRows as any)[0]?.total ?? 0,`

### server/routers/posTerminalFleet.ts

1 'as any' usages found:

- Line 413: `total: Object.values(counts as any).reduce((a, b) => a + b, 0),`

### server/routers/rateLimitEngine.ts

1 'as any' usages found:

- Line 84: `} as any)`

### server/routers/realtimeTxAlertsCrud.ts

2 'as any' usages found:

- Line 120: `} as any)`
- Line 145: `.set({ metadata: "dismissed", acknowledged: true } as any)`

### server/routers/realtimeTxMonitor.ts

1 'as any' usages found:

- Line 41: `conditions.push(eq(transactions.status, input.status as any));`

### server/routers/referralProgram.ts

2 'as any' usages found:

- Line 68: `return { data: enriched, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 123: `const total = (totalRows as any)[0]?.total ?? 0;`

### server/routers/reportScheduler.ts

3 'as any' usages found:

- Line 143: `.values((input.data || {}) as any)`
- Line 246: `.values((input.data || {}) as any)`
- Line 323: `.values((input.data || {}) as any)`

### server/routers/revenueLeakageDetector.ts

2 'as any' usages found:

- Line 179: `.values((input.data || {}) as any)`
- Line 221: `.values((input.data || {}) as any)`

### server/routers/settlementNettingEngine.ts

1 'as any' usages found:

- Line 222: `.set({ status: "settled", settledAt: new Date() } as any)`

### server/routers/skillCreatorIntegration.ts

1 'as any' usages found:

- Line 176: `.values((input.data || {}) as any)`

### server/routers/slaMonitoring.ts

2 'as any' usages found:

- Line 87: `} as any)`
- Line 200: `} as any)`

### server/routers/superAdmin.ts

1 'as any' usages found:

- Line 491: `.values(input as any)`

### server/routers/temporalWorkflows.ts

1 'as any' usages found:

- Line 98: `} as any)`

### server/routers/tenantBrandingCrud.ts

1 'as any' usages found:

- Line 183: `.values(input as any)`

### server/routers/tenantFeatureToggle.ts

2 'as any' usages found:

- Line 82: `} as any)`
- Line 196: `.set({ enabled: false } as any)`

### server/routers/tenantFeeOverridesCrud.ts

1 'as any' usages found:

- Line 141: `.values(input as any)`

### server/routers/transactionVelocityMonitor.ts

2 'as any' usages found:

- Line 72: `return { data: enriched, total: (totalRows as any)[0]?.total ?? 0, limit: input.limit, offset: input.offset };`
- Line 125: `totalMonitored: (totalRows as any)[0]?.total ?? 0,`

### server/routers/transactions.ts

34 'as any' usages found:

- Line 156: `.where(eq(velocityLimits.tier, tier as any))`
- Line 338: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 621: `: Number((brCommission as any)?.amount ?? 0);`
- Line 639: `: Number((fraudScore as any)?.score ?? 0);`
- Line 660: `status: "flagged" as any,`
- Line 780: `tenantId: (agent as any).tenantId ?? undefined,`
- Line 891: `customerId: (input as any).customerId ?? undefined,`
- Line 908: `latitude: (input as any).latitude ?? null,`
- Line 909: `longitude: (input as any).longitude ?? null,`
- Line 953: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 992: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1028: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1063: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1181: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1232: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1322: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1392: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1428: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1478: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1507: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1560: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1573: `eq(fraudAlerts.severity, input.severity.toLowerCase() as any)`
- Line 1647: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1701: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1815: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1867: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1987: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 1998: `.where(eq(velocityLimits.tier, agent.tier as any))`
- Line 2098: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 2150: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 2195: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 2324: `const total = Object.values(map as any).reduce(`
- Line 2353: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`
- Line 2412: `const agent = (ctx as any).agent ?? (await getAgentFromCookie(ctx.req));`

### server/routers/txDisputeArbitration.ts

2 'as any' usages found:

- Line 189: `} as any);`
- Line 284: `} as any);`

### server/routers/webhookDeliverySystem.ts

1 'as any' usages found:

- Line 179: `.values((input.data || {}) as any)`

### server/routers/webhookNotifications.ts

2 'as any' usages found:

- Line 52: `} as any)`
- Line 60: `} as any);`

### server/scheduled/monthlyInvoiceCron.ts

5 'as any' usages found:

- Line 36: `apiVersion: "2025-04-30.basil" as any,`
- Line 128: `const shareConfig = config.revenueShareConfig as any;`
- Line 135: `const subConfig = config.subscriptionConfig as any;`
- Line 141: `const hybridConfig = config.hybridConfig as any;`
- Line 168: `let customerId = (config as any).stripeCustomerId;`

### server/security.owasp.test.ts

8 'as any' usages found:

- Line 101: `req: { headers: {} } as any,`
- Line 102: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 108: `user: { id: "1", openId: "test-open-id", name: "Test User", role } as any,`
- Line 109: `req: { headers: { cookie: "agent_session=mock.jwt.token" } } as any,`
- Line 110: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 182: `caller.fraud.updateStatus({ id: 1, status: "hacked" as any })`
- Line 267: `} as any);`
- Line 276: `caller.fraud.updateStatus({ id: "abc" as any, status: "investigating" })`

### server/services/securityAlertSocket.ts

2 'as any' usages found:

- Line 68: `(socket as any).isAdmin = false;`
- Line 70: `(socket as any).isAdmin = true;`

### server/settlement.test.ts

3 'as any' usages found:

- Line 116: `req: { headers: { cookie: "agent_session=mock.jwt.token" } } as any,`
- Line 117: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 165: `} as any);`

### server/settlementCron.ts

4 'as any' usages found:

- Line 464: `.where(eq(erpSyncLog.status, "failed" as any))`
- Line 495: `status: "pending" as any,`
- Line 500: `.where(eq(erpSyncLog.status, "failed" as any));`
- Line 501: `const requeued = (retryResult as any).rowCount ?? failedItems.length;`

### server/simOrchestrator.failover.test.ts

1 'as any' usages found:

- Line 121: `const expectedKey = (cfg as any)?.apiKey ?? defaultKey;`

### server/socket.ts

3 'as any' usages found:

- Line 152: `(socket as any).agentId = Number(payload.sub);`
- Line 153: `(socket as any).agentName = payload.name;`
- Line 162: `const agentName = (socket as any).agentName ?? "Agent";`

### server/sprint18.test.ts

2 'as any' usages found:

- Line 87: `expect((result.user as any).token).toContain("*");`
- Line 88: `expect((result.user as any).name).toBe("John");`

### server/sprint19.test.ts

1 'as any' usages found:

- Line 159: `] as any[];`

### server/sprint24.test.ts

1 'as any' usages found:

- Line 25: `session.messages.push(welcomeMsg as any);`

### server/sprint28.test.ts

2 'as any' usages found:

- Line 23: `req: { headers: { origin: "http://localhost:3000" } } as any,`
- Line 24: `res: { clearCookie: () => {} } as any,`

### server/sprint39.test.ts

5 'as any' usages found:

- Line 56: `const routerExport = Object.values(mod)[0] as any;`
- Line 64: `const routerExport = Object.values(mod)[0] as any;`
- Line 70: `const routerExport = Object.values(mod)[0] as any;`
- Line 110: `const routerExport = Object.values(mod)[0] as any;`
- Line 112: `for (const [procName, proc] of Object.entries(procs) as any[]) {`

### server/sprint40.test.ts

5 'as any' usages found:

- Line 65: `const routerExport = Object.values(mod)[0] as any;`
- Line 72: `const routerExport = Object.values(mod)[0] as any;`
- Line 77: `const routerExport = Object.values(mod)[0] as any;`
- Line 113: `const routerExport = Object.values(mod)[0] as any;`
- Line 115: `for (const [procName, proc] of Object.entries(procs) as any[]) {`

### server/sprint41.test.ts

3 'as any' usages found:

- Line 70: `const r = Object.values(mod)[0] as any;`
- Line 77: `const r = Object.values(mod)[0] as any;`
- Line 82: `const r = Object.values(mod)[0] as any;`

### server/sprint46.test.ts

14 'as any' usages found:

- Line 222: `} as any);`
- Line 243: `} as any);`
- Line 262: `} as any);`
- Line 281: `} as any);`
- Line 301: `} as any);`
- Line 321: `} as any);`
- Line 346: `} as any);`
- Line 366: `} as any);`
- Line 386: `} as any);`
- Line 404: `} as any);`
- Line 423: `} as any);`
- Line 444: `} as any);`
- Line 462: `} as any);`
- Line 480: `} as any);`

### server/sprint48.test.ts

4 'as any' usages found:

- Line 96: `const agentsTable = (schema as any).agents;`
- Line 107: `) || (agentsTable as any).parentAgentId !== undefined;`
- Line 113: `const cascadeTable = (schema as any).commissionCascadeHistory;`
- Line 119: `const table = (schema as any).commissionCascadeHistory;`

### server/sprint78.test.ts

1 'as any' usages found:

- Line 540: `expect((manual as any)._conflict).toBe(true);`

### server/sprint82.test.ts

9 'as any' usages found:

- Line 83: `(billingInvoiceRouter as any)._def.procedures || {}`
- Line 90: `(billingInvoiceRouter as any)._def.procedures || {}`
- Line 97: `(billingInvoiceRouter as any)._def.procedures || {}`
- Line 104: `(billingInvoiceRouter as any)._def.procedures || {}`
- Line 111: `(billingInvoiceRouter as any)._def.procedures || {}`
- Line 145: `(tenantBillingOnboardingRouter as any)._def.procedures || {}`
- Line 152: `(tenantBillingOnboardingRouter as any)._def.procedures || {}`
- Line 159: `(tenantBillingOnboardingRouter as any)._def.procedures || {}`
- Line 166: `(tenantBillingOnboardingRouter as any)._def.procedures || {}`

### server/sprint94.test.ts

5 'as any' usages found:

- Line 143: `const def = (router as any)._def;`
- Line 159: `const def = (router as any)._def;`
- Line 169: `const def = (router as any)._def;`
- Line 206: `middleware(mockReq as any, mockRes as any, () => {`
- Line 206: `middleware(mockReq as any, mockRes as any, () => {`

### server/storage.ts

1 'as any' usages found:

- Line 63: `: new Blob([data as any], { type: contentType });`

### server/stripe/stripeRouter.ts

5 'as any' usages found:

- Line 24: `apiVersion: "2025-04-30.basil" as any,`
- Line 208: `((sub as any).current_period_end || 0) * 1000`
- Line 210: `cancelAtPeriodEnd: (sub as any).cancel_at_period_end || false,`
- Line 240: `if ((sub as any).customer !== user.stripeCustomerId) {`
- Line 253: `cancelAtPeriodEnd: (cancelled as any).cancel_at_period_end,`

### server/stripe/webhookHandler.ts

4 'as any' usages found:

- Line 41: `apiVersion: "2025-04-30.basil" as any,`
- Line 265: `: (session.subscription as any).id;`
- Line 276: `: (session.customer as any)?.id || null,`
- Line 373: `const dispute = event.data.object as any;`

### server/termii.test.ts

2 'as any' usages found:

- Line 34: `(ENV as any).termiiApiKey = "";`
- Line 37: `(ENV as any).termiiApiKey = savedEnvKey;`

### server/transactions.create.test.ts

7 'as any' usages found:

- Line 122: `req: { headers: { cookie: "agent_session=mock.jwt.token" } } as any,`
- Line 123: `res: { cookie: vi.fn(), clearCookie: vi.fn() } as any,`
- Line 137: `} as any)`
- Line 149: `} as any)`
- Line 161: `} as any)`
- Line 172: `} as any)`
- Line 190: `} as any)`
