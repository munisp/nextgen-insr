/**
 * Payment Cancel Callback Page — InsurePortal Shell
 * Displays cancellation message with retry CTA after Stripe checkout cancellation.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { XCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { Link } from "wouter";

export default function PaymentCancel() {
  return (
    <DashboardLayout>
      <div className="max-w-lg mx-auto text-center py-16 space-y-6">
        <div className="h-20 w-20 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto">
          <XCircle className="h-10 w-10 text-amber-500" />
        </div>

        <div>
          <h1 className="text-2xl font-bold">Payment Cancelled</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Your payment was not completed. No charges have been made to your
            account.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 text-left">
          <h3 className="text-sm font-semibold mb-2">What happened?</h3>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li>
              • You cancelled the checkout process before completing payment
            </li>
            <li>• No charges were applied to your payment method</li>
            <li>• You can try again at any time from the Payments page</li>
          </ul>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
          <Link href="/payments">
            <Button>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Try Again
            </Button>
          </Link>
          <Link href="/">
            <Button variant="outline">
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </DashboardLayout>
  );
}
