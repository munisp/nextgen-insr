import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { getLoginUrl } from "@/const";
import {
  filterNavGroupsByRole,
  canAccessRoute,
  getRoleDisplayName,
  getRoleBadgeColor,
} from "@/lib/roleNavConfig";
import { useIsMobile } from "@/hooks/useMobile";
import { useNotificationContext } from "@/contexts/NotificationContext";
import { NotificationCenter } from "@/components/NotificationCenter";
import LanguageSelector from "@/components/LanguageSelector";
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  BarChart2,
  Bell,
  BellRing,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronRight,
  Clock,
  Code2,
  Cog,
  CreditCard,
  Database,
  DollarSign,
  Download,
  FileText,
  Filter,
  Fingerprint,
  Gift,
  Globe,
  HardDrive,
  Key,
  Landmark,
  Layers,
  LayoutDashboard,
  Link,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  PanelLeft,
  Phone,
  PiggyBank,
  Receipt,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  ShoppingBag,
  Signal,
  Smartphone,
  Star,
  Store,
  Ticket,
  Timer,
  Trophy,
  Truck,
  UserCheck,
  UserPlus,
  Users,
  Video,
  Wallet,
  Webhook,
  WifiOff,
  Zap,
  Brain,
  Network,
  Cpu,
  FlaskConical,
  Workflow,
  MessageCircle,
  Award,
  Scale,
  GraduationCap,
  TestTube2,
  BarChart3,
  GitBranch,
  ToggleLeft,
  TrendingUp,
  CheckCircle,
  Map,
  FileSearch,
  MessageSquarePlus,
  Repeat,
  Gavel,
  BookMarked,
  FolderTree,
  Tag,
  Heart,
  Crosshair,
  Monitor,
  Megaphone,
  ClipboardList,
  ScrollText,
  Palette,
  FileOutput,
  Loader,
  UserCircle,
  Gauge,
  Radio,
  Shuffle,
  FileCheck,
  AlertOctagon,
  Sparkles,
  Package,
  Lightbulb,
  Rocket,
  Calculator,
  Mic,
  Share2,
  Leaf,
  Flame,
  Server,
  Cloud,
  Upload,
  Sliders,
  RotateCcw,
  ArrowLeftRight,
  ShieldCheck,
  UserX,
  ShieldAlert,
  Inbox,
} from "lucide-react";
import { CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

// ─── Navigation Structure ─────────────────────────────────────────────────────
// Organized into logical categories for optimal UX

interface NavItem {
  icon: any;
  label: string;
  path: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: any;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  // ── 1. Core ──
  {
    id: "core",
    label: "Core",
    icon: LayoutDashboard,
    items: [
      { icon: LayoutDashboard, label: "POS Terminal", path: "/" },
      { icon: Globe, label: "Platform Hub", path: "/hub" },
    ],
  },
  // ── 2. Portals ──
  {
    id: "portals",
    label: "Portals",
    icon: Users,
    items: [
      { icon: Users, label: "Agent Portal", path: "/agent" },
      { icon: UserCheck, label: "Customer Portal", path: "/customer" },
      { icon: ShoppingBag, label: "Merchant Portal", path: "/merchant" },
      { icon: Code2, label: "Developer Portal", path: "/developer" },
    ],
  },
  // ── 3. Administration ──
  {
    id: "admin",
    label: "Administration",
    icon: Shield,
    items: [
      { icon: Shield, label: "Admin Panel", path: "/admin" },
      { icon: Users, label: "Management", path: "/management" },
      { icon: Activity, label: "Supervisor", path: "/supervisor" },
      { icon: Zap, label: "Super Admin", path: "/super-admin" },
      { icon: FileText, label: "Audit Log", path: "/admin/audit" },
      { icon: Download, label: "Audit Export", path: "/audit-export" },
      { icon: Clock, label: "Session Manager", path: "/session-manager" },
      { icon: BookOpen, label: "Platform Changelog", path: "/changelog" },
    ],
  },
  // ── 4. Analytics & Reporting ──
  {
    id: "analytics",
    label: "Analytics & Reporting",
    icon: BarChart2,
    items: [
      {
        icon: BarChart2,
        label: "Analytics Dashboard",
        path: "/admin/analytics",
      },
      { icon: Activity, label: "Fraud Dashboard", path: "/admin/fraud" },
      { icon: Database, label: "Lakehouse", path: "/lakehouse" },
      { icon: Trophy, label: "Agent Performance", path: "/agent-performance" },
      {
        icon: BarChart2,
        label: "Platform Analytics",
        path: "/platform-analytics",
      },
      { icon: Shield, label: "CBN Reporting", path: "/cbn-reporting" },
      {
        icon: BellRing,
        label: "Notification Analytics",
        path: "/notification-analytics",
      },
      {
        icon: FileText,
        label: "Scheduled Reports",
        path: "/scheduled-reports",
      },
      { icon: FileText, label: "Report Designer", path: "/report-designer" },
      { icon: FileText, label: "Shared Layouts", path: "/shared-layouts" },
      { icon: Download, label: "Data Export Center", path: "/data-export" },
      { icon: FileText, label: "Weekly Reports", path: "/weekly-reports" },
      {
        icon: BarChart2,
        label: "Report Comparison",
        path: "/report-comparison",
      },
      {
        icon: Mail,
        label: "Scheduled Delivery",
        path: "/scheduled-email-delivery",
      },
    ],
  },
  // ── 5. Agent & Onboarding ──
  {
    id: "agents",
    label: "Agent Management",
    icon: UserPlus,
    items: [
      { icon: UserPlus, label: "Agent Onboarding", path: "/agent-onboarding" },
      {
        icon: UserPlus,
        label: "Onboarding Wizard",
        path: "/onboarding-wizard",
      },
      { icon: UserCheck, label: "KYC Workflow", path: "/kyc-workflow" },
      { icon: MapPin, label: "Geofence Editor", path: "/geofence-editor" },
      { icon: Users, label: "Agent Admin", path: "/agent-management" },
      {
        icon: Trophy,
        label: "Performance Scoring",
        path: "/agent-performance-scoring",
      },
      { icon: FileText, label: "KYC Verification", path: "/kyc-verification" },
    ],
  },
  // ── 6. Transactions & Finance ──
  {
    id: "finance",
    label: "Transactions & Finance",
    icon: DollarSign,
    items: [
      {
        icon: Wallet,
        label: "Commission Payouts",
        path: "/commission-payouts",
      },
      {
        icon: DollarSign,
        label: "Commission Config",
        path: "/commission-config",
      },
      {
        icon: FileText,
        label: "Settlement Recon",
        path: "/settlement-reconciliation",
      },
      { icon: Wallet, label: "Customer Wallet", path: "/customer-wallet" },
      { icon: Globe, label: "Multi-Currency", path: "/multi-currency" },
      { icon: ArrowRightLeft, label: "Rate Alerts", path: "/rate-alerts" },
      { icon: Filter, label: "Batch Operations", path: "/batch-operations" },
      {
        icon: Shield,
        label: "Dispute Auto-Rules",
        path: "/dispute-auto-rules",
      },
    ],
  },
  // ── 7. Engagement & Loyalty ──
  {
    id: "engagement",
    label: "Engagement & Loyalty",
    icon: Gift,
    items: [
      { icon: Gift, label: "Referral Program", path: "/referral-program" },
      { icon: Star, label: "Loyalty System", path: "/loyalty" },
      { icon: MessageSquare, label: "Live Chat", path: "/live-chat" },
      { icon: Send, label: "Broadcast Manager", path: "/broadcast-manager" },
      {
        icon: MessageSquare,
        label: "Reactions",
        path: "/announcement-reactions",
      },
    ],
  },
  // ── 8. Notifications ──
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    items: [
      { icon: Bell, label: "Preferences", path: "/notification-preferences" },
      {
        icon: Mail,
        label: "Preference Matrix",
        path: "/notification-preference-matrix",
      },
      { icon: Bell, label: "Notification Inbox", path: "/notification-inbox" },
      {
        icon: Settings,
        label: "Notification Settings",
        path: "/notification-settings",
      },
      { icon: Clock, label: "Quiet Hours", path: "/quiet-hours" },
      { icon: FileText, label: "Templates", path: "/notification-templates" },
      { icon: Send, label: "Bulk Sender", path: "/bulk-notifications" },
      {
        icon: AlertTriangle,
        label: "Escalation Chains",
        path: "/escalation-chains",
      },
      {
        icon: AlertTriangle,
        label: "Threshold Alerts",
        path: "/threshold-alerts",
      },
      { icon: Bell, label: "Push Notifications", path: "/push-notifications" },
      {
        icon: AlertTriangle,
        label: "Threshold Manager",
        path: "/threshold-manager",
      },
    ],
  },
  // ── 9. Integrations & Webhooks ──
  {
    id: "integrations",
    label: "Integrations & Webhooks",
    icon: Webhook,
    items: [
      { icon: Link, label: "Webhooks", path: "/webhooks" },
      {
        icon: Webhook,
        label: "Webhook Deliveries",
        path: "/webhook-deliveries",
      },
      { icon: Cog, label: "Webhook Config", path: "/webhook-config" },
      { icon: Key, label: "API Key Management", path: "/api-keys" },
      { icon: Link, label: "MQTT Bridge", path: "/mqtt-bridge" },
      {
        icon: Webhook,
        label: "Webhook Monitor",
        path: "/webhook-delivery-monitor",
      },
      {
        icon: Shield,
        label: "Endpoint Rate Limits",
        path: "/endpoint-rate-limits",
      },
    ],
  },
  // ── 10. Multi-Tenant & White Label ──
  {
    id: "tenant",
    label: "White Label & Tenants",
    icon: Building2,
    items: [
      {
        icon: Building2,
        label: "Partner Onboarding",
        path: "/partner/onboard",
      },
      { icon: Building2, label: "Tenant Admin", path: "/admin/tenant" },
      { icon: Ticket, label: "Invite Codes", path: "/admin/invite-codes" },
    ],
  },
  // ── 11. Infrastructure & System ──
  {
    id: "infra",
    label: "Infrastructure & System",
    icon: HardDrive,
    items: [
      { icon: Database, label: "Infrastructure", path: "/infrastructure" },
      { icon: Settings, label: "System Health", path: "/system-health" },
      { icon: Settings, label: "System Config", path: "/system-config" },
      {
        icon: Timer,
        label: "Compliance Scheduling",
        path: "/compliance-scheduling",
      },
      { icon: Shield, label: "GDPR Dashboard", path: "/gdpr" },
      { icon: FileText, label: "Business Rules", path: "/business-rules" },
      { icon: Activity, label: "Service Health", path: "/service-health" },
      { icon: RefreshCw, label: "Retry Queue", path: "/retry-queue" },
      {
        icon: BarChart2,
        label: "Rate Limit Dashboard",
        path: "/rate-limit-dashboard",
      },
      { icon: Database, label: "Cache Management", path: "/cache-management" },
      {
        icon: Activity,
        label: "Health Monitor",
        path: "/system-health-monitor",
      },
      { icon: Database, label: "TigerBeetle Ledger", path: "/tigerbeetle" },
      { icon: RefreshCw, label: "Temporal Workflows", path: "/temporal" },
      { icon: Key, label: "Vault Secrets", path: "/vault" },
      { icon: Zap, label: "Resilience Monitor", path: "/resilience" },
      { icon: HardDrive, label: "SIM Orchestrator", path: "/sim-orchestrator" },
      {
        icon: Zap,
        label: "Production Readiness",
        path: "/production-readiness",
      },
      { icon: Search, label: "Global Search", path: "/global-search" },
      { icon: Shield, label: "Audit Trail", path: "/audit-trail" },
    ],
  },
  // ── 12. Nigerian Insurance ──
  {
    id: "insurance",
    label: "Insurance",
    icon: Banknote,
    items: [
      { icon: Phone, label: "USSD Gateway", path: "/ussd-gateway" },
      { icon: Smartphone, label: "Mobile Money", path: "/mobile-money" },
      { icon: Users, label: "Agent Hierarchy", path: "/agent-hierarchy" },
      {
        icon: DollarSign,
        label: "Commission Engine",
        path: "/commission-engine",
      },
      { icon: Layers, label: "Bulk Operations", path: "/bulk-operations" },
      { icon: MapPin, label: "Geo-Fencing", path: "/geo-fencing" },
      { icon: Fingerprint, label: "Biometric Auth", path: "/biometric-auth" },
      { icon: WifiOff, label: "Offline Sync", path: "/offline-sync" },
      {
        icon: MessageSquare,
        label: "WhatsApp Channel",
        path: "/whatsapp-channel",
      },
    ],
  },
  // ── 13. Financial Services ──
  {
    id: "financial-services",
    label: "Financial Services",
    icon: Landmark,
    items: [
      { icon: Store, label: "Merchant Payments", path: "/merchant-payments" },
      { icon: Zap, label: "Bill Payments", path: "/bill-payments" },
      { icon: Signal, label: "Airtime & Data", path: "/airtime-vending" },
      {
        icon: Banknote,
        label: "Loan Disbursement",
        path: "/loan-disbursement",
      },
      {
        icon: Shield,
        label: "Insurance Products",
        path: "/insurance-products",
      },
      { icon: PiggyBank, label: "Savings Products", path: "/savings-products" },
      {
        icon: Gift,
        label: "Referral Program v2",
        path: "/referral-program-v2",
      },
      { icon: CreditCard, label: "Card Requests", path: "/card-requests" },
      { icon: UserPlus, label: "Account Opening", path: "/account-opening" },
      { icon: Receipt, label: "Tax Collection", path: "/tax-collection" },
      {
        icon: Landmark,
        label: "Pension Collection",
        path: "/pension-collection",
      },
      { icon: Send, label: "Remittance", path: "/remittance" },
    ],
  },
  // ── 13b. Billing Engine ──
  {
    id: "billing-engine",
    label: "Billing Engine",
    icon: Receipt,
    items: [
      {
        icon: BarChart3,
        label: "Billing Dashboard",
        path: "/billing-dashboard",
      },
      {
        icon: FileText,
        label: "Invoice Management",
        path: "/invoice-management",
      },
      {
        icon: UserPlus,
        label: "Tenant Onboarding",
        path: "/tenant-billing-onboarding",
      },
      { icon: CreditCard, label: "Billing Portal", path: "/billing/portal" },
    ],
  },
  // ── 14. AI/ML/DL/GNN Integrations ──
  {
    id: "ai-ml",
    label: "AI & ML Platform",
    icon: Brain,
    items: [
      {
        icon: Search,
        label: "Qdrant Vector Search",
        path: "/qdrant-vector-search",
      },
      { icon: Network, label: "FalkorDB Graph", path: "/falkordb-graph" },
      {
        icon: Workflow,
        label: "CocoIndex Pipeline",
        path: "/cocoindex-pipeline",
      },
      { icon: Cpu, label: "Ollama Local LLM", path: "/ollama-llm" },
      { icon: FlaskConical, label: "ART Robustness", path: "/art-robustness" },
      { icon: Activity, label: "Lakehouse AI Hub", path: "/lakehouse-ai" },
      { icon: BarChart2, label: "ML Scoring Service", path: "/ml-scoring" },
      { icon: Activity, label: "AI Monitoring", path: "/ai-monitoring" },
      { icon: FileText, label: "Fraud Reports", path: "/fraud-reports" },
      {
        icon: MessageCircle,
        label: "Compliance Chatbot",
        path: "/compliance-chatbot",
      },
    ],
  },
  // ── 15. Data Pipelines & Orchestration ──
  {
    id: "data-pipelines",
    label: "Data Pipelines",
    icon: Layers,
    items: [
      { icon: Activity, label: "Apache NiFi", path: "/apache-nifi" },
      { icon: Database, label: "dbt Integration", path: "/dbt-integration" },
      { icon: Clock, label: "Apache Airflow", path: "/apache-airflow" },
      { icon: Zap, label: "WebSocket Service", path: "/websocket-service" },
      { icon: FileText, label: "Report Scheduler", path: "/report-scheduler" },
      {
        icon: Activity,
        label: "Event-Driven Arch",
        path: "/event-driven-arch",
      },
      {
        icon: Bell,
        label: "Adv. Notifications",
        path: "/advanced-notifications",
      },
      {
        icon: Shield,
        label: "Security Dashboard",
        path: "/security-dashboard",
      },
    ],
  },
  // ── 16. Production Operations ──
  {
    id: "production-ops",
    label: "Production Ops",
    icon: Shield,
    items: [
      {
        icon: AlertTriangle,
        label: "Fraud Realtime Viz",
        path: "/fraud-realtime-viz",
      },
      {
        icon: Activity,
        label: "Pipeline Monitoring",
        path: "/pipeline-monitoring",
      },
      { icon: Key, label: "API Gateway", path: "/api-gateway" },
      { icon: Database, label: "Backup & DR", path: "/backup-dr" },
      {
        icon: Cpu,
        label: "Performance Profiler",
        path: "/performance-profiler",
      },
      { icon: Building2, label: "Multi-Tenancy", path: "/multi-tenancy" },
      {
        icon: Webhook,
        label: "Webhook Management",
        path: "/webhook-management",
      },
      {
        icon: Download,
        label: "Data Export/Import",
        path: "/data-export-import",
      },
      { icon: CheckCircle, label: "SLA Management", path: "/sla-management" },
      {
        icon: TrendingUp,
        label: "Capacity Planning",
        path: "/capacity-planning",
      },
      {
        icon: AlertTriangle,
        label: "Incident Management",
        path: "/incident-management",
      },
      { icon: ToggleLeft, label: "Feature Flags", path: "/feature-flags" },
    ],
  },
  // ── 17. Enterprise Platform ──
  {
    id: "enterprise-platform",
    label: "Enterprise Platform",
    icon: Building2,
    items: [
      { icon: Activity, label: "OpenTelemetry", path: "/open-telemetry" },
      { icon: BarChart2, label: "Advanced BI", path: "/advanced-bi-reporting" },
      { icon: Zap, label: "Workflow Automation", path: "/workflow-automation" },
      {
        icon: Bell,
        label: "Notification Center",
        path: "/notification-center",
      },
      { icon: MessageCircle, label: "Help Desk", path: "/help-desk" },
      { icon: Database, label: "Data Quality", path: "/data-quality" },
      {
        icon: Settings,
        label: "Config Management",
        path: "/config-management",
      },
      { icon: Network, label: "Service Mesh", path: "/service-mesh" },
      {
        icon: Shield,
        label: "Compliance Automation",
        path: "/compliance-automation",
      },
      { icon: Users, label: "Customer 360", path: "/customer-360" },
    ],
  },
  // ── 18. Sprint 34: Final Comprehensive ──
  {
    id: "sprint34",
    label: "Platform Services",
    icon: Globe,
    items: [
      {
        icon: Bell,
        label: "Realtime Notifications",
        path: "/realtime-notifications",
      },
      { icon: BarChart3, label: "Report Builder", path: "/report-builder" },
      { icon: Globe, label: "GraphQL Federation", path: "/graphql-federation" },
      { icon: GitBranch, label: "API Versioning", path: "/api-versioning" },
      {
        icon: Shield,
        label: "Advanced Rate Limiter",
        path: "/advanced-rate-limiter",
      },
      {
        icon: LayoutDashboard,
        label: "Dashboard Widgets",
        path: "/dashboard-widgets",
      },
      { icon: Award, label: "Agent Scorecard", path: "/agent-scorecard" },
      { icon: Scale, label: "Dispute Resolution", path: "/dispute-resolution" },
      {
        icon: FlaskConical,
        label: "Regulatory Sandbox",
        path: "/regulatory-sandbox",
      },
      {
        icon: DollarSign,
        label: "Multi-Currency Engine",
        path: "/multi-currency-engine",
      },
      {
        icon: FileText,
        label: "Document Management",
        path: "/document-management",
      },
      { icon: GraduationCap, label: "Agent Training", path: "/agent-training" },
      {
        icon: TrendingUp,
        label: "Revenue Analytics",
        path: "/revenue-analytics",
      },
      { icon: Activity, label: "Platform Health", path: "/platform-health" },
      { icon: Layers, label: "Batch Processing", path: "/batch-processing" },
      {
        icon: Store,
        label: "Integration Marketplace",
        path: "/integration-marketplace",
      },
      { icon: Smartphone, label: "Mobile API Layer", path: "/mobile-api" },
      {
        icon: TestTube2,
        label: "Automated Testing",
        path: "/automated-testing",
      },
    ],
  },
  // ── 19. Sprint 35: Advanced Operations ──
  {
    id: "sprint35",
    label: "Advanced Operations",
    icon: Crosshair,
    items: [
      { icon: Map, label: "Transaction Map", path: "/transaction-map-viz" },
      {
        icon: FileSearch,
        label: "Report Templates",
        path: "/report-builder-templates",
      },
      {
        icon: MessageSquarePlus,
        label: "NL Analytics Query",
        path: "/nl-analytics-query",
      },
      {
        icon: Workflow,
        label: "Banking Workflows",
        path: "/banking-workflows",
      },
      {
        icon: UserPlus,
        label: "Onboarding Wizard",
        path: "/agent-onboarding-wizard",
      },
      {
        icon: Repeat,
        label: "Tx Reconciliation",
        path: "/transaction-reconciliation",
      },
      { icon: Gavel, label: "Chargeback Mgmt", path: "/chargeback-management" },
      {
        icon: ScrollText,
        label: "Regulatory Reporting",
        path: "/regulatory-reporting",
      },
      {
        icon: FolderTree,
        label: "Territory Management",
        path: "/territory-management",
      },
      { icon: Tag, label: "Dynamic Pricing", path: "/dynamic-pricing" },
      { icon: Heart, label: "Loyalty Program", path: "/loyalty-program" },
      { icon: Crosshair, label: "Fraud Cases", path: "/fraud-case-management" },
      { icon: Monitor, label: "Terminal Fleet", path: "/terminal-fleet" },
      {
        icon: DollarSign,
        label: "Financial Recon",
        path: "/financial-reconciliation",
      },
      { icon: BarChart2, label: "API Analytics", path: "/api-analytics" },
      {
        icon: Megaphone,
        label: "Agent Comms Hub",
        path: "/agent-communication-hub",
      },
      {
        icon: Scale,
        label: "Dispute Arbitration",
        path: "/dispute-arbitration",
      },
      {
        icon: BookMarked,
        label: "Compliance Training",
        path: "/compliance-training",
      },
      { icon: Database, label: "Migration Tools", path: "/migration-tools" },
      {
        icon: ClipboardList,
        label: "Audit Log Viewer",
        path: "/audit-log-viewer",
      },
    ],
  },
  // ── 20. Sprint 36: White-Label Partner Platform ──
  {
    id: "sprint36",
    label: "Partner Platform",
    icon: Building2,
    items: [
      { icon: Download, label: "CSV Export", path: "/transaction-csv-export" },
      { icon: MapPin, label: "Map Loading", path: "/transaction-map-loading" },
      {
        icon: MessageSquare,
        label: "NL Financial Query",
        path: "/nl-financial-query",
      },
      {
        icon: Building2,
        label: "WL Onboarding",
        path: "/white-label-onboarding",
      },
      { icon: Palette, label: "WL Branding", path: "/white-label-branding" },
      {
        icon: CheckCircle,
        label: "Approval Workflow",
        path: "/white-label-approval",
      },
      {
        icon: Users,
        label: "Partner Self-Service",
        path: "/partner-self-service",
      },
      {
        icon: FileOutput,
        label: "Export Engine",
        path: "/transaction-export-engine",
      },
      {
        icon: Loader,
        label: "Loading States",
        path: "/advanced-loading-states",
      },
      {
        icon: Brain,
        label: "Financial NL Engine",
        path: "/financial-nl-engine",
      },
      {
        icon: PiggyBank,
        label: "Revenue Sharing",
        path: "/partner-revenue-sharing",
      },
      {
        icon: Trophy,
        label: "Agent Gamification",
        path: "/agent-gamification",
      },
      {
        icon: Layers,
        label: "Bulk Processing",
        path: "/bulk-transaction-processing",
      },
      { icon: UserCircle, label: "Customer 360", path: "/customer-360-view" },
      {
        icon: Webhook,
        label: "Webhook Console",
        path: "/webhook-mgmt-console",
      },
      {
        icon: ToggleLeft,
        label: "Feature Flags",
        path: "/platform-feature-flags",
      },
      { icon: Gauge, label: "SLA Monitoring", path: "/sla-monitoring" },
      {
        icon: Database,
        label: "Data Retention",
        path: "/data-retention-policy",
      },
      { icon: FileText, label: "Changelog", path: "/platform-changelog" },
      { icon: Search, label: "Advanced Search", path: "/advanced-search" },
    ],
  },
  // ── 21. Sprint 37: Production Hardening ──
  {
    id: "sprint37",
    label: "Production Hardening",
    icon: Shield,
    items: [
      { icon: TestTube2, label: "E2E Tests", path: "/e2e-test-framework" },
      { icon: Database, label: "Schema Push", path: "/db-schema-push" },
      {
        icon: Calculator,
        label: "Commission Calc",
        path: "/agent-commission-calc",
      },
      { icon: Tag, label: "MCC Manager", path: "/mcc-manager" },
      {
        icon: Layers,
        label: "Settlement Batch",
        path: "/settlement-batch-processor",
      },
      { icon: CreditCard, label: "BIN Lookup", path: "/card-bin-lookup" },
      {
        icon: Zap,
        label: "Velocity Monitor",
        path: "/transaction-velocity-monitor",
      },
      {
        icon: AlertTriangle,
        label: "Risk Scoring",
        path: "/merchant-risk-scoring",
      },
      {
        icon: Network,
        label: "Gateway Router",
        path: "/payment-gateway-router",
      },
      {
        icon: TrendingUp,
        label: "Float Forecast",
        path: "/agent-float-forecasting",
      },
      {
        icon: Building2,
        label: "Tenant Isolation",
        path: "/multi-tenant-isolation",
      },
      {
        icon: Activity,
        label: "Health Dashboard",
        path: "/platform-health-dash",
      },
      {
        icon: CheckCircle,
        label: "Compliance Check",
        path: "/automated-compliance-checker",
      },
      {
        icon: Calculator,
        label: "Fee Calculator",
        path: "/transaction-fee-calc",
      },
      {
        icon: GitBranch,
        label: "Network Topology",
        path: "/agent-network-topology",
      },
      {
        icon: MessageCircle,
        label: "Dispute Portal",
        path: "/customer-dispute-portal",
      },
      {
        icon: Search,
        label: "Leakage Detector",
        path: "/revenue-leakage-detector",
      },
      { icon: Gauge, label: "Rate Limiter", path: "/api-rate-limiter-dash" },
      { icon: BookOpen, label: "Runbook Engine", path: "/operational-runbook" },
      {
        icon: BarChart3,
        label: "Metrics Exporter",
        path: "/platform-metrics-exporter",
      },
    ],
  },
  // ── 22. Sprint 38: Advanced Capabilities ──
  {
    id: "sprint38",
    label: "Advanced Capabilities",
    icon: Rocket,
    items: [
      {
        icon: Radio,
        label: "WebSocket Feeds",
        path: "/realtime-websocket-feeds",
      },
      {
        icon: Store,
        label: "Merchant Onboarding",
        path: "/merchant-onboarding-portal",
      },
      { icon: Link, label: "Payment Links", path: "/payment-link-generator" },
      {
        icon: Brain,
        label: "AI Dispute Mediation",
        path: "/dispute-mediation-ai",
      },
      {
        icon: Trophy,
        label: "Agent Leaderboard",
        path: "/agent-performance-leaderboard",
      },
      {
        icon: Clock,
        label: "Settlement Scheduler",
        path: "/automated-settlement-scheduler",
      },
      {
        icon: Wallet,
        label: "Customer Wallets",
        path: "/customer-wallet-system",
      },
      {
        icon: BarChart3,
        label: "Merchant Analytics",
        path: "/merchant-analytics-dash",
      },
      { icon: Cpu, label: "Firmware OTA", path: "/pos-firmware-ota" },
      {
        icon: Receipt,
        label: "Receipt Generator",
        path: "/transaction-receipt-generator",
      },
      { icon: Banknote, label: "Agent Loans", path: "/agent-loan-advance" },
      {
        icon: Shuffle,
        label: "Payment Orchestrator",
        path: "/multi-channel-payment-orch",
      },
      {
        icon: FileCheck,
        label: "Regulatory Filing",
        path: "/regulatory-filing-automation",
      },
      {
        icon: Users,
        label: "Customer Segments",
        path: "/customer-segmentation-engine",
      },
      {
        icon: AlertOctagon,
        label: "Incident Center",
        path: "/incident-command-center",
      },
      {
        icon: FlaskConical,
        label: "A/B Testing",
        path: "/platform-ab-testing",
      },
      {
        icon: Sparkles,
        label: "TX Enrichment",
        path: "/transaction-enrichment-service",
      },
      {
        icon: Package,
        label: "Agent Inventory",
        path: "/agent-inventory-mgmt",
      },
      {
        icon: TrendingUp,
        label: "Revenue Forecast",
        path: "/revenue-forecasting-engine",
      },
      {
        icon: Lightbulb,
        label: "Recommendations",
        path: "/platform-recommendations",
      },
    ],
  },
  // ── 23. Sprint 39: Platform Maturity & Infrastructure ──
  {
    id: "sprint39",
    label: "Platform Maturity",
    icon: Shield,
    items: [
      {
        icon: CheckCircle,
        label: "Publish Readiness",
        path: "/publish-readiness",
      },
      {
        icon: Database,
        label: "Schema Migration",
        path: "/db-schema-migration",
      },
      {
        icon: Zap,
        label: "GraphQL Subscriptions",
        path: "/graphql-subscriptions",
      },
      { icon: WifiOff, label: "Offline POS Mode", path: "/offline-pos-mode" },
      { icon: Fingerprint, label: "Biometric Auth", path: "/biometric-auth" },
      { icon: TrendingUp, label: "AI Cash Flow", path: "/ai-cash-flow" },
      { icon: Link, label: "Blockchain Audit", path: "/blockchain-audit" },
      { icon: Mic, label: "Voice Command POS", path: "/voice-command-pos" },
      { icon: Share2, label: "Social Commerce", path: "/social-commerce" },
      { icon: Leaf, label: "ESG Carbon Tracker", path: "/esg-carbon-tracker" },
      {
        icon: Activity,
        label: "Distributed Tracing",
        path: "/distributed-tracing",
      },
      { icon: GitBranch, label: "Canary Releases", path: "/canary-releases" },
      { icon: Flame, label: "Chaos Engineering", path: "/chaos-engineering" },
      { icon: Server, label: "Connection Pools", path: "/connection-pools" },
      { icon: Cloud, label: "CDN Cache", path: "/cdn-cache" },
      { icon: Layers, label: "CQRS Events", path: "/cqrs-events" },
      { icon: Cpu, label: "Digital Twin", path: "/digital-twin" },
      { icon: Banknote, label: "CBDC Gateway", path: "/cbdc-gateway" },
      { icon: UserCheck, label: "DID Manager", path: "/did-manager" },
      { icon: Award, label: "Maturity Scorecard", path: "/maturity-scorecard" },
    ],
  },
  // ── 25. Enterprise Scaling & Operations (Sprint 40) ──
  {
    id: "enterprise-scaling",
    label: "Enterprise Scaling",
    icon: Rocket,
    items: [
      {
        icon: Layers,
        label: "Smart Contract Payments",
        path: "/smart-contract-payment",
      },
      {
        icon: TrendingUp,
        label: "Predictive Agent Churn",
        path: "/predictive-agent-churn",
      },
      {
        icon: ArrowRightLeft,
        label: "Currency Hedging",
        path: "/currency-hedging",
      },
      {
        icon: MapPin,
        label: "Agent Cluster Analytics",
        path: "/agent-cluster-analytics",
      },
      {
        icon: Shield,
        label: "Compliance Automation",
        path: "/auto-compliance-workflow",
      },
      { icon: Key, label: "Payment Token Vault", path: "/payment-token-vault" },
      {
        icon: Smartphone,
        label: "Dynamic QR Payments",
        path: "/dynamic-qr-payment",
      },
      {
        icon: DollarSign,
        label: "Revenue Attribution",
        path: "/agent-revenue-attribution",
      },
      {
        icon: Calculator,
        label: "Cost Allocator",
        path: "/platform-cost-allocator",
      },
      {
        icon: Shuffle,
        label: "Intelligent Routing",
        path: "/intelligent-routing",
      },
      {
        icon: FlaskConical,
        label: "Regulatory Sandbox",
        path: "/regulatory-sandbox-tester",
      },
      {
        icon: Fingerprint,
        label: "Device Fingerprint",
        path: "/agent-device-fingerprint",
      },
      {
        icon: Repeat,
        label: "Settlement Netting",
        path: "/settlement-netting",
      },
      { icon: Gauge, label: "Capacity Planner", path: "/capacity-planner" },
      {
        icon: CreditCard,
        label: "Merchant Acquirer",
        path: "/merchant-acquirer",
      },
      {
        icon: Heart,
        label: "Agent Micro-Insurance",
        path: "/agent-micro-insurance",
      },
      { icon: Network, label: "Transaction Graph", path: "/transaction-graph" },
      {
        icon: Sparkles,
        label: "Revenue Optimizer",
        path: "/revenue-optimizer",
      },
      {
        icon: Globe,
        label: "Cross-Border Remittance",
        path: "/cross-border-remittance",
      },
      {
        icon: Monitor,
        label: "Command Bridge",
        path: "/operational-command-bridge",
      },
    ],
  },
  // ── 27. Production Finalization (Sprint 41) ──
  {
    id: "production-finalization",
    label: "Production Finalization",
    icon: CheckCircle,
    items: [
      {
        icon: FileCheck,
        label: "KYC Document Vault",
        path: "/agent-kyc-vault",
      },
      { icon: TrendingUp, label: "Real-Time P&L", path: "/realtime-pnl" },
      {
        icon: RefreshCw,
        label: "Auto Reconciliation",
        path: "/auto-reconciliation",
      },
      { icon: Map, label: "Territory Optimizer", path: "/territory-optimizer" },
      {
        icon: Gavel,
        label: "Dispute Arbitration",
        path: "/dispute-arbitration",
      },
      {
        icon: ScrollText,
        label: "Regulatory Reports",
        path: "/regulatory-reports",
      },
      {
        icon: GraduationCap,
        label: "Training Academy",
        path: "/training-academy",
      },
      { icon: Calculator, label: "Fee Calculator", path: "/fee-calculator" },
      {
        icon: UserPlus,
        label: "Customer Onboarding",
        path: "/customer-onboarding",
      },
      {
        icon: Store,
        label: "Merchant Settlement",
        path: "/merchant-settlement",
      },
      { icon: Heart, label: "Insurance Claims", path: "/insurance-claims" },
      { icon: Gauge, label: "SLA Monitor", path: "/sla-monitor" },
      { icon: Send, label: "Bulk Disbursement", path: "/bulk-disbursement" },
      { icon: Repeat, label: "Reversal Manager", path: "/reversal-manager" },
      { icon: Banknote, label: "Loan Origination", path: "/loan-origination" },
      { icon: Bell, label: "Notification Hub", path: "/notification-hub" },
      {
        icon: BookMarked,
        label: "Compliance Training",
        path: "/compliance-training",
      },
      { icon: Package, label: "Migration Toolkit", path: "/migration-toolkit" },
      {
        icon: Trophy,
        label: "Performance Incentives",
        path: "/performance-incentives",
      },
      {
        icon: Rocket,
        label: "Executive Command Center",
        path: "/executive-command",
      },
    ],
  },
  // ── 28. Final Production Features (Sprint 42) ──
  {
    id: "final-production",
    label: "Final Production",
    icon: Rocket,
    items: [
      {
        icon: Bell,
        label: "Dispute Notifications",
        path: "/dispute-notifications",
      },
      {
        icon: BarChart2,
        label: "Dispute Analytics",
        path: "/dispute-analytics-dashboard",
      },
      {
        icon: Trophy,
        label: "Agent Benchmarking",
        path: "/agent-benchmarking",
      },
      { icon: Zap, label: "TX Velocity Monitor", path: "/tx-velocity-monitor" },
      {
        icon: MessageSquare,
        label: "Customer Surveys",
        path: "/customer-surveys",
      },
      {
        icon: MapPin,
        label: "Territory Heatmap",
        path: "/agent-territory-heatmap",
      },
      { icon: Clock, label: "Report Scheduler", path: "/report-scheduler" },
      {
        icon: Activity,
        label: "Gateway Health",
        path: "/gateway-health-monitor",
      },
      {
        icon: Landmark,
        label: "Loan Origination V2",
        path: "/agent-loan-origination-v2",
      },
      { icon: Shield, label: "MFA Manager", path: "/mfa-manager" },
      {
        icon: Database,
        label: "Data Retention",
        path: "/data-retention-policy",
      },
      {
        icon: AlertTriangle,
        label: "Incident Playbook",
        path: "/incident-playbook",
      },
      {
        icon: Smartphone,
        label: "Device Fleet",
        path: "/device-fleet-manager",
      },
      {
        icon: Search,
        label: "Revenue Leakage",
        path: "/revenue-leakage-detector",
      },
      {
        icon: GitBranch,
        label: "Journey Mapper",
        path: "/customer-journey-mapper",
      },
      {
        icon: FileCheck,
        label: "Compliance Certs",
        path: "/compliance-cert-manager",
      },
      {
        icon: Heart,
        label: "Health Scorecard",
        path: "/platform-health-scorecard",
      },
      {
        icon: GraduationCap,
        label: "Training Certs",
        path: "/training-certification",
      },
      {
        icon: Download,
        label: "Bulk Processor",
        path: "/bulk-transaction-processor",
      },
      {
        icon: Settings,
        label: "System Config",
        path: "/system-config-manager",
      },
    ],
  },
  // ── 29. Help & Documentation ──
  {
    id: "help",
    label: "Help & Documentation",
    icon: BookOpen,
    items: [
      { icon: BookOpen, label: "User Guide", path: "/user-guide" },
      { icon: Video, label: "Video Tutorials", path: "/video-tutorials" },
      {
        icon: BarChart2,
        label: "Feedback Analytics",
        path: "/feedback-analytics",
      },
      { icon: MessageSquare, label: "Live Chat Support", path: "/live-chat" },
      { icon: Inbox, label: "Support Inbox", path: "/admin-support-inbox" },
      { icon: FileText, label: "Changelog", path: "/changelog" },
      { icon: Code2, label: "API Documentation", path: "/api-docs" },
      { icon: Activity, label: "System Status", path: "/system-status" },
    ],
  },
  // ── 29. Sprint 46: Production Features ──
  {
    id: "production-suite",
    label: "Production Suite",
    icon: Rocket,
    items: [
      {
        icon: Bell,
        label: "Payment Notifications",
        path: "/payment-notifications",
      },
      {
        icon: Database,
        label: "Database Explorer",
        path: "/database-visualization",
      },
      {
        icon: Settings,
        label: "Middleware Manager",
        path: "/middleware-manager",
      },
      { icon: Code2, label: "Skill Creator", path: "/skill-creator" },
      {
        icon: FileCheck,
        label: "Payment Reconciliation",
        path: "/payment-reconciliation",
      },
      {
        icon: BarChart2,
        label: "Agent Analytics",
        path: "/agent-performance-analytics",
      },
      {
        icon: Shield,
        label: "Compliance Reporting",
        path: "/compliance-reporting",
      },
      {
        icon: MessageSquare,
        label: "Customer Feedback",
        path: "/customer-feedback",
      },
      {
        icon: DollarSign,
        label: "Multi-Currency Exchange",
        path: "/multi-currency-exchange",
      },
      { icon: BookOpen, label: "Agent Training", path: "/agent-training" },
      {
        icon: AlertTriangle,
        label: "Dispute Workflow",
        path: "/dispute-workflow",
      },
      { icon: Activity, label: "Platform Health", path: "/platform-health" },
      { icon: Upload, label: "Bulk Payments", path: "/bulk-payments" },
      {
        icon: Users,
        label: "Agent Hierarchy",
        path: "/agent-hierarchy-territory",
      },
      {
        icon: FileText,
        label: "Financial Reports",
        path: "/financial-reporting",
      },
      { icon: Key, label: "API Key Management", path: "/api-key-management" },
      { icon: Webhook, label: "Webhook Delivery", path: "/webhook-delivery" },
      { icon: Sliders, label: "Platform Config", path: "/platform-config" },
    ],
  },
  // ── 30. Sprint 49: Production Readiness ──
  {
    id: "production-readiness",
    label: "Production Readiness",
    icon: CheckCircle,
    items: [
      { icon: CreditCard, label: "Bank Accounts", path: "/bank-accounts" },
      { icon: FileCheck, label: "KYC Documents", path: "/kyc-documents" },
      {
        icon: Scale,
        label: "Float Reconciliation",
        path: "/float-reconciliation",
      },
      { icon: Trophy, label: "Agent Scorecard", path: "/agent-scorecard" },
      { icon: Users, label: "Customer Database", path: "/customer-database" },
      {
        icon: RotateCcw,
        label: "Reversal Approval",
        path: "/reversal-approval",
      },
      {
        icon: ArrowLeftRight,
        label: "Commission Clawback",
        path: "/commission-clawback",
      },
      { icon: BarChart3, label: "P&L Reports", path: "/pnl-reports" },
      { icon: Gauge, label: "Transaction Limits", path: "/transaction-limits" },
      {
        icon: ShieldCheck,
        label: "Regulatory Compliance",
        path: "/regulatory-compliance",
      },
      {
        icon: Activity,
        label: "System Health Dashboard",
        path: "/system-health-dashboard",
      },
      { icon: UserX, label: "Agent Suspension", path: "/agent-suspension" },
    ],
  },
  // ── 31. Sprint 51: Production-Grade Features ──
  {
    id: "sprint51-features",
    label: "Sprint 51 Features",
    icon: Zap,
    items: [
      {
        icon: Activity,
        label: "Realtime Tx Monitor",
        path: "/realtime-tx-monitor",
      },
      {
        icon: ShieldAlert,
        label: "Fraud ML Scoring",
        path: "/fraud-ml-scoring",
      },
      {
        icon: Bell,
        label: "Notification Orchestrator",
        path: "/notification-orchestrator",
      },
      {
        icon: CreditCard,
        label: "Agent Loan Facility",
        path: "/agent-loan-facility",
      },
      {
        icon: Calculator,
        label: "Dynamic Fee Engine",
        path: "/dynamic-fee-engine",
      },
      {
        icon: FileCheck,
        label: "Merchant KYC Onboarding",
        path: "/merchant-kyc-onboarding",
      },
      {
        icon: Banknote,
        label: "Merchant Payout Settlement",
        path: "/merchant-payout-settlement",
      },
      {
        icon: FileText,
        label: "Compliance Filing",
        path: "/compliance-filing",
      },
      {
        icon: Trophy,
        label: "Agent Gamification",
        path: "/agent-gamification-v2",
      },
      {
        icon: ToggleLeft,
        label: "Tenant Feature Toggle",
        path: "/tenant-feature-toggle",
      },
      {
        icon: ArrowLeftRight,
        label: "Reconciliation Engine",
        path: "/reconciliation-engine",
      },
      {
        icon: Users,
        label: "Customer Journey Analytics",
        path: "/customer-journey-analytics",
      },
      {
        icon: HardDrive,
        label: "Backup & DR",
        path: "/backup-disaster-recovery",
      },
      { icon: GitBranch, label: "Workflow Engine", path: "/workflow-engine" },
      { icon: BookOpen, label: "General Ledger", path: "/general-ledger" },
      { icon: Globe, label: "Webhook Management", path: "/webhook-management" },
      { icon: Gauge, label: "SLA Monitoring", path: "/sla-monitoring-v2" },
      { icon: Download, label: "Data Export Hub", path: "/data-export-hub" },
      { icon: Zap, label: "Rate Limit Engine", path: "/rate-limit-engine" },
      { icon: Server, label: "Platform Health", path: "/platform-health" },
    ],
  },
  // ── 32. Sprint 52: Final Production Features ──
  {
    id: "sprint52-features",
    label: "Sprint 52 Features",
    icon: Shield,
    items: [
      {
        icon: BarChart3,
        label: "Executive Command Center",
        path: "/executive-command-center",
      },
      {
        icon: FileText,
        label: "Activity Audit Log",
        path: "/activity-audit-log",
      },
      { icon: Settings, label: "System Settings", path: "/system-settings" },
      { icon: Trophy, label: "Agent Leaderboard", path: "/agent-leaderboard" },
      { icon: Wallet, label: "Float Management", path: "/float-management" },
    ],
  },
];
// Flatten all items for searchh
const allNavItems = navGroups.flatMap(g => g.items);

const SIDEBAR_WIDTH_KEY = "sidebar-width";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const COLLAPSED_GROUPS_KEY = "nav-collapsed-groups";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_WIDTH;
  });
  const { loading, user } = useAuth();

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, sidebarWidth.toString());
  }, [sidebarWidth]);

  if (loading) {
    return <DashboardLayoutSkeleton />;
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
          <div className="flex flex-col items-center gap-6">
            <h1 className="text-2xl font-semibold tracking-tight text-center">
              Sign in to continue
            </h1>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              Access to this dashboard requires authentication. Continue to
              launch the login flow.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = getLoginUrl();
            }}
            size="lg"
            className="w-full shadow-lg hover:shadow-xl transition-all"
          >
            Sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <DashboardLayoutContent setSidebarWidth={setSidebarWidth}>
        {children}
      </DashboardLayoutContent>
    </SidebarProvider>
  );
}

type DashboardLayoutContentProps = {
  children: React.ReactNode;
  setSidebarWidth: (width: number) => void;
};

function DashboardLayoutContent({
  children,
  setSidebarWidth,
}: DashboardLayoutContentProps) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const isCollapsed = state === "collapsed";
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState("");

  // Collapsible group state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_GROUPS_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      localStorage.setItem(
        COLLAPSED_GROUPS_KEY,
        JSON.stringify(Array.from(next))
      );
      return next;
    });
  };

  // Find active menu item
  const activeMenuItem =
    allNavItems.find(
      item =>
        item.path === location ||
        (item.path !== "/" && location.startsWith(item.path + "/"))
    ) ?? allNavItems.find(item => item.path === "/");

  // Filtered groups: role-based access + search
  const roleFilteredGroups = useMemo(
    () => filterNavGroupsByRole(navGroups, user?.role),
    [user?.role]
  );

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return roleFilteredGroups;
    const q = searchQuery.toLowerCase();
    return roleFilteredGroups
      .map(g => ({
        ...g,
        items: g.items.filter(
          i =>
            i.label.toLowerCase().includes(q) ||
            i.path.toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.items.length > 0);
  }, [searchQuery, roleFilteredGroups]);

  useEffect(() => {
    if (isCollapsed) setIsResizing(false);
  }, [isCollapsed]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const sidebarLeft = sidebarRef.current?.getBoundingClientRect().left ?? 0;
      const newWidth = e.clientX - sidebarLeft;
      if (newWidth >= MIN_WIDTH && newWidth <= MAX_WIDTH) {
        setSidebarWidth(newWidth);
      }
    };
    const handleMouseUp = () => setIsResizing(false);

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, setSidebarWidth]);

  return (
    <>
      <div className="relative" ref={sidebarRef}>
        <Sidebar
          collapsible="icon"
          className="border-r-0"
          disableTransition={isResizing}
        >
          <SidebarHeader className="h-16 justify-center">
            <div className="flex items-center gap-3 px-2 transition-all w-full">
              <button
                onClick={toggleSidebar}
                className="h-8 w-8 flex items-center justify-center hover:bg-accent rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring shrink-0"
                aria-label="Toggle navigation"
              >
                <PanelLeft className="h-4 w-4 text-muted-foreground" />
              </button>
              {!isCollapsed && (
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold tracking-tight truncate">
                    RemitFlow
                  </span>
                </div>
              )}
            </div>
          </SidebarHeader>

          <SidebarContent className="gap-0 overflow-y-auto">
            {/* Search bar (only when expanded) */}
            {!isCollapsed && (
              <div className="px-3 py-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search menu..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="h-8 pl-8 text-xs bg-muted/50 border-0 focus-visible:ring-1"
                  />
                </div>
              </div>
            )}

            <SidebarMenu className="px-2 py-1">
              {filteredGroups.map(group => {
                const isGroupCollapsed =
                  collapsedGroups.has(group.id) && !searchQuery;
                const hasActiveItem = group.items.some(
                  i =>
                    i.path === location ||
                    (i.path !== "/" && location.startsWith(i.path + "/"))
                );

                return (
                  <div key={group.id} className="mb-0.5">
                    {/* Group header */}
                    {!isCollapsed ? (
                      <button
                        onClick={() => toggleGroup(group.id)}
                        className={`w-full flex items-center gap-2 px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest transition-colors hover:text-foreground ${
                          hasActiveItem
                            ? "text-primary"
                            : "text-muted-foreground/60"
                        }`}
                      >
                        {isGroupCollapsed ? (
                          <ChevronRight className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                        <group.icon className="h-3 w-3" />
                        <span>{group.label}</span>
                        <span className="ml-auto text-[9px] font-normal opacity-50">
                          {group.items.length}
                        </span>
                      </button>
                    ) : (
                      <div className="flex justify-center py-1">
                        <div className="w-6 h-px bg-border" />
                      </div>
                    )}

                    {/* Group items */}
                    {(!isGroupCollapsed || isCollapsed) &&
                      group.items.map(item => {
                        const isActive =
                          location === item.path ||
                          (item.path !== "/" &&
                            location.startsWith(item.path + "/"));
                        return (
                          <SidebarMenuItem key={item.path}>
                            <SidebarMenuButton
                              isActive={isActive}
                              onClick={() => {
                                setLocation(item.path);
                                setSearchQuery("");
                              }}
                              tooltip={item.label}
                              className="h-8 transition-all font-normal text-[13px]"
                            >
                              <item.icon
                                className={`h-4 w-4 shrink-0 ${isActive ? "text-primary" : ""}`}
                              />
                              <span className="truncate">{item.label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
                  </div>
                );
              })}

              {filteredGroups.length === 0 && !isCollapsed && (
                <div className="px-3 py-6 text-center">
                  <p className="text-xs text-muted-foreground">
                    No matching items
                  </p>
                </div>
              )}
            </SidebarMenu>
          </SidebarContent>

          <SidebarFooter className="p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 rounded-lg px-1 py-1 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-9 w-9 border shrink-0">
                    <AvatarFallback className="text-xs font-medium">
                      {user?.name?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                    <p className="text-sm font-medium truncate leading-none">
                      {user?.name || "-"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate mt-1.5">
                      {user?.email || "-"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={logout}
                  className="cursor-pointer text-destructive focus:text-destructive"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sign out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 transition-colors ${isCollapsed ? "hidden" : ""}`}
          onMouseDown={() => {
            if (isCollapsed) return;
            setIsResizing(true);
          }}
          style={{ zIndex: 50 }}
        />
      </div>

      <SidebarInset>
        {isMobile && (
          <div className="flex border-b h-14 items-center justify-between bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="h-9 w-9 rounded-lg bg-background" />
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <span className="tracking-tight text-foreground">
                    {activeMenuItem?.label ?? "Menu"}
                  </span>
                </div>
              </div>
            </div>
            <LanguageSelector />
            <NotificationCenter />
          </div>
        )}
        <main className="flex-1 p-4">{children}</main>
      </SidebarInset>
    </>
  );
}

export { DashboardLayout };

// NotificationBellWidget replaced by NotificationCenter component
