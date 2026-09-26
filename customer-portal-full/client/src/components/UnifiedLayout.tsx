import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRole, UserRole } from "@/contexts/RoleContext";
import { useIsMobile } from "@/hooks/useMobile";
import {
  LayoutDashboard,
  LogOut,
  FileText,
  CreditCard,
  User,
  Users,
  Gift,
  Star,
  Shield,
  Link2,
  AlertTriangle,
  BarChart3,
  MessageSquare,
  Settings,
  UserCog,
  ClipboardList,
  Briefcase,
  DollarSign,
  Scale,
  CheckCircle,
  ScrollText,
  ChevronDown,
  ChevronRight,
  Search,
  X,
  History,
  StarOff,
  Bot,
  Brain,
  TrendingUp,
  Gavel,
  Scan,
  Car,
  UsersRound,
  GitCompare,
  Smartphone,
  Sparkles,
  PieChart,
  MapPin,
  FilePlus,
  Leaf,
  Key,
  Trophy,
  Lock,
  Store,
  MessageCircle,
  Share2,
  Target,
  Activity,
  Mic,
  UserMinus,
  Crown,
  BookOpen,
  Route,
  Calculator,
  Wallet,
  Clock,
  Siren,
  HelpCircle,
  Building2,
  Phone,
  Heart,
  Camera,
  Bell,
  Package,
  Zap,
  PiggyBank,
  Landmark,
  Bike,
  Building,
  Coins,
  Cloud,
  Umbrella,
  Database,
  Scale as ScaleIcon,
  ScrollText as ScrollTextIcon,
  Gavel as GavelIcon,
  RefreshCw,
  Layers,
  Eye,
  FolderOpen,
  MessageSquareText,
  Coins as CoinsIcon,
  Building2 as Building2Icon,
  BarChart2,
  Server,
  FlaskConical,
  Activity as ActivityIcon,
  // Q-wave Q6 innovation nav icons (2026-09-25)
  CloudSun,
  Gauge,
  CarFront,
  HeartPulse,
  ReceiptText,
  BadgePercent,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";

interface MenuItem {
  icon: React.ElementType;
  label: string;
  path: string;
  permission?: string;
  badge?: string;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    label: "Dashboard",
    items: [
      { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", permission: "canViewDashboard" },
    ],
  },
  {
    label: "Insurance Products",
    items: [
      { icon: Store, label: "Insurance Marketplace", path: "/marketplace", permission: "canViewPolicies" },
      { icon: Briefcase, label: "Browse Products", path: "/products", permission: "canViewPolicies" },
      { icon: HelpCircle, label: "Coverage Finder", path: "/recommendation-quiz", permission: "canViewPolicies" },
      { icon: Calculator, label: "Premium Calculator", path: "/premium-calculator", permission: "canViewPolicies" },
      { icon: Target, label: "Insurance Score", path: "/insurance-score", permission: "canViewPolicies" },
      { icon: Heart, label: "Microinsurance", path: "/microinsurance", permission: "canViewPolicies" },
      { icon: Cloud, label: "Parametric Insurance", path: "/parametric-insurance", permission: "canViewPolicies" },
      { icon: Coins, label: "P2P Mutual Insurance", path: "/p2p-insurance", permission: "canViewPolicies" },
      { icon: Bike, label: "Gig Economy Coverage", path: "/gig-economy", permission: "canViewPolicies" },
      { icon: Building, label: "SME Business Insurance", path: "/sme-business", permission: "canViewPolicies" },
      { icon: Smartphone, label: "Digital Consumer Products", path: "/digital-consumer-products", permission: "canViewPolicies" },
    ],
  },
  {
    // Q-wave Q6 member innovation surfaces (2026-09-25). Forward-looking
    // backends feature-detect and render disclosed empty states.
    label: "Innovation",
    items: [
      { icon: CloudSun, label: "Parametric Coverage", path: "/parametric-coverage", permission: "canViewPolicies" },
      { icon: Coins, label: "Pool Membership & Surplus", path: "/pool-membership", permission: "canViewPolicies" },
      { icon: Gauge, label: "Driving Score & Trips", path: "/driving-score", permission: "canViewPolicies" },
      { icon: CarFront, label: "Usage-Based Cover", path: "/usage-cover", permission: "canViewPolicies" },
      { icon: HeartPulse, label: "Wellness Feed", path: "/wellness", permission: "canViewPolicies" },
      { icon: ReceiptText, label: "Photo Reimbursement", path: "/photo-reimbursement", permission: "canViewClaims" },
      { icon: BadgePercent, label: "Plan & Upgrades", path: "/plan-upgrade", permission: "canViewPolicies" },
    ],
  },
  {
    label: "Agricultural Insurance",
    items: [
      { icon: Leaf, label: "Climate & Crop Insurance", path: "/agricultural-insurance-suite", permission: "canViewPolicies" },
      { icon: Leaf, label: "Agricultural Underwriting", path: "/agricultural-underwriting", permission: "canViewRiskAssessment" },
    ],
  },
  {
    label: "Takaful Islamic Insurance",
    items: [
      { icon: Crown, label: "Takaful Products", path: "/takaful-products-suite", permission: "canViewPolicies" },
    ],
  },
  {
    label: "My Policies",
    items: [
      { icon: FileText, label: "My Applications", path: "/applications", permission: "canViewPolicies" },
      { icon: FileText, label: "Active Policies", path: "/policies", permission: "canViewPolicies" },
      { icon: Wallet, label: "Digital Wallet", path: "/digital-wallet", permission: "canViewPolicies" },
      { icon: GitCompare, label: "Compare Policies", path: "/policy-comparison", permission: "canViewPolicies" },
      { icon: UsersRound, label: "Family Policies", path: "/family-policies", permission: "canViewPolicies" },
      { icon: Bell, label: "Policy Renewal", path: "/policy-renewal", permission: "canViewPolicies" },
      { icon: UsersRound, label: "Family Coverage", path: "/family-coverage", permission: "canViewPolicies" },
    ],
  },
  {
    label: "Claims Centre",
    items: [
      { icon: ClipboardList, label: "My Claims", path: "/claims", permission: "canViewClaims" },
      { icon: Clock, label: "Claims Timeline", path: "/claims-timeline", permission: "canViewClaims" },
      { icon: Camera, label: "Claims Evidence", path: "/claims-evidence", permission: "canViewClaims" },
      { icon: Package, label: "Claims Tracker", path: "/claims-tracker", permission: "canViewClaims" },
      { icon: Siren, label: "Emergency SOS", path: "/emergency-sos", permission: "canViewPolicies" },
    ],
  },
  {
    label: "Payments & Finance",
    items: [
      { icon: CreditCard, label: "Payments", path: "/payments", permission: "canViewPayments" },
      { icon: PiggyBank, label: "Savings & Investment", path: "/savings-investment", permission: "canViewPolicies" },
      { icon: Wallet, label: "Financial Wellness", path: "/financial-wellness", permission: "canViewPolicies" },
      { icon: Landmark, label: "Bancassurance", path: "/bancassurance", permission: "canViewPolicies" },
      { icon: Phone, label: "Alternative Credit Score", path: "/telco-credit-scoring", permission: "canViewPolicies" },
    ],
  },
  {
    label: "Identity & Verification",
    items: [
      { icon: Shield, label: "KYC Status", path: "/kyc", permission: "canViewKYC" },
      { icon: Link2, label: "Policy Protection", path: "/blockchain", permission: "canViewBlockchain" },
    ],
  },
  {
    label: "Customer Engagement",
    items: [
      { icon: Trophy, label: "Rewards & Achievements", path: "/rewards", permission: "canViewReferrals" },
      { icon: Crown, label: "Loyalty Program", path: "/loyalty-program", permission: "canViewReferrals" },
      { icon: Share2, label: "Referral Program", path: "/referral-program", permission: "canViewReferrals" },
      { icon: Gift, label: "Referrals", path: "/referrals", permission: "canViewReferrals" },
      { icon: Star, label: "Reviews", path: "/reviews", permission: "canViewReviews" },
      { icon: MessageSquare, label: "Communication", path: "/communication", permission: "canViewCommunication" },
      { icon: Smartphone, label: "WhatsApp Integration", path: "/whatsapp", permission: "canViewCommunication" },
      { icon: BookOpen, label: "Insurance Literacy", path: "/insurance-literacy", permission: "canViewDashboard" },
      { icon: Heart, label: "Health & Wellness", path: "/health-wellness", permission: "canViewPolicies" },
      { icon: Gift, label: "Loyalty & Rewards", path: "/loyalty-rewards", permission: "canViewReferrals" },
    ],
  },
  {
    label: "Intelligent Services",
    items: [
      { icon: Bot, label: "AI Advisor", path: "/ai-advisor", permission: "canViewDashboard" },
      { icon: Brain, label: "AI Claims Processing", path: "/ai-claims", permission: "canViewClaims" },
      { icon: MessageCircle, label: "AI Assistant", path: "/chatbot", permission: "canViewDashboard" },
      { icon: Mic, label: "Voice Assistant", path: "/voice-assistant", permission: "canViewDashboard" },
      { icon: Scan, label: "Document Scanner", path: "/document-scanner", permission: "canViewClaims" },
      { icon: TrendingUp, label: "Dynamic Pricing", path: "/dynamic-pricing", permission: "canViewAnalytics" },
      { icon: Sparkles, label: "AI Knowledge Assistant", path: "/ai-assistant", permission: "canViewDashboard" },
      { icon: Activity, label: "Smart Risk Intelligence", path: "/mcmc-risk", permission: "canViewAnalytics" },
      { icon: Route, label: "Smart Claim Routing", path: "/smart-claim-routing", permission: "canViewPolicyApproval" },
      { icon: UserMinus, label: "Churn Prediction", path: "/churn-prediction", permission: "canViewAnalytics" },
      { icon: Shield, label: "AI Model Security", path: "/model-security", permission: "canViewAnalytics" },
    ],
  },
  {
    label: "Risk & Underwriting",
    items: [
      { icon: AlertTriangle, label: "Fraud Alerts", path: "/fraud-alerts", permission: "canViewFraudAlerts", badge: "3" },
      { icon: Shield, label: "Insurance Radar", path: "/insurance-radar", permission: "canViewFraudAlerts", badge: "AI" },
      { icon: Scale, label: "Risk Assessment", path: "/risk-assessment", permission: "canViewRiskAssessment" },
      { icon: CheckCircle, label: "Policy Approval", path: "/policy-approval", permission: "canViewPolicyApproval" },
      { icon: Shield, label: "Fraud Network Analysis", path: "/fraud-network", permission: "canViewFraudAlerts" },
      { icon: Link2, label: "Knowledge Graph", path: "/knowledge-graph", permission: "canViewAnalytics" },
    ],
  },
  {
    label: "Distribution Channels",
    items: [
      { icon: Users, label: "Agent Portal", path: "/agent-portal", permission: "canViewCommission" },
      { icon: Building2, label: "Bancassurance Portal", path: "/bancassurance-portal", permission: "canViewAnalytics" },
      { icon: Zap, label: "Embedded Distribution", path: "/embedded-distribution", permission: "canViewCommission" },
      { icon: Zap, label: "Embedded Insurance", path: "/embedded-insurance", permission: "canViewUserManagement" },
    ],
  },
  {
    label: "Regulatory Compliance",
    items: [
      { icon: Scale, label: "NIIRA 2025 Compulsory Insurance", path: "/niira-compulsory-insurance", permission: "canViewAuditLogs" },
      { icon: Shield, label: "NAICOM Compliance", path: "/naicom-compliance", permission: "canViewAuditLogs" },
      { icon: Gavel, label: "Compliance Monitor", path: "/compliance", permission: "canViewAuditLogs" },
      { icon: ScrollTextIcon, label: "Audit Trail", path: "/audit-trail", permission: "canViewAuditLogs" },
    ],
  },
  {
    label: "Nigerian Market",
    items: [
      { icon: Phone, label: "USSD Gateway", path: "/ussd-gateway", permission: "canViewUserManagement" },
      { icon: Car, label: "NMID Integration", path: "/nmid-integration", permission: "canViewUserManagement" },
    ],
  },
  {
    label: "Actuarial & Reinsurance",
    items: [
      { icon: Calculator, label: "Actuarial Module", path: "/actuarial-module", permission: "canViewAnalytics" },
      { icon: Umbrella, label: "Reinsurance Management", path: "/reinsurance", permission: "canViewAnalytics" },
      { icon: Scale, label: "IFRS 17 Engine", path: "/ifrs17", permission: "canViewAnalytics" },
    ],
  },
  {
    label: "Group Insurance & Pension",
    items: [
      { icon: UsersRound, label: "Group Life Administration", path: "/group-life-admin", permission: "canViewAnalytics" },
      { icon: PiggyBank, label: "PFA Integration", path: "/pfa-integration", permission: "canViewAnalytics" },
    ],
  },
  {
    label: "Technology & Innovation",
    items: [
      { icon: Bot, label: "Insurance Technology", path: "/insurance-tech-innovations", permission: "canViewAnalytics" },
      { icon: Car, label: "Telematics", path: "/telematics", permission: "canViewPolicies" },
      { icon: MapPin, label: "Geospatial Map", path: "/geospatial", permission: "canViewAnalytics" },
      { icon: Key, label: "Broker API", path: "/broker-api", permission: "canViewUserManagement" },
      { icon: Building2, label: "ERPNext Integration", path: "/erpnext-integration", permission: "canViewUserManagement" },
    ],
  },
  {
    label: "Agent Management",
    items: [
      { icon: Target, label: "Agent Performance", path: "/agent-performance", permission: "canViewAnalytics" },
      { icon: Users, label: "Customers", path: "/customers", permission: "canViewCustomers" },
      { icon: DollarSign, label: "Commission", path: "/commission", permission: "canViewCommission" },
    ],
  },
  {
    label: "Reports & Analytics",
    items: [
      { icon: BarChart3, label: "Analytics Dashboard", path: "/analytics", permission: "canViewAnalytics" },
      { icon: PieChart, label: "Executive Dashboard", path: "/executive-dashboard", permission: "canViewAnalytics" },
      { icon: ScrollText, label: "Audit Logs", path: "/audit-logs", permission: "canViewAuditLogs" },
      { icon: Database, label: "Operational Reports", path: "/operational-reports", permission: "canViewAnalytics" },
    ],
  },
  {
    label: "Operations",
    items: [
      { icon: GavelIcon, label: "Claims Adjudication", path: "/claims-adjudication", permission: "canViewPolicyApproval" },
      { icon: RefreshCw, label: "Renewal Automation", path: "/policy-renewal-automation", permission: "canViewUserManagement" },
      { icon: DollarSign, label: "Agent Commissions", path: "/agent-commission", permission: "canViewCommission" },
      { icon: Layers, label: "Batch Processing", path: "/batch-processing", permission: "canViewUserManagement" },
      { icon: Eye, label: "Customer 360", path: "/customer-360", permission: "canViewCustomers" },
      { icon: FolderOpen, label: "Document Management", path: "/document-management", permission: "canViewUserManagement" },
      { icon: MessageSquareText, label: "Customer Feedback", path: "/customer-feedback", permission: "canViewAnalytics" },
      { icon: CoinsIcon, label: "Multi-Currency", path: "/multi-currency", permission: "canViewUserManagement" },
      { icon: Building2Icon, label: "Bank Integrations", path: "/bank-integrations", permission: "canViewUserManagement" },
      { icon: BarChart2, label: "Reconciliation", path: "/reconciliation", permission: "canViewAnalytics" },
      { icon: Server, label: "Disaster Recovery", path: "/disaster-recovery", permission: "canViewSystemSettings" },
      { icon: FlaskConical, label: "A/B Testing", path: "/ab-testing", permission: "canViewAnalytics" },
      { icon: ActivityIcon, label: "Performance Monitor", path: "/performance-monitoring", permission: "canViewAnalytics" },
      { icon: Database, label: "Database Scaling", path: "/postgresql-scaling", permission: "canViewSystemSettings" },
    ],
  },
  {
    label: "Administration",
    items: [
      { icon: Settings, label: "Admin Config Center", path: "/admin-config", permission: "canViewUserManagement" },
      { icon: FilePlus, label: "Create Policy", path: "/admin-policy-creation", permission: "canViewUserManagement" },
      { icon: Calculator, label: "Rate Management", path: "/rate-management", permission: "canViewUserManagement" },
      { icon: UserCog, label: "User Management", path: "/users", permission: "canViewUserManagement" },
      { icon: Settings, label: "System Settings", path: "/settings", permission: "canViewSystemSettings" },
    ],
  },
  {
    label: "My Account",
    items: [
      { icon: User, label: "Profile", path: "/profile", permission: "canViewProfile" },
      { icon: Lock, label: "Security", path: "/security", permission: "canViewProfile" },
    ],
  },
];

const RECENTS_KEY = "insureportal_recent_pages";
const FAVORITES_KEY = "insureportal_favorites";
const COLLAPSED_GROUPS_KEY = "insureportal_collapsed_groups";
const MAX_RECENTS = 5;

function useRecentPages() {
  const [recents, setRecents] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]");
    } catch (err) { console.error('[layout] failed to load recents:', err instanceof Error ? err.message : err); return []; }
  });

  const addRecent = useCallback((path: string) => {
    setRecents((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, MAX_RECENTS);
      localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recents, addRecent };
}

function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    } catch (err) { console.error('[layout] failed to load favorites:', err instanceof Error ? err.message : err); return []; }
  });

  const toggleFavorite = useCallback((path: string) => {
    setFavorites((prev) => {
      const next = prev.includes(path)
        ? prev.filter((p) => p !== path)
        : [...prev, path];
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const isFavorite = useCallback((path: string) => favorites.includes(path), [favorites]);

  return { favorites, toggleFavorite, isFavorite };
}

function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSED_GROUPS_KEY) || "[]"));
    } catch (err) { console.error('[layout] failed to load collapsed groups:', err instanceof Error ? err.message : err); return new Set(); }
  });

  const toggle = useCallback((label: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const isCollapsedGroup = useCallback((label: string) => collapsed.has(label), [collapsed]);

  return { toggle, isCollapsedGroup };
}

const roleLabels: Record<UserRole, string> = {
  admin: "Administrator",
  user: "Customer",
  agent: "Insurance Agent",
  underwriter: "Underwriter",
};

const roleColors: Record<UserRole, string> = {
  admin: "bg-red-100 text-red-800",
  user: "bg-blue-100 text-blue-800",
  agent: "bg-green-100 text-green-800",
  underwriter: "bg-purple-100 text-purple-800",
};

const DEMO_USER = {
  name: "Demo User",
  email: "demo@insureportal.ng",
};

function NavItemButton({
  item,
  isActive,
  isFav,
  onNavigate,
  onToggleFavorite,
}: {
  item: MenuItem;
  isActive: boolean;
  isFav: boolean;
  onNavigate: (path: string) => void;
  onToggleFavorite: (path: string) => void;
}) {
  return (
    <div className="group/item relative flex items-center">
      <button
        onClick={() => onNavigate(item.path)}
        className={`flex items-center gap-3 w-full px-3 py-2 text-sm rounded-md transition-colors ${
          isActive
            ? "bg-blue-50 text-blue-700 font-medium"
            : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <item.icon
          className={`h-4 w-4 shrink-0 ${isActive ? "text-blue-600" : "text-gray-500"}`}
        />
        <span className="truncate">{item.label}</span>
        {item.badge && (
          <Badge variant="destructive" className="h-5 px-1.5 text-xs ml-auto shrink-0">
            {item.badge}
          </Badge>
        )}
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(item.path);
        }}
        className={`absolute right-1 p-1 rounded-sm transition-opacity ${
          isFav
            ? "opacity-100 text-amber-500 hover:text-amber-600"
            : "opacity-0 group-hover/item:opacity-100 text-gray-400 hover:text-amber-500"
        }`}
        title={isFav ? "Remove from favorites" : "Add to favorites"}
      >
        <Star className={`h-3 w-3 ${isFav ? "fill-amber-500" : ""}`} />
      </button>
    </div>
  );
}

export default function UnifiedLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "280px",
        } as CSSProperties
      }
    >
      <UnifiedLayoutContent>{children}</UnifiedLayoutContent>
    </SidebarProvider>
  );
}

function UnifiedLayoutContent({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const isMobile = useIsMobile();
  const { role, setRole, hasPermission } = useRole();
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { recents, addRecent } = useRecentPages();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const { toggle: toggleGroup, isCollapsedGroup } = useCollapsedGroups();

  const permissionFiltered = useMemo(() => menuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!item.permission) return true;
        return hasPermission(item.permission as any);
      }),
    }))
    .filter((group) => group.items.length > 0), [role]);

  const allPermittedItems = useMemo(
    () => permissionFiltered.flatMap((g) => g.items),
    [permissionFiltered]
  );

  const filteredMenuGroups = useMemo(() => {
    if (!searchQuery.trim()) return permissionFiltered;
    const q = searchQuery.toLowerCase();
    return permissionFiltered
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            group.label.toLowerCase().includes(q)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [permissionFiltered, searchQuery]);

  const favoriteItems = useMemo(
    () => allPermittedItems.filter((item) => isFavorite(item.path)),
    [allPermittedItems, isFavorite]
  );

  const recentItems = useMemo(
    () => recents
      .map((path) => allPermittedItems.find((item) => item.path === path))
      .filter((item): item is MenuItem => !!item)
      .filter((item) => !isFavorite(item.path)),
    [recents, allPermittedItems, isFavorite]
  );

  const activeMenuItem = menuGroups
    .flatMap((g) => g.items)
    .find((item) => item.path === location);

  const handleNavigate = useCallback((path: string) => {
    addRecent(path);
    setLocation(path);
  }, [addRecent, setLocation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape" && searchQuery) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchQuery]);

  return (
    <>
      <Sidebar collapsible="icon" className="border-r">
        <SidebarHeader className="h-16 justify-center border-b">
          <div className="flex items-center gap-3 px-2 transition-all w-full">
            <div className="h-8 w-8 flex items-center justify-center bg-blue-600 rounded-lg shrink-0">
              <Shield className="h-5 w-5 text-white" />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-bold text-lg tracking-tight truncate">
                  InsurePortal
                </span>
                <span className="text-xs text-muted-foreground">
                  Unified Platform
                </span>
              </div>
            )}
          </div>
        </SidebarHeader>

        <SidebarContent>
          {/* Search Bar */}
          {!isCollapsed && (
            <div className="px-3 pt-3 pb-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search... (Ctrl+K)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-transparent pl-8 pr-8 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Favorites Section */}
          {!searchQuery && favoriteItems.length > 0 && !isCollapsed && (
            <div className="px-3 py-2">
              <div className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                Favorites
              </div>
              <div className="space-y-0.5">
                {favoriteItems.map((item) => {
                  const isActive = location === item.path;
                  return (
                    <NavItemButton
                      key={`fav-${item.path}`}
                      item={item}
                      isActive={isActive}
                      isFav={true}
                      onNavigate={handleNavigate}
                      onToggleFavorite={toggleFavorite}
                    />
                  );
                })}
              </div>
              <div className="border-b border-gray-200 mt-3" />
            </div>
          )}

          {/* Recently Visited Section */}
          {!searchQuery && recentItems.length > 0 && !isCollapsed && (
            <div className="px-3 py-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <History className="h-3 w-3" />
                Recently Visited
              </div>
              <div className="space-y-0.5">
                {recentItems.slice(0, 3).map((item) => {
                  const isActive = location === item.path;
                  return (
                    <NavItemButton
                      key={`recent-${item.path}`}
                      item={item}
                      isActive={isActive}
                      isFav={false}
                      onNavigate={handleNavigate}
                      onToggleFavorite={toggleFavorite}
                    />
                  );
                })}
              </div>
              <div className="border-b border-gray-200 mt-3" />
            </div>
          )}

          {/* Search Results Count */}
          {searchQuery && (
            <div className="px-4 py-1">
              <span className="text-xs text-muted-foreground">
                {filteredMenuGroups.reduce((acc, g) => acc + g.items.length, 0)} results
              </span>
            </div>
          )}

          {/* Nav Groups */}
          <div className="flex flex-col">
            {filteredMenuGroups.map((group, groupIndex) => {
              const isGroupCollapsed = isCollapsedGroup(group.label) && !searchQuery;
              return (
                <div key={group.label} className="px-3 py-2">
                  {!isCollapsed ? (
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className="flex items-center gap-1 w-full text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 hover:text-foreground transition-colors group"
                    >
                      <ChevronRight
                        className={`h-3 w-3 shrink-0 transition-transform duration-200 ${
                          isGroupCollapsed ? "" : "rotate-90"
                        }`}
                      />
                      <span>{group.label}</span>
                      <span className="ml-auto text-[10px] font-normal opacity-0 group-hover:opacity-100 transition-opacity">
                        {group.items.length}
                      </span>
                    </button>
                  ) : (
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                      {group.label}
                    </div>
                  )}
                  {!isGroupCollapsed && (
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const isActive = location === item.path;
                        return (
                          <NavItemButton
                            key={item.path}
                            item={item}
                            isActive={isActive}
                            isFav={isFavorite(item.path)}
                            onNavigate={handleNavigate}
                            onToggleFavorite={toggleFavorite}
                          />
                        );
                      })}
                    </div>
                  )}
                  {groupIndex < filteredMenuGroups.length - 1 && (
                    <div className="border-b border-gray-200 mt-3" />
                  )}
                </div>
              );
            })}
          </div>
        </SidebarContent>

        <SidebarFooter className="border-t p-3">
          {!isCollapsed && (
            <div className="mb-3">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Switch Role (Demo)
              </label>
              <Select value={role} onValueChange={(value: UserRole) => setRole(value)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Customer</SelectItem>
                  <SelectItem value="agent">Insurance Agent</SelectItem>
                  <SelectItem value="underwriter">Underwriter</SelectItem>
                  <SelectItem value="admin">Administrator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50 transition-colors w-full text-left group-data-[collapsible=icon]:justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Avatar className="h-9 w-9 border shrink-0">
                  <AvatarFallback className="text-xs font-medium bg-blue-100 text-blue-700">
                    {DEMO_USER.name.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate leading-none">
                      {DEMO_USER.name}
                    </p>
                    <Badge className={`text-[10px] px-1.5 py-0 ${roleColors[role]}`}>
                      {roleLabels[role]}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-1">
                    {DEMO_USER.email}
                  </p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground group-data-[collapsible=icon]:hidden" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{DEMO_USER.name}</p>
                <p className="text-xs text-muted-foreground">{DEMO_USER.email}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation("/profile")} className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLocation("/communication")} className="cursor-pointer">
                <MessageSquare className="mr-2 h-4 w-4" />
                <span>Preferences</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => { localStorage.removeItem('insureportal-token'); localStorage.removeItem('insureportal-user'); setLocation('/auth?action=logout'); }} className="cursor-pointer text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Sign out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:backdrop-blur sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="h-8 w-8 rounded-lg" />
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">
                {activeMenuItem?.label ?? "Dashboard"}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={`${roleColors[role]}`}>
              {roleLabels[role]}
            </Badge>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </SidebarInset>
    </>
  );
}
