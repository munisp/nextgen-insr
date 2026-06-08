/**
 * Payment Success Callback Page — InsurePortal Shell
 * Displays confirmation after successful Stripe checkout.
 */
import { useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, ArrowLeft, CreditCard, ExternalLink } from "lucide-react";
import { Link } from "wouter";

export default function PaymentSuccess() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const sessionId = params.get("session_id");

  const { data: session, isLoading } = trpc.stripe.getCheckoutSession.useQuery(
    { sessionId: sessionId || "" },
    { enabled: !!sessionId }
  );

  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto text-center py-16 space-y-6">
        <div className="h-20 w-20 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mx-auto">
          <CheckCircle className="h-10 w-10 text-green-500" />
        </div>

        <div>
          <h1 className="text-2xl font-bold">Payment Successful!</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your payment has been processed successfully. Thank you for your
            purchase.
          </p>
        </div>

        {session && (
          <div className="rounded-xl border border-border bg-card p-5 text-left space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Status</span>
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                {session.paymentStatus}
              </Badge>
            </div>
            {session.amountTotal != null && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Amount</span>
                <span className="text-sm font-semibold">
                  ${(session.amountTotal / 100).toFixed(2)}{" "}
                  {session.currency?.toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Session</span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {session.id?.slice(0, 24)}...
              </span>
            </div>
          </div>
        )}

        {isLoading && (
          <p className="text-xs text-muted-foreground animate-pulse">
            Loading payment details...
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Link href="/payments">
            <Button variant="outline">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Payments
            </Button>
          </Link>
          <Link href="/">
            <Button>
              <CreditCard className="h-3.5 w-3.5 mr-1" /> Go to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
