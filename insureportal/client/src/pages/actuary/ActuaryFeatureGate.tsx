/**
 * ActuaryFeatureGate.tsx — W34-D (2026-11-28): renders the actuary pages'
 * content only when the actuaryEngine feature flag is enabled; otherwise an
 * HONEST disabled panel (no fabricated data, no dead UI).
 */
import type { ReactNode } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import { isActuaryEngineEnabled } from "./featureFlag";

export default function ActuaryFeatureGate({
  children,
}: {
  children: ReactNode;
}) {
  if (!isActuaryEngineEnabled()) {
    return (
      <DashboardLayout>
        <div className="p-6 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-500" />
                Actuary Engine
                <Badge variant="outline">feature flag: actuaryEngine</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                The actuary engine portal is currently disabled. It is gated
                behind the <code>actuaryEngine</code> feature flag while the
                pricing service (Go, W34-B) and analytics pipeline (Python,
                W34-C) are rolled out.
              </p>
              <p>
                To enable for this deployment, set{" "}
                <code>VITE_ACTUARY_ENGINE=true</code> at build time. No data is
                fabricated in the disabled state.
              </p>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }
  return <>{children}</>;
}
