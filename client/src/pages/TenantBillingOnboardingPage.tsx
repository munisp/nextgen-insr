import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function TenantBillingOnboardingPage() {
  const { user } = useAuth();
  const [newTenant, setNewTenant] = useState({
    tenantName: "",
    billingModel: "revenue_share" as
      | "revenue_share"
      | "subscription"
      | "hybrid",
    revenueSharePct: 70,
    subscriptionFee: 15000,
    region: "west_africa",
    currency: "NGN",
  });

  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
  const provisionBilling =
    // @ts-ignore Sprint 85
    trpc.tenantBillingOnboarding.provisionTenantBilling.useMutation({
      onSuccess: (data: any) => {
        toast.success(`Billing provisioned for ${newTenant.tenantName}`);
      },
      onError: (err: any) => toast.error(`Provisioning failed: ${err.message}`),
    });

  // Sample provisioned tenants
  const provisionedTenants = [
    {
      id: 1,
      name: "InsurePortal Nigeria",
      model: "revenue_share",
      status: "active",
      provisionedAt: "2025-11-15",
      region: "west_africa",
    },
    {
      id: 2,
      name: "PayServ Ghana",
      model: "subscription",
      status: "active",
      provisionedAt: "2025-12-01",
      region: "west_africa",
    },
    {
      id: 3,
      name: "MobilePay Kenya",
      model: "hybrid",
      status: "provisioning",
      provisionedAt: "2026-05-08",
      region: "east_africa",
    },
  ];

  const provisioningSteps = [
    {
      step: 1,
      name: "TigerBeetle Account",
      desc: "Create double-entry ledger accounts",
    },
    { step: 2, name: "Kafka Topics", desc: "Provision billing event topics" },
    {
      step: 3,
      name: "APISIX Rate Limits",
      desc: "Configure API rate limiting",
    },
    {
      step: 4,
      name: "Permify Policies",
      desc: "Set up RBAC billing permissions",
    },
    {
      step: 5,
      name: "Mojaloop Settlement",
      desc: "Register settlement participant",
    },
    { step: 6, name: "OpenSearch Index", desc: "Create analytics indices" },
    { step: 7, name: "Webhook Config", desc: "Configure webhook endpoints" },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">
          Tenant Billing Onboarding
        </h1>
        <p className="text-muted-foreground mt-1">
          Provision billing infrastructure for new tenants and white-label
          customers
        </p>
      </div>

      {/* New Tenant Form */}
      <div className="border rounded-lg p-6 mb-6 bg-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Provision New Tenant
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Tenant Name
            </label>
            <input
              type="text"
              value={newTenant.tenantName}
              onChange={(e: any) =>
                setNewTenant({ ...newTenant, tenantName: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
              placeholder="e.g., PayServ Uganda"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Billing Model
            </label>
            <select
              value={newTenant.billingModel}
              onChange={(e: any) =>
                setNewTenant({
                  ...newTenant,
                  billingModel: e.target.value as any,
                })
              }
              className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
            >
              <option value="revenue_share">Revenue Share</option>
              <option value="subscription">Subscription</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Region
            </label>
            <select
              value={newTenant.region}
              onChange={(e: any) =>
                setNewTenant({ ...newTenant, region: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
            >
              <option value="west_africa">West Africa</option>
              <option value="east_africa">East Africa</option>
              <option value="southern_africa">Southern Africa</option>
              <option value="central_africa">Central Africa</option>
            </select>
          </div>
          {newTenant.billingModel !== "subscription" && (
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Revenue Share %
              </label>
              <input
                type="number"
                value={newTenant.revenueSharePct}
                onChange={(e: any) =>
                  setNewTenant({
                    ...newTenant,
                    revenueSharePct: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
                min={0}
                max={100}
              />
            </div>
          )}
          {newTenant.billingModel !== "revenue_share" && (
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Monthly Subscription Fee (₦)
              </label>
              <input
                type="number"
                value={newTenant.subscriptionFee}
                onChange={(e: any) =>
                  setNewTenant({
                    ...newTenant,
                    subscriptionFee: Number(e.target.value),
                  })
                }
                className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Currency
            </label>
            <select
              value={newTenant.currency}
              onChange={(e: any) =>
                setNewTenant({ ...newTenant, currency: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-md bg-background text-foreground"
            >
              <option value="NGN">NGN (Nigerian Naira)</option>
              <option value="GHS">GHS (Ghanaian Cedi)</option>
              <option value="KES">KES (Kenyan Shilling)</option>
              <option value="USD">USD (US Dollar)</option>
            </select>
          </div>
        </div>
        <button
          onClick={() =>
            provisionBilling.mutate({
              tenantName: newTenant.tenantName,
              billingModel: newTenant.billingModel,
              revenueSharePercentage: newTenant.revenueSharePct,
              subscriptionFeeMonthly: newTenant.subscriptionFee,
              region: newTenant.region,
              currency: newTenant.currency,
            })
          }
          disabled={provisionBilling.isPending || !newTenant.tenantName}
          className="mt-4 px-6 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
        >
          {provisionBilling.isPending
            ? "Provisioning..."
            : "Provision Billing Infrastructure"}
        </button>
      </div>

      {/* Provisioning Steps */}
      <div className="border rounded-lg p-6 mb-6 bg-card">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Provisioning Pipeline
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
          {provisioningSteps.map((step: any) => (
            <div
              key={step.step}
              className="text-center p-3 border rounded-md bg-muted/30"
            >
              <div className="w-8 h-8 mx-auto mb-2 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold text-primary">
                {step.step}
              </div>
              <p className="text-xs font-medium text-foreground">{step.name}</p>
              <p className="text-xs text-muted-foreground mt-1">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Provisioned Tenants Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-muted">
          <h2 className="font-semibold text-foreground">Provisioned Tenants</h2>
        </div>
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                ID
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                Name
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                Model
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                Region
              </th>
              <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground">
                Provisioned
              </th>
              <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {provisionedTenants.map((t: any) => (
              <tr key={t.id} className="hover:bg-muted/50">
                <td className="px-4 py-3 text-sm font-mono text-foreground">
                  {t.id}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-foreground">
                  {t.name}
                </td>
                <td className="px-4 py-3 text-sm text-foreground capitalize">
                  {t.model.replace("_", " ")}
                </td>
                <td className="px-4 py-3 text-sm text-foreground capitalize">
                  {t.region.replace("_", " ")}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${t.status === "active" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {t.provisionedAt}
                </td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => toast.info("View billing config")}
                    className="text-xs text-primary hover:underline mr-2"
                  >
                    Config
                  </button>
                  <button
                    onClick={() => toast.info("View audit log")}
                    className="text-xs text-primary hover:underline"
                  >
                    Audit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
