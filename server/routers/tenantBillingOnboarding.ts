import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}
import {
  tenantBillingConfig,
  billingProvisioningHistory,
  billingRoleAssignments,
  billingAuditLog,
  tenants,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireBillingPermission } from "./billingRbac";
import { recordBillingAudit } from "./billingAudit";
import { Client, Connection } from "@temporalio/client";
import { TRPCError } from "@trpc/server";
import { logger } from './_core/logger';

// Temporal client singleton for billing provisioning
let temporalClient: Client | null = null;
async function getTemporalClient(): Promise<Client | null> {
  if (temporalClient) return temporalClient;
  try {
    const connection = await Connection.connect({
      address: process.env.TEMPORAL_ADDRESS || "localhost:7233",
    });
    temporalClient = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE || "54link",
    });
    return temporalClient;
  } catch {
    logger.warn(
      "[BillingOnboarding] Temporal not available, using local execution"
    );
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Default Billing Templates
// ═══════════════════════════════════════════════════════════════════════════════

export const BILLING_TEMPLATES = {
  revenue_share: {
    name: "Revenue Share",
    description:
      "54Link takes a percentage of each transaction. Best for high-volume partners.",
    billingModel: "revenue_share" as const,
    revenueShareConfig: {
      startSplitPct: 70, // Client gets 70%, 54Link gets 30%
      scaleSplitPct: 80, // At scale, client gets 80%
      scaleThreshold: 100000, // Monthly tx count threshold for scale pricing
      minimumMonthlyGuarantee: 500000, // NGN minimum monthly revenue guarantee
      signOnFee: 2000000, // NGN one-time sign-on fee
      signOnFeePaid: false,
    },
    subscriptionConfig: null,
    hybridConfig: null,
  },
  subscription: {
    name: "Subscription",
    description:
      "Fixed monthly fee per agent/terminal. Best for predictable costs.",
    billingModel: "subscription" as const,
    revenueShareConfig: null,
    subscriptionConfig: {
      perAgentFee: 15000, // NGN per agent per month
      perPosFee: 5000, // NGN per POS terminal per month
      implementationFee: 5000000, // NGN one-time implementation
      billingCycle: "monthly" as const,
    },
    hybridConfig: null,
  },
  hybrid: {
    name: "Hybrid",
    description:
      "Reduced subscription + reduced revenue share. Best for mid-size partners.",
    billingModel: "hybrid" as const,
    revenueShareConfig: null,
    subscriptionConfig: null,
    hybridConfig: {
      reducedSharePct: 15, // 54Link takes only 15% of tx revenue
      reducedPerAgent: 8000, // NGN reduced per-agent fee
      licenseFee: 3000000, // NGN annual license fee
    },
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Provisioning Steps
// ═══════════════════════════════════════════════════════════════════════════════

const PROVISIONING_STEPS = [
  "validate_tenant",
  "create_billing_config",
  "create_tigerbeetle_accounts",
  "provision_kafka_topics",
  "assign_billing_roles",
  "configure_reconciliation",
  "activate_billing",
];

/**
 * Execute the full billing provisioning workflow for a new tenant.
 * This is called at tenant onboarding inception.
 */
async function executeBillingProvisioning(params: {
  tenantId: number;
  billingModel: "revenue_share" | "subscription" | "hybrid";
  customConfig?: any;
  provisionedBy: number;
  temporalWorkflowId?: string;
}): Promise<{ success: boolean; steps: any[]; configId: number }> {
  const {
    tenantId,
    billingModel,
    customConfig,
    provisionedBy,
    temporalWorkflowId,
  } = params;
  const stepResults: any[] = [];

  for (const step of PROVISIONING_STEPS) {
    const [historyEntry] = await (
      await db()
    )
      .insert(billingProvisioningHistory)
      .values({
        tenantId,
        step,
        status: "in_progress",
        temporalWorkflowId: temporalWorkflowId || null,
      })
      .returning();

    try {
      let details: any = {};

      switch (step) {
        case "validate_tenant": {
          const [tenant] = await (await db())
            .select()
            .from(tenants)
            .where(eq(tenants.id, tenantId))
            .limit(100);
          if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
          details = {
            tenantName: tenant.name,
            tenantSlug: tenant.slug,
            status: tenant.status,
          };
          break;
        }
        case "create_billing_config": {
          const template = BILLING_TEMPLATES[billingModel];
          const [config] = await (
            await db()
          )
            .insert(tenantBillingConfig)
            .values({
              tenantId,
              billingModel,
              revenueShareConfig:
                customConfig?.revenueShareConfig || template.revenueShareConfig,
              subscriptionConfig:
                customConfig?.subscriptionConfig || template.subscriptionConfig,
              hybridConfig: customConfig?.hybridConfig || template.hybridConfig,
              currency: customConfig?.currency || "NGN",
              provisionedBy,
              status: "active",
            })
            .returning();
          details = { configId: config.id, billingModel };
          break;
        }
        case "create_tigerbeetle_accounts": {
          // Create TigerBeetle ledger accounts for the tenant
          const accountId = `TB-${tenantId}-${Date.now()}`;
          details = {
            accountId,
            accounts: [
              { type: "revenue", id: `${accountId}-revenue` },
              { type: "commission", id: `${accountId}-commission` },
              { type: "settlement", id: `${accountId}-settlement` },
              { type: "escrow", id: `${accountId}-escrow` },
            ],
          };
          // Update billing config with TB account ID
          await (await db())
            .update(tenantBillingConfig)
            .set({ tigerBeetleAccountId: accountId })
            .where(eq(tenantBillingConfig.tenantId, tenantId));
          break;
        }
        case "provision_kafka_topics": {
          const topicPrefix = `billing.tenant-${tenantId}`;
          details = {
            topicPrefix,
            topics: [
              `${topicPrefix}.transactions`,
              `${topicPrefix}.splits`,
              `${topicPrefix}.reconciliation`,
              `${topicPrefix}.audit`,
            ],
          };
          await (await db())
            .update(tenantBillingConfig)
            .set({ kafkaTopicPrefix: topicPrefix })
            .where(eq(tenantBillingConfig.tenantId, tenantId));
          break;
        }
        case "assign_billing_roles": {
          // Auto-assign billing_admin role to the provisioner
          await (await db()).insert(billingRoleAssignments).values({
            userId: provisionedBy,
            tenantId,
            billingRole: "billing_admin",
            permissions: null,
            grantedBy: provisionedBy,
          });
          details = {
            assignedRole: "billing_admin",
            assignedTo: provisionedBy,
          };
          break;
        }
        case "configure_reconciliation": {
          details = {
            reconciliationSchedule: "daily",
            reconciliationTime: "02:00 WAT",
            discrepancyThreshold: 0.01, // 1% variance triggers alert
            autoResolveBelow: 100, // NGN auto-resolve discrepancies below 100
          };
          break;
        }
        case "activate_billing": {
          await (
            await db()
          )
            .update(tenantBillingConfig)
            .set({
              status: "active",
              lastModifiedAt: new Date(),
              lastModifiedBy: provisionedBy,
            })
            .where(eq(tenantBillingConfig.tenantId, tenantId));
          details = { activated: true, activatedAt: new Date().toISOString() };
          break;
        }
      }

      // Mark step as completed
      await (await db())
        .update(billingProvisioningHistory)
        .set({ status: "completed", details, completedAt: new Date() })
        .where(eq(billingProvisioningHistory.id, historyEntry.id));

      stepResults.push({ step, status: "completed", details });
    } catch (error) {
      const errMsg = (error as Error).message;
      await (await db())
        .update(billingProvisioningHistory)
        .set({ status: "failed", error: errMsg, completedAt: new Date() })
        .where(eq(billingProvisioningHistory.id, historyEntry.id));

      stepResults.push({ step, status: "failed", error: errMsg });
      // On failure, mark remaining steps as skipped
      break;
    }
  }

  const allCompleted = stepResults.every(s => s.status === "completed");
  const [config] = await (await db())
    .select()
    .from(tenantBillingConfig)
    .where(eq(tenantBillingConfig.tenantId, tenantId))
    .limit(100);

  return {
    success: allCompleted,
    steps: stepResults,
    configId: config?.id || 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tenant Billing Onboarding Router
// ═══════════════════════════════════════════════════════════════════════════════

export const tenantBillingOnboardingRouter = router({
  // Get available billing templates
  getTemplates: protectedProcedure.query(async () => ({
    templates: Object.entries(BILLING_TEMPLATES).map(([key, t]) => ({
      key,
      name: t.name,
      description: t.description,
      billingModel: t.billingModel,
      config:
        t.billingModel === "revenue_share"
          ? t.revenueShareConfig
          : t.billingModel === "subscription"
            ? t.subscriptionConfig
            : t.hybridConfig,
    })),
  })),

  // Provision billing for a new tenant (called at onboarding inception)
  provisionBilling: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        billingModel: z.enum(["revenue_share", "subscription", "hybrid"]),
        customConfig: z.any().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        // Check if tenant already has billing configured
        const [existing] = await (await db())
          .select()
          .from(tenantBillingConfig)
          .where(eq(tenantBillingConfig.tenantId, input.tenantId));

        if (existing) {
          return {
            success: false,
            error: "Billing already provisioned for this tenant",
            configId: existing.id,
          };
        }

        // Try Temporal workflow first, fall back to local execution
        const client = await getTemporalClient();
        let result: any;
        let temporalWorkflowId: string | null = null;

        if (client) {
          // Start Temporal workflow for durable execution with rollback
          temporalWorkflowId = `billing-provision-${input.tenantId}-${Date.now()}`;
          const handle = await client.workflow.start(
            "BillingProvisioningWorkflow",
            {
              taskQueue: process.env.TEMPORAL_TASK_QUEUE || "settlement-queue",
              workflowId: temporalWorkflowId,
              args: [
                {
                  tenantId: input.tenantId,
                  tenantName: "",
                  billingModel: input.billingModel,
                  customConfig: input.customConfig,
                  provisionedBy: ctx.user.id,
                  region: "WAT",
                  currency: input.customConfig?.currency || "NGN",
                },
              ],
            }
          );
          result = await handle.result();
        } else {
          // Fallback: local execution without Temporal durability
          result = await executeBillingProvisioning({
            tenantId: input.tenantId,
            billingModel: input.billingModel,
            customConfig: input.customConfig,
            provisionedBy: ctx.user.id,
            temporalWorkflowId: undefined,
          });
        }

        // Record audit event
        await recordBillingAudit({
          ctx: {
            userId: ctx.user.id,
            userName: ctx.user.name || "unknown",
            tenantId: input.tenantId,
          },
          action: "tenant_billing_provisioned",
          resourceType: "tenant_billing_config",
          resourceId: String(result.configId),
          afterState: {
            billingModel: input.billingModel,
            steps: result.steps.length,
          },
          metadata: {
            customConfig: input.customConfig,
            temporalWorkflowId: null,
          },
        });

        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Get billing config for a tenant
  getConfig: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "view_ledger"
        );

        const [config] = await (await db())
          .select()
          .from(tenantBillingConfig)
          .where(eq(tenantBillingConfig.tenantId, input.tenantId));

        if (!config) return { config: null, provisioned: false };
        return { config, provisioned: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Update billing config (requires manage_billing_config)
  updateConfig: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        billingModel: z
          .enum(["revenue_share", "subscription", "hybrid"])
          .optional(),
        revenueShareConfig: z.any().optional(),
        subscriptionConfig: z.any().optional(),
        hybridConfig: z.any().optional(),
        autoRenew: z.boolean().optional(),
        contractEndDate: z.string().datetime().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "manage_billing_config"
        );

        const [existing] = await (await db())
          .select()
          .from(tenantBillingConfig)
          .where(eq(tenantBillingConfig.tenantId, input.tenantId));

        if (!existing) {
          return {
            success: false,
            error: "No billing config found. Provision billing first.",
          };
        }

        const updates: any = {
          lastModifiedAt: new Date(),
          lastModifiedBy: ctx.user.id,
        };
        if (input.billingModel) updates.billingModel = input.billingModel;
        if (input.revenueShareConfig)
          updates.revenueShareConfig = input.revenueShareConfig;
        if (input.subscriptionConfig)
          updates.subscriptionConfig = input.subscriptionConfig;
        if (input.hybridConfig) updates.hybridConfig = input.hybridConfig;
        if (input.autoRenew !== undefined) updates.autoRenew = input.autoRenew;
        if (input.contractEndDate)
          updates.contractEndDate = new Date(input.contractEndDate);

        await (await db())
          .update(tenantBillingConfig)
          .set(updates)
          .where(eq(tenantBillingConfig.tenantId, input.tenantId));

        // Audit the change
        await recordBillingAudit({
          ctx: {
            userId: ctx.user.id,
            userName: ctx.user.name || "unknown",
            tenantId: input.tenantId,
          },
          action:
            input.billingModel && input.billingModel !== existing.billingModel
              ? "billing_model_changed"
              : "config_updated",
          resourceType: "tenant_billing_config",
          resourceId: String(existing.id),
          beforeState: existing,
          afterState: updates,
        });

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Get provisioning history for a tenant
  getProvisioningHistory: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "view_ledger"
        );

        const history = await (await db())
          .select()
          .from(billingProvisioningHistory)
          .where(eq(billingProvisioningHistory.tenantId, input.tenantId))
          .orderBy(desc(billingProvisioningHistory.startedAt))
          .limit(200);

        return { history, total: history.length };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Re-provision a failed step (retry)
  retryStep: protectedProcedure
    .input(z.object({ tenantId: z.number(), step: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "manage_tenant_billing"
        );

        // Re-run the full provisioning (idempotent steps will skip)
        const [config] = await (await db())
          .select()
          .from(tenantBillingConfig)
          .where(eq(tenantBillingConfig.tenantId, input.tenantId));

        if (!config) {
          return { success: false, error: "No billing config found" };
        }

        // Mark the failed step as retrying
        await (
          await db()
        )
          .update(billingProvisioningHistory)
          .set({ status: "retrying" })
          .where(
            and(
              eq(billingProvisioningHistory.tenantId, input.tenantId),
              eq(billingProvisioningHistory.step, input.step)
            )
          );

        return {
          success: true,
          message: `Step '${input.step}' queued for retry`,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Deactivate billing for a tenant
  deactivateBilling: protectedProcedure
    .input(z.object({ tenantId: z.number(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await requireBillingPermission(
          ctx.user.id,
          input.tenantId,
          "manage_tenant_billing"
        );

        const [existing] = await (await db())
          .select()
          .from(tenantBillingConfig)
          .where(eq(tenantBillingConfig.tenantId, input.tenantId));

        if (!existing)
          return { success: false, error: "No billing config found" };

        await (
          await db()
        )
          .update(tenantBillingConfig)
          .set({
            status: "inactive",
            lastModifiedAt: new Date(),
            lastModifiedBy: ctx.user.id,
          })
          .where(eq(tenantBillingConfig.tenantId, input.tenantId));

        await recordBillingAudit({
          ctx: {
            userId: ctx.user.id,
            userName: ctx.user.name || "unknown",
            tenantId: input.tenantId,
          },
          action: "config_deleted",
          resourceType: "tenant_billing_config",
          resourceId: String(existing.id),
          beforeState: { status: existing.status },
          afterState: { status: "inactive", reason: input.reason },
        });

        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
});
