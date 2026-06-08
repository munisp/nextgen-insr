/**
 * Payments Page — InsurePortal Shell
 *
 * Displays subscription plans, one-time products, payment history,
 * active subscription management (cancel, portal), and checkout status.
 * All data is user-specific via protectedProcedure.
 */
import { useState, useEffect, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  Check,
  Zap,
  Crown,
  Star,
  ExternalLink,
  Loader2,
  Clock,
  DollarSign,
  ArrowRight,
  AlertCircle,
  XCircle,
  Settings,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function Payments() {
  const { user } = useAuth();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [loadingProduct, setLoadingProduct] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);

  // Check URL params for status (stabilized with useMemo)
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const status = params.get("status");
  const sessionId = params.get("session_id");

  const { data: plansData } = trpc.stripe.getPlans.useQuery();
  const { data: historyData, refetch: refetchHistory } =
    trpc.stripe.getPaymentHistory.useQuery();
  const { data: subData, refetch: refetchSubs } =
    trpc.stripe.getSubscriptionStatus.useQuery();
  const { data: sessionData } = trpc.stripe.getCheckoutSession.useQuery(
    { sessionId: sessionId || "" },
    { enabled: !!sessionId }
  );

  const createSubCheckout =
    trpc.stripe.createSubscriptionCheckout.useMutation();
  const createOneTimeCheckout = trpc.stripe.createOneTimeCheckout.useMutation();
  const cancelSubscription = trpc.stripe.cancelSubscription.useMutation();
  const createPortalSession = trpc.stripe.createPortalSession.useMutation();

  // Show toast on successful payment
  useEffect(() => {
    if (status === "success" && sessionId) {
      toast.success("Payment successful! Your account has been updated.");
      refetchHistory();
      refetchSubs();
    }
  }, [status, sessionId]);

  const handleSubscribe = async (planId: string) => {
    setLoadingPlan(planId);
    try {
      const result = await createSubCheckout.mutateAsync({ planId });
      if (result.url) {
        toast.info("Redirecting to Stripe checkout...");
        window.open(result.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to create checkout session");
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleBuyProduct = async (productId: string) => {
    setLoadingProduct(productId);
    try {
      const result = await createOneTimeCheckout.mutateAsync({ productId });
      if (result.url) {
        toast.info("Redirecting to Stripe checkout...");
        window.open(result.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to create checkout session");
    } finally {
      setLoadingProduct(null);
    }
  };

  const handleCancelSubscription = async (subscriptionId: string) => {
    setCancelLoading(subscriptionId);
    try {
      await cancelSubscription.mutateAsync({ subscriptionId });
      toast.success(
        "Subscription will be cancelled at the end of the billing period."
      );
      refetchSubs();
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel subscription");
    } finally {
      setCancelLoading(null);
    }
  };

  const handleOpenPortal = async () => {
    setPortalLoading(true);
    try {
      const result = await createPortalSession.mutateAsync();
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to open billing portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const planIcons: Record<string, any> = {
    basic: Zap,
    standard: Star,
    premium: Crown,
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-6xl mx-auto">
        {/* Status Banner */}
        {status === "success" && (
          <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30 flex items-center gap-3">
            <Check className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-sm text-green-400 font-medium">
                Payment successful!
              </p>
              {sessionData && (
                <p className="text-xs text-green-400/70 mt-0.5">
                  Amount: ${((sessionData.amountTotal || 0) / 100).toFixed(2)}{" "}
                  {sessionData.currency?.toUpperCase()}
                </p>
              )}
            </div>
          </div>
        )}
        {status === "cancelled" && (
          <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            <p className="text-sm text-amber-400">
              Payment was cancelled. You can try again anytime.
            </p>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <CreditCard className="h-6 w-6 text-primary" />
              Payments & Subscriptions
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Manage your subscription plan and view payment history
              {user && (
                <span className="ml-1">— {user.name || user.email}</span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenPortal}
            disabled={portalLoading}
          >
            {portalLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Settings className="h-3.5 w-3.5 mr-1" />
            )}
            Billing Portal
          </Button>
        </div>

        {/* Active Subscription */}
        {subData?.activePlan && (
          <div className="p-5 rounded-xl border border-primary/30 bg-primary/5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <Check className="h-4 w-4 text-primary" />
                Active Subscription
              </h3>
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                {subData.activePlan.status}
              </Badge>
            </div>
            <p className="text-lg font-bold capitalize">
              {subData.activePlan.planName || subData.activePlan.planId}
            </p>
          </div>
        )}

        {subData?.subscriptions && subData.subscriptions.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Your Subscriptions</h3>
            {subData.subscriptions.map(sub => (
              <div
                key={sub.id}
                className="p-4 rounded-lg border border-border bg-card flex items-center justify-between"
              >
                <div>
                  <p className="text-sm font-medium capitalize">
                    {sub.planId} Plan
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {sub.cancelAtPeriodEnd ? "Cancels" : "Renews"}:{" "}
                    {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      sub.status === "active" &&
                        "text-green-400 border-green-500/30",
                      sub.cancelAtPeriodEnd &&
                        "text-amber-400 border-amber-500/30"
                    )}
                  >
                    {sub.cancelAtPeriodEnd ? "Cancelling" : sub.status}
                  </Badge>
                  {!sub.cancelAtPeriodEnd && sub.status === "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:text-red-300 text-xs"
                      onClick={() => handleCancelSubscription(sub.id)}
                      disabled={cancelLoading === sub.id}
                    >
                      {cancelLoading === sub.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <XCircle className="h-3 w-3 mr-1" />
                      )}
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Subscription Plans */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Subscription Plans</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plansData?.plans.map(plan => {
              const Icon = planIcons[plan.id] || Zap;
              const isPopular = plan.id === "standard";
              const isCurrentPlan = subData?.activePlan?.planId === plan.id;

              return (
                <div
                  key={plan.id}
                  className={cn(
                    "relative rounded-xl border p-6 flex flex-col",
                    isCurrentPlan
                      ? "border-green-500/50 bg-green-500/5"
                      : isPopular
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card"
                  )}
                >
                  {isCurrentPlan && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[10px]">
                      Current Plan
                    </Badge>
                  )}
                  {isPopular && !isCurrentPlan && (
                    <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px]">
                      Most Popular
                    </Badge>
                  )}

                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-lg flex items-center justify-center",
                        isPopular ? "bg-primary/20" : "bg-muted"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-5 w-5",
                          isPopular ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold">{plan.name}</h3>
                      <p className="text-[10px] text-muted-foreground">
                        {plan.description}
                      </p>
                    </div>
                  </div>

                  <div className="mb-4">
                    <span className="text-3xl font-bold">
                      ${(plan.monthlyPriceUSD / 100).toFixed(0)}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      /month
                    </span>
                  </div>

                  <ul className="space-y-2 mb-6 flex-1">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <Check className="h-3.5 w-3.5 text-green-500 mt-0.5 flex-shrink-0" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={loadingPlan === plan.id || isCurrentPlan}
                    variant={
                      isCurrentPlan
                        ? "secondary"
                        : isPopular
                          ? "default"
                          : "outline"
                    }
                    className="w-full"
                  >
                    {loadingPlan === plan.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isCurrentPlan ? (
                      <>
                        Active <Check className="h-3.5 w-3.5 ml-1" />
                      </>
                    ) : (
                      <>
                        Subscribe <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        {/* One-Time Products */}
        <div>
          <h2 className="text-lg font-semibold mb-4">One-Time Services</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plansData?.oneTimeProducts.map(product => (
              <div
                key={product.id}
                className="rounded-xl border border-border p-5 bg-card"
              >
                <h3 className="font-semibold text-sm mb-1">{product.name}</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  {product.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-lg font-bold">
                    ${(product.priceUSD / 100).toFixed(2)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBuyProduct(product.id)}
                    disabled={loadingProduct === product.id}
                  >
                    {loadingProduct === product.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <>
                        Buy <ExternalLink className="h-3 w-3 ml-1" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment History */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Payment History</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                refetchHistory();
                toast.info("Refreshed");
              }}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
          {historyData?.payments && historyData.payments.length > 0 ? (
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Date
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Description
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Amount
                    </th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {historyData.payments.map(payment => (
                    <tr key={payment.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 text-xs">
                        {new Date(payment.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {payment.description ||
                          payment.metadata?.plan_name ||
                          payment.metadata?.product_name ||
                          "Payment"}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">
                        ${(payment.amount / 100).toFixed(2)}{" "}
                        {payment.currency?.toUpperCase()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            payment.status === "succeeded" &&
                              "text-green-400 border-green-500/30",
                            payment.status === "processing" &&
                              "text-amber-400 border-amber-500/30",
                            payment.status === "canceled" &&
                              "text-red-400 border-red-500/30"
                          )}
                        >
                          {payment.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-12 rounded-xl border border-border bg-card">
              <DollarSign className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No payment history yet
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Payments will appear here after your first transaction
              </p>
            </div>
          )}
        </div>

        {/* Test Card Info */}
        <div className="p-4 rounded-lg bg-muted/30 border border-border">
          <h3 className="text-xs font-semibold mb-1 flex items-center gap-2">
            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
            Test Mode
          </h3>
          <p className="text-xs text-muted-foreground">
            Use card number{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
              4242 4242 4242 4242
            </code>{" "}
            with any future expiry date and CVC for testing.
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
