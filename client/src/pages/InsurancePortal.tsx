import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Link } from "wouter";
import {
  LayoutGrid,
  Users,
  UserRound,
  Store,
  Briefcase,
  FileText,
  Wallet,
  MonitorSmartphone,
  RefreshCw,
  Activity,
} from "lucide-react";

const SECTIONS: {
  title: string;
  description: string;
  href: string;
  icon: typeof LayoutGrid;
}[] = [
  {
    title: "Platform Hub",
    description: "Central hub for all platform modules",
    href: "/hub",
    icon: LayoutGrid,
  },
  {
    title: "Agent Portal",
    description: "Agent float, commissions, and performance",
    href: "/agent",
    icon: Users,
  },
  {
    title: "Customer Portal",
    description: "Customer policies, claims, and wallet",
    href: "/customer",
    icon: UserRound,
  },
  {
    title: "Merchant Portal",
    description: "Merchant transactions, settlements, and disputes",
    href: "/merchant",
    icon: Store,
  },
  {
    title: "Management Portal",
    description: "Operational management and oversight",
    href: "/management",
    icon: Briefcase,
  },
  {
    title: "Policy Quotes",
    description: "Pending insurance policy quotes",
    href: "/insurance/policy-quotes",
    icon: FileText,
  },
  {
    title: "Float Management",
    description: "Agent premium reserve balances and limits",
    href: "/float-management",
    icon: Wallet,
  },
  {
    title: "Terminal Fleet",
    description: "Insurance service fleet status and diagnostics",
    href: "/terminal-fleet",
    icon: MonitorSmartphone,
  },
  {
    title: "POS Service Updates",
    description: "Service and maintenance records for POS terminals",
    href: "/pos-service-update",
    icon: RefreshCw,
  },
  {
    title: "System Status",
    description: "Platform availability and service health",
    href: "/system-status",
    icon: Activity,
  },
];

/**
 * InsurancePortal — signed-in landing page for the InsurePortal platform.
 * Renders navigation to the real platform modules; no placeholder data.
 */
export default function InsurancePortal() {
  const me = trpc.auth.me.useQuery(undefined, { retry: 0 });

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">InsurePortal</h1>
        <p className="text-muted-foreground mt-1">
          {me.data
            ? "Welcome back. Select a module to continue."
            : "Insurance management platform for the Nigerian market. Select a module to continue."}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {SECTIONS.map(section => {
          const Icon = section.icon;
          return (
            <Link key={section.href} href={section.href}>
              <Card className="h-full cursor-pointer transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="w-5 h-5" />
                    {section.title}
                  </CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
