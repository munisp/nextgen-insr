/**
 * MobileBottomNav — Role-aware bottom navigation bar for mobile PWA
 *
 * Shows 4-5 contextual tabs based on the current user's platform role.
 * Covers all 16 insurance domain roles with role-specific accent colors.
 * Uses safe-area-inset-bottom for iPhone notch/home indicator support.
 */

import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { useIsMobile } from "@/hooks/useMobile";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  Shield,
  DollarSign,
  Users,
  BarChart2,
  AlertTriangle,
  ClipboardList,
  TrendingUp,
  Scale,
  Building2,
  Receipt,
  UserCheck,
  Landmark,
  Settings,
  Bell,
  Home,
  Search,
  PlusCircle,
  CheckCircle,
  BookOpen,
  Activity,
  Wallet,
  HeartPulse,
  RefreshCw,
} from "lucide-react";

interface NavTab {
  label: string;
  icon: React.ElementType;
  href: string;
  badge?: number;
}

type InsuranceRole =
  | "super_admin" | "admin" | "supervisor"
  | "underwriter" | "actuary" | "claims_adjuster"
  | "broker" | "agent" | "policyholder"
  | "beneficiary" | "compliance_officer" | "regulator"
  | "reinsurer" | "billing_admin" | "billing_analyst" | "user";

const roleTabConfig: Record<InsuranceRole, NavTab[]> = {
  super_admin: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/admin" },
    { label: "Tenants",   icon: Building2,       href: "/tenant-management" },
    { label: "Analytics", icon: BarChart2,        href: "/analytics-dashboard" },
    { label: "Infra",     icon: Activity,         href: "/infrastructure-dashboard" },
    { label: "Settings",  icon: Settings,         href: "/system-settings" },
  ],
  admin: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/admin" },
    { label: "Agents",    icon: Users,            href: "/agent-management" },
    { label: "Reports",   icon: BarChart2,        href: "/analytics-dashboard" },
    { label: "Billing",   icon: Receipt,          href: "/billing-dashboard" },
    { label: "Settings",  icon: Settings,         href: "/system-settings" },
  ],
  supervisor: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/supervisor-dashboard" },
    { label: "Agents",    icon: Users,            href: "/agent-management" },
    { label: "Float",     icon: Wallet,           href: "/float-management" },
    { label: "SLA",       icon: Activity,         href: "/sla-monitoring" },
    { label: "Reports",   icon: BarChart2,        href: "/analytics-dashboard" },
  ],
  underwriter: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/underwriter-dashboard" },
    { label: "Queue",     icon: ClipboardList,    href: "/underwriting-queue" },
    { label: "Risks",     icon: Shield,           href: "/risk-assessment" },
    { label: "Products",  icon: FileText,         href: "/insurance-products" },
    { label: "Reports",   icon: BarChart2,        href: "/underwriting-reports" },
  ],
  actuary: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/actuary-dashboard" },
    { label: "Reserves",  icon: TrendingUp,       href: "/reserve-calculations" },
    { label: "IFRS17",    icon: BookOpen,         href: "/ifrs17-dashboard" },
    { label: "Models",    icon: Activity,         href: "/actuarial-models" },
    { label: "Reports",   icon: BarChart2,        href: "/actuarial-reports" },
  ],
  claims_adjuster: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/claims-dashboard" },
    { label: "Claims",    icon: ClipboardList,    href: "/claims-management" },
    { label: "New FNOL",  icon: PlusCircle,       href: "/fnol-submission" },
    { label: "Fraud",     icon: AlertTriangle,    href: "/fraud-case-management" },
    { label: "Settle",    icon: CheckCircle,      href: "/claims-settlement" },
  ],
  broker: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/broker-dashboard" },
    { label: "Clients",   icon: Users,            href: "/client-portfolio" },
    { label: "Policies",  icon: FileText,         href: "/policy-management" },
    { label: "Quote",     icon: PlusCircle,       href: "/quote-engine" },
    { label: "Commissions",icon: DollarSign,      href: "/commission-management" },
  ],
  agent: [
    { label: "Home",      icon: Home,             href: "/agent" },
    { label: "Sell",      icon: PlusCircle,       href: "/agent-micro-insurance" },
    { label: "Claims",    icon: ClipboardList,    href: "/insurance-claims" },
    { label: "Float",     icon: Wallet,           href: "/float-management" },
    { label: "Profile",   icon: UserCheck,        href: "/agent-profile" },
  ],
  policyholder: [
    { label: "Home",      icon: Home,             href: "/policyholder-dashboard" },
    { label: "Policies",  icon: FileText,         href: "/my-policies" },
    { label: "Claims",    icon: ClipboardList,    href: "/my-claims" },
    { label: "Pay",       icon: DollarSign,       href: "/premium-payment" },
    { label: "Profile",   icon: UserCheck,        href: "/my-profile" },
  ],
  beneficiary: [
    { label: "Home",      icon: Home,             href: "/beneficiary-dashboard" },
    { label: "Policies",  icon: FileText,         href: "/my-policies" },
    { label: "Claims",    icon: ClipboardList,    href: "/my-claims" },
    { label: "Documents", icon: BookOpen,         href: "/my-documents" },
    { label: "Profile",   icon: UserCheck,        href: "/my-profile" },
  ],
  compliance_officer: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/compliance-dashboard" },
    { label: "AML/KYC",   icon: Shield,           href: "/aml-kyc-management" },
    { label: "Audit",     icon: BookOpen,         href: "/audit-trail" },
    { label: "Reports",   icon: BarChart2,        href: "/compliance-reporting" },
    { label: "Alerts",    icon: AlertTriangle,    href: "/compliance-alerts" },
  ],
  regulator: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/regulator-dashboard" },
    { label: "Reports",   icon: FileText,         href: "/regulatory-reports" },
    { label: "Solvency",  icon: TrendingUp,       href: "/solvency-reporting" },
    { label: "Audit",     icon: BookOpen,         href: "/regulatory-audit" },
    { label: "Search",    icon: Search,           href: "/regulatory-search" },
  ],
  reinsurer: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/reinsurer-dashboard" },
    { label: "Treaties",  icon: Scale,            href: "/reinsurance-treaties" },
    { label: "Claims",    icon: ClipboardList,    href: "/reinsurance-claims" },
    { label: "Premiums",  icon: DollarSign,       href: "/reinsurance-premiums" },
    { label: "Reports",   icon: BarChart2,        href: "/reinsurance-reports" },
  ],
  billing_admin: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/billing-dashboard" },
    { label: "Ledger",    icon: Receipt,          href: "/billing-ledger" },
    { label: "Reconcile", icon: RefreshCw,        href: "/reconciliation" },
    { label: "Revenue",   icon: TrendingUp,       href: "/revenue-analytics" },
    { label: "Settings",  icon: Settings,         href: "/billing-settings" },
  ],
  billing_analyst: [
    { label: "Dashboard", icon: LayoutDashboard, href: "/billing-dashboard" },
    { label: "Ledger",    icon: Receipt,          href: "/billing-ledger" },
    { label: "Reports",   icon: BarChart2,        href: "/billing-analytics" },
    { label: "Export",    icon: BookOpen,         href: "/billing-export" },
    { label: "Profile",   icon: UserCheck,        href: "/my-profile" },
  ],
  user: [
    { label: "Home",      icon: Home,             href: "/" },
    { label: "Policies",  icon: FileText,         href: "/my-policies" },
    { label: "Claims",    icon: ClipboardList,    href: "/my-claims" },
    { label: "Alerts",    icon: Bell,             href: "/notifications" },
    { label: "Profile",   icon: UserCheck,        href: "/my-profile" },
  ],
};

/** Map platform role string → InsuranceRole key */
function resolveRole(role?: string): InsuranceRole {
  if (!role) return "user";
  const map: Record<string, InsuranceRole> = {
    super_admin:        "super_admin",
    admin:              "admin",
    supervisor:         "supervisor",
    underwriter:        "underwriter",
    actuary:            "actuary",
    claims_adjuster:    "claims_adjuster",
    "claims-adjuster":  "claims_adjuster",
    broker:             "broker",
    agent:              "agent",
    policyholder:       "policyholder",
    beneficiary:        "beneficiary",
    compliance_officer: "compliance_officer",
    "compliance-officer":"compliance_officer",
    regulator:          "regulator",
    reinsurer:          "reinsurer",
    billing_admin:      "billing_admin",
    "billing-admin":    "billing_admin",
    billing_analyst:    "billing_analyst",
    "billing-analyst":  "billing_analyst",
  };
  return map[role] ?? "user";
}

/** Role → CSS accent variable */
const roleAccent: Record<InsuranceRole, string> = {
  super_admin:        "var(--role-super-admin)",
  admin:              "var(--role-admin)",
  supervisor:         "var(--role-supervisor)",
  underwriter:        "var(--role-underwriter)",
  actuary:            "var(--role-actuary)",
  claims_adjuster:    "var(--role-claims-adjuster)",
  broker:             "var(--role-broker)",
  agent:              "var(--role-agent)",
  policyholder:       "var(--role-policyholder)",
  beneficiary:        "var(--role-beneficiary)",
  compliance_officer: "var(--role-compliance-officer)",
  regulator:          "var(--role-regulator)",
  reinsurer:          "var(--role-reinsurer)",
  billing_admin:      "var(--role-billing-admin)",
  billing_analyst:    "var(--role-billing-analyst)",
  user:               "var(--role-user)",
};

export function MobileBottomNav() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [location, navigate] = useLocation();

  if (!isMobile) return null;

  const role = resolveRole((user as any)?.platformRole ?? (user as any)?.role);
  const tabs = roleTabConfig[role] ?? roleTabConfig.user;
  const accent = roleAccent[role];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 touch-feedback"
      style={{
        background: "var(--bottom-nav-bg)",
        borderTop: "1px solid var(--bottom-nav-border)",
        paddingBottom: "var(--safe-area-bottom)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
      aria-label="Mobile navigation"
    >
      <div className="flex items-stretch justify-around h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive =
            location === tab.href ||
            (tab.href !== "/" && location.startsWith(tab.href));

          return (
            <button
              key={tab.href}
              onClick={() => navigate(tab.href)}
              className={cn(
                "flex flex-col items-center justify-center flex-1 gap-1 px-1 py-2",
                "touch-feedback transition-all duration-150",
                "relative min-w-0"
              )}
              style={{
                color: isActive ? accent : "var(--bottom-nav-inactive)",
              }}
              aria-label={tab.label}
              aria-current={isActive ? "page" : undefined}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span
                  className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full"
                  style={{ background: accent }}
                />
              )}

              {/* Badge */}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  className="absolute top-1.5 right-1/2 translate-x-3 -translate-y-0.5
                             min-w-[1.1rem] h-[1.1rem] rounded-full text-[0.6rem] font-bold
                             flex items-center justify-center"
                  style={{
                    background: "var(--risk-critical)",
                    color: "#fff",
                    lineHeight: 1,
                  }}
                >
                  {tab.badge > 99 ? "99+" : tab.badge}
                </span>
              )}

              <Icon
                size={22}
                strokeWidth={isActive ? 2.2 : 1.8}
                className="transition-transform duration-150"
                style={{
                  transform: isActive ? "scale(1.08)" : "scale(1)",
                }}
              />
              <span
                className="text-[0.65rem] font-medium leading-none truncate max-w-full"
                style={{ fontFamily: "var(--font-body)" }}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default MobileBottomNav;
