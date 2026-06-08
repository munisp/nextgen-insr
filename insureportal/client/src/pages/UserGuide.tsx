// @ts-nocheck
/**
 * UserGuide — Comprehensive multi-section user guide for the InsurePortal
 *
 * Sections:
 * 1. Getting Started
 * 2. Policy & Claims Operations
 * 3. Agent Management
 * 4. Transaction Processing
 * 5. Fraud Detection & Prevention
 * 6. KYC Verification
 * 7. Reports & Analytics
 * 8. Settings & Configuration
 * 9. Troubleshooting
 * 10. FAQ
 */
import { useState, useMemo, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  BookOpen,
  Search,
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Zap,
  Users,
  DollarSign,
  Shield,
  FileCheck,
  BarChart2,
  Settings,
  HelpCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  Smartphone,
  Globe,
  Key,
  Bell,
  MessageSquare,
  Wallet,
  ThumbsUp,
  ThumbsDown,
  Send,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

// ─── Guide Section Types ─────────────────────────────────────────────────────
interface GuideStep {
  title: string;
  description: string;
  tip?: string;
}

interface GuideSection {
  id: string;
  title: string;
  icon: any;
  description: string;
  subsections: {
    id: string;
    title: string;
    content: string;
    steps?: GuideStep[];
    relatedPage?: string;
    tags?: string[];
  }[];
}

// ─── Guide Content ───────────────────────────────────────────────────────────
const guideSections: GuideSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    icon: Zap,
    description: "Everything you need to begin using the InsurePortal platform",
    subsections: [
      {
        id: "overview",
        title: "Platform Overview",
        content:
          "InsurePortal is a comprehensive insurance technology platform designed for insurance operations in Nigeria. It enables agents to process policy sales, claims submissions, premium collections, and renewals on behalf of policyholders.\n\nThe platform includes multiple portals for different user roles: Agent Portal for field agents, Customer Portal for policyholders, Underwriter Portal for risk assessment, Developer Portal for API integrations, and Admin/Supervisor dashboards for management oversight.",
        tags: ["introduction", "overview", "platform"],
      },
      {
        id: "first-login",
        title: "First Login & Setup",
        content:
          "To access the platform, navigate to the login page and enter your agent code and PIN provided by your supervisor. On first login, you'll be prompted to change your PIN for security.",
        steps: [
          {
            title: "Enter Agent Code",
            description:
              "Type your assigned agent code (e.g., AGT001) in the Agent Code field",
          },
          {
            title: "Enter PIN",
            description: "Enter the temporary PIN provided by your supervisor",
          },
          {
            title: "Change PIN",
            description:
              "Set a new 4-digit PIN that you'll remember. Do not share this with anyone.",
          },
          {
            title: "Complete Profile",
            description:
              "Fill in your personal details and upload required KYC documents",
          },
          {
            title: "Start Transacting",
            description:
              "Once your KYC is approved, you can begin processing transactions",
          },
        ],
        relatedPage: "/",
        tags: ["login", "setup", "pin"],
      },
      {
        id: "navigation",
        title: "Navigating the Platform",
        content:
          "The platform uses a sidebar navigation organized into logical groups. Use the sidebar to access different features. The top header shows your notification bell and profile menu. On mobile, tap the hamburger menu to reveal the sidebar.\n\nKey navigation areas:\n- Core: Insurance Dashboard and Platform Hub\n- Portals: Agent, Customer, Underwriter, Developer\n- Administration: Admin Panel, Supervisor Dashboard\n- Operations: Policies, Claims, Commissions\n- Monitoring: System Health, Fraud Detection, Analytics",
        tags: ["navigation", "sidebar", "menu"],
      },
      {
        id: "keyboard-shortcuts",
        title: "Keyboard Shortcuts",
        content:
          "Power users can navigate faster using keyboard shortcuts:\n\n- Ctrl+K / Cmd+K: Open global search\n- Ctrl+/: Show keyboard shortcuts help\n- Ctrl+H: Go to home/Insurance Dashboard\n- Ctrl+N: Open notification center\n- Escape: Close any open modal or panel",
        tags: ["keyboard", "shortcuts", "productivity"],
      },
    ],
  },
  {
    id: "insurance-service",
    title: "Policy & Claims Operations",
    icon: Smartphone,
    description: "Manage policies, claims, and premium collections",
    subsections: [
      {
        id: "new-policy",
        title: "New Policy Issuance",
        content:
          "Issue new insurance policies for customers. Supports motor, life, health, property, marine, and agriculture lines.",
        steps: [
          {
            title: "Select Policy Type",
            description: "From the Dashboard, choose the insurance product line",
          },
          {
            title: "Enter Customer Details",
            description: "Enter the policyholder's name, BVN/NIN, and contact details",
          },
          {
            title: "Risk Assessment",
            description: "Complete the risk questionnaire for underwriting",
          },
          {
            title: "Premium Calculation",
            description: "System calculates premium based on risk profile and coverage",
          },
          {
            title: "Confirm & Issue",
            description:
              "Review details, collect premium, and issue the policy certificate.",
          },
        ],
        relatedPage: "/",
        tags: ["policy", "issuance", "new-business"],
      },
      {
        id: "claims-submission",
        title: "Claims Submission",
        content:
          "Submit and track insurance claims. Ensure all supporting documentation is uploaded for faster processing.",
        steps: [
          {
            title: "Initiate Claim",
            description: "From the Claims dashboard, tap Submit New Claim",
          },
          {
            title: "Select Policy",
            description: "Choose the active policy for the claim",
          },
          {
            title: "Enter Claim Details",
            description:
              "Describe the incident, date of loss, and estimated amount.",
          },
          {
            title: "Upload Documents",
            description:
              "Attach supporting evidence (photos, police report, medical records)",
          },
          {
            title: "Submit for Review",
            description:
              "Submit the claim. You'll receive a tracking reference number.",
          },
        ],
        relatedPage: "/",
        tags: ["claims", "submission", "loss"],
      },
      {
        id: "renewals",
        title: "Policy Renewals",
        content:
          "Renew expiring policies before lapse. The system sends automated reminders 30, 14, and 7 days before expiry.",
        steps: [
          {
            title: "View Expiring Policies",
            description: "Check the Renewals dashboard for upcoming expirations",
          },
          {
            title: "Review Coverage",
            description: "Confirm or adjust coverage and sum insured",
          },
          {
            title: "Recalculate Premium",
            description: "System recalculates premium with updated risk factors",
          },
          {
            title: "Collect Premium",
            description: "Process premium payment via bank transfer or card",
          },
          {
            title: "Confirm Renewal",
            description:
              "Issue renewed policy certificate with updated validity dates.",
          },
        ],
        relatedPage: "/",
        tags: ["renewal", "expiry", "premium"],
      },
      {
        id: "premium-collection",
        title: "Premium Collection",
        content:
          "Collect premiums from policyholders. Supports bank transfer, card payment, and mobile money.",
        steps: [
          {
            title: "Select Premium Collection",
            description: "Choose the appropriate payment channel",
          },
          {
            title: "Select Policy",
            description:
              "Choose the policy and verify the outstanding premium amount",
          },
          {
            title: "Process Payment",
            description: "Enter payment details and amount",
          },
          {
            title: "Generate Receipt",
            description: "System generates an official premium receipt",
          },
          {
            title: "Confirm Collection",
            description:
              "Receipt is sent to policyholder via SMS and email.",
          },
        ],
        relatedPage: "/",
        tags: ["premium", "collection", "payment"],
      },
    ],
  },
  {
    id: "agent-management",
    title: "Agent Management",
    icon: Users,
    description: "Manage agents, onboarding, and performance",
    subsections: [
      {
        id: "agent-onboarding",
        title: "Agent Onboarding Process",
        content:
          "New agents go through a 5-step onboarding process: Application → KYC Verification → Device Provisioning → Training → Activation. Each step must be completed before proceeding to the next.\n\nSupervisors can track onboarding progress from the Onboarding Wizard page and approve/reject applications at each stage.",
        relatedPage: "/onboarding-wizard",
        tags: ["onboarding", "new agent", "application"],
      },
      {
        id: "agent-performance",
        title: "Performance Tracking",
        content:
          "Monitor agent performance through KPIs including transaction volume, success rate, customer satisfaction, and compliance score. The Agent Performance Scoring page provides detailed analytics and rankings.\n\nKey metrics tracked:\n- Daily/weekly/monthly transaction volume\n- Transaction success rate (target: >95%)\n- Average transaction processing time\n- Customer complaint ratio\n- KYC compliance status\n- Float utilization efficiency",
        relatedPage: "/agent-performance-scoring",
        tags: ["performance", "kpi", "metrics"],
      },
      {
        id: "float-management",
        title: "Float Management",
        content:
          "Float is the working capital agents use to settle premium collections. Monitor your float balance on the Agent Dashboard. Request top-ups from the Agent Portal when running low.\n\nBest practices:\n- Maintain at least 20% of your daily average as buffer\n- Request top-ups before your balance drops below ₦50,000\n- Reconcile your float daily against premium collection records\n- Report any discrepancies immediately to your supervisor",
        relatedPage: "/agent",
        tags: ["float", "balance", "top-up"],
      },
    ],
  },
  {
    id: "transactions",
    title: "Transaction Processing",
    icon: DollarSign,
    description: "Understanding transaction flows and troubleshooting",
    subsections: [
      {
        id: "transaction-lifecycle",
        title: "Transaction Lifecycle",
        content:
          "Every transaction goes through these stages: Initiated → Processing → Completed/Failed. The platform tracks each stage with timestamps and status updates.\n\nTransaction statuses:\n- Pending: Transaction initiated, awaiting processing\n- Processing: Being processed by the payment gateway\n- Completed: Successfully processed\n- Failed: Transaction failed (check error details)\n- Reversed: Transaction was reversed/refunded\n- Disputed: Under investigation",
        tags: ["lifecycle", "status", "processing"],
      },
      {
        id: "reversals",
        title: "Transaction Reversals",
        content:
          "If a transaction needs to be reversed (e.g., wrong amount, duplicate), follow the reversal process:\n\n1. Go to Transaction History\n2. Find the transaction by reference number\n3. Click 'Request Reversal'\n4. Provide a reason for the reversal\n5. Submit for supervisor approval\n\nNote: Reversals must be requested within 24 hours. Amounts above ₦100,000 require additional approval.",
        relatedPage: "/admin",
        tags: ["reversal", "refund", "dispute"],
      },
      {
        id: "multi-currency",
        title: "Multi-Currency Operations",
        content:
          "The platform supports multiple currencies with real-time FX rates from ECB and Open Exchange Rates. Currency conversion is automatic during cross-border transactions.\n\nSupported currencies: NGN, USD, GBP, EUR, GHS, KES, ZAR\n\nFX rates are updated every 15 minutes. You can set rate alerts to be notified when rates reach your target.",
        relatedPage: "/multi-currency",
        tags: ["currency", "forex", "exchange"],
      },
    ],
  },
  {
    id: "fraud-detection",
    title: "Fraud Detection & Prevention",
    icon: Shield,
    description: "Understanding fraud monitoring and response procedures",
    subsections: [
      {
        id: "fraud-monitoring",
        title: "Real-Time Fraud Monitoring",
        content:
          "The platform uses AI-powered fraud detection with real-time scoring. Every transaction is analyzed for:\n\n- Velocity checks (too many transactions in short time)\n- Amount anomalies (unusual transaction amounts)\n- Geographic anomalies (transactions from unexpected locations)\n- Behavioral patterns (deviations from normal agent behavior)\n- Device fingerprinting (unauthorized device usage)\n\nFraud scores range from 0-100. Scores above 70 trigger alerts, above 85 may block transactions automatically.",
        relatedPage: "/admin/fraud",
        tags: ["fraud", "monitoring", "ai", "detection"],
      },
      {
        id: "fraud-response",
        title: "Responding to Fraud Alerts",
        content:
          "When you receive a fraud alert:\n\n1. DO NOT process the flagged transaction\n2. Verify the customer's identity with additional checks\n3. Check the Fraud Dashboard for alert details\n4. If confirmed suspicious, report via the platform\n5. Your supervisor will be automatically notified\n6. Document everything for the investigation\n\nNever share fraud alert details with the customer under investigation.",
        relatedPage: "/admin/fraud",
        tags: ["fraud", "alert", "response", "procedure"],
      },
    ],
  },
  {
    id: "kyc-verification",
    title: "KYC Verification",
    icon: FileCheck,
    description: "Know Your Customer document management and compliance",
    subsections: [
      {
        id: "kyc-requirements",
        title: "KYC Document Requirements",
        content:
          "All agents must complete KYC verification before processing transactions. Required documents:\n\n- National Identification Number (NIN)\n- Bank Verification Number (BVN)\n- Proof of Address (utility bill, bank statement)\n- Passport Photograph\n- Valid Government-issued ID (Driver's License, International Passport, or Voter's Card)\n\nDocuments must be clear, legible, and not expired. Processing time is typically 24-48 hours.",
        relatedPage: "/kyc-verification",
        tags: ["kyc", "documents", "verification", "compliance"],
      },
      {
        id: "kyc-tiers",
        title: "KYC Tiers & Limits",
        content:
          "Transaction limits are tied to KYC verification level:\n\n- Tier 1 (Basic): Daily limit ₦50,000, monthly ₦300,000\n- Tier 2 (Standard): Daily limit ₦200,000, monthly ₦2,000,000\n- Tier 3 (Enhanced): Daily limit ₦5,000,000, monthly ₦50,000,000\n\nUpgrade your tier by submitting additional verification documents. Higher tiers unlock more transaction types and higher limits.",
        relatedPage: "/kyc-verification",
        tags: ["kyc", "tiers", "limits"],
      },
    ],
  },
  {
    id: "reports-analytics",
    title: "Reports & Analytics",
    icon: BarChart2,
    description: "Generate reports and analyze platform data",
    subsections: [
      {
        id: "weekly-reports",
        title: "Weekly Reports",
        content:
          "Automated weekly reports are generated every Monday covering the previous week's activity. Reports include:\n\n- Transaction summary (volume, value, success rate)\n- Agent performance rankings\n- Fraud alert summary\n- Settlement reconciliation status\n- Commission calculations\n\nReports can be compared side-by-side using the Report Comparison tool.",
        relatedPage: "/weekly-reports",
        tags: ["reports", "weekly", "summary"],
      },
      {
        id: "analytics-dashboard",
        title: "Analytics Dashboard",
        content:
          "The Analytics Dashboard provides real-time insights into platform performance. Key visualizations include:\n\n- Transaction volume trends (hourly, daily, weekly)\n- Revenue and commission breakdown\n- Geographic distribution of transactions\n- Agent activity heatmap\n- Customer acquisition funnel\n- Service uptime and response times",
        relatedPage: "/platform-analytics",
        tags: ["analytics", "dashboard", "charts"],
      },
      {
        id: "data-export",
        title: "Data Export",
        content:
          "Export platform data in multiple formats (CSV, Excel, PDF) for external analysis or compliance reporting. Available exports:\n\n- Transaction history\n- Agent roster and performance\n- Audit logs\n- Settlement records\n- CBN regulatory reports\n\nScheduled exports can be configured to run automatically and delivered via email.",
        relatedPage: "/data-export",
        tags: ["export", "csv", "excel", "download"],
      },
    ],
  },
  {
    id: "settings",
    title: "Settings & Configuration",
    icon: Settings,
    description: "Configure notifications, security, and preferences",
    subsections: [
      {
        id: "notification-settings",
        title: "Notification Preferences",
        content:
          "Customize how you receive notifications across channels:\n\n- In-App: Real-time notifications in the notification center\n- Email: Daily digest or instant alerts\n- SMS: Critical alerts only (fraud, system outages)\n- Push: Browser push notifications for important events\n\nSet quiet hours to pause non-critical notifications during off-hours. Configure per-category preferences for granular control.",
        relatedPage: "/notification-preferences",
        tags: ["notifications", "preferences", "alerts"],
      },
      {
        id: "security-settings",
        title: "Security Settings",
        content:
          "Protect your account with these security features:\n\n- PIN Change: Update your PIN regularly (recommended every 30 days)\n- Session Management: View and terminate active sessions\n- API Keys: Manage API access tokens for integrations\n- Audit Log: Review all actions performed on your account\n- Two-Factor Authentication: Enable 2FA for additional security\n\nReport any unauthorized access immediately to your supervisor.",
        relatedPage: "/session-manager",
        tags: ["security", "pin", "2fa", "sessions"],
      },
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    icon: AlertTriangle,
    description: "Common issues and how to resolve them",
    subsections: [
      {
        id: "common-issues",
        title: "Common Issues",
        content:
          "Frequently encountered problems and solutions:\n\n**Transaction Timeout**: Check your internet connection. If the issue persists, check System Health for service outages. The transaction may have been processed — verify in Transaction History before retrying.\n\n**Insufficient Float**: Request a float top-up from the Agent Portal. Emergency top-ups can be requested from your supervisor.\n\n**Login Failed**: Verify your agent code and PIN. After 5 failed attempts, your account is locked for 30 minutes. Contact your supervisor for PIN reset.\n\n**Receipt Not Printing**: Check printer connection and paper. You can reprint receipts from Transaction History.\n\n**Slow Performance**: Clear your browser cache, close unnecessary tabs, and ensure a stable internet connection.",
        tags: ["troubleshooting", "issues", "problems"],
      },
      {
        id: "error-codes",
        title: "Error Codes Reference",
        content:
          "Common error codes and their meanings:\n\n- E001: Network timeout — retry the transaction\n- E002: Insufficient balance — check float/account balance\n- E003: Invalid account — verify customer details\n- E004: Transaction limit exceeded — check daily/monthly limits\n- E005: Service unavailable — check System Health\n- E006: Duplicate transaction — transaction may already be processed\n- E007: Authentication failed — re-enter PIN\n- E008: Fraud block — transaction flagged, contact supervisor\n- E009: KYC required — customer needs to complete verification\n- E010: Maintenance mode — system under maintenance, try later",
        tags: ["errors", "codes", "reference"],
      },
      {
        id: "contact-support",
        title: "Contacting Support",
        content:
          "If you can't resolve an issue:\n\n1. Use the AI Chat Widget (bottom-right corner) for instant help\n2. Check the Live Chat page for human agent support\n3. Email: support@insureportal.ng\n4. Phone: +234-800-INSURE (0800-467873)\n5. WhatsApp: +234-901-234-5678\n\nSupport hours: Monday-Saturday, 7:00 AM - 10:00 PM WAT\nEmergency support (fraud, system outages): 24/7",
        tags: ["support", "contact", "help"],
      },
    ],
  },
  {
    id: "faq",
    title: "Frequently Asked Questions",
    icon: HelpCircle,
    description: "Quick answers to common questions",
    subsections: [
      {
        id: "general-faq",
        title: "General FAQ",
        content:
          "**Q: What is the minimum transaction amount?**\nA: The minimum transaction amount is ₦100 for all transaction types.\n\n**Q: What are the operating hours?**\nA: The platform operates 24/7. However, some services (inter-bank transfers) may have processing windows.\n\n**Q: How do I check my commission earnings?**\nA: Go to Commission Payouts page to view your earnings breakdown by period.\n\n**Q: Can I process transactions offline?**\nA: Yes, the platform supports offline mode for basic transactions. They will be synced when connectivity is restored.\n\n**Q: How often are settlements processed?**\nA: Settlements are processed daily (T+1). Check Settlement Reconciliation for status.\n\n**Q: What happens if my device is lost or stolen?**\nA: Immediately contact your supervisor to deactivate the device. A new device can be provisioned through the MDM system.",
        tags: ["faq", "general", "questions"],
      },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// UserGuide Component
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Sidebar Rating Badge ───────────────────────────────────────────────────
function SidebarRatingBadge({ sectionId }: { sectionId: string }) {
  const { data: stats } = trpc.guideFeedback.stats.useQuery(undefined, {
    staleTime: 60000,
  });
  // @ts-ignore Sprint 85
  const sectionData = stats?.[sectionId];
  if (!sectionData || sectionData.total === 0) return null;
  const pct = Math.round((sectionData.up / sectionData.total) * 100);
  return (
    <span
      className={cn(
        "text-[9px] px-1.5 py-0.5 rounded-full font-medium",
        pct >= 70
          ? "bg-green-500/10 text-green-400"
          : pct >= 40
            ? "bg-amber-500/10 text-amber-400"
            : "bg-red-500/10 text-red-400"
      )}
    >
      {pct}%
    </span>
  );
}

// ─── Section Feedback Component ──────────────────────────────────────────────
function SectionFeedback({
  sectionId,
  subsectionId,
}: {
  sectionId: string;
  subsectionId: string;
}) {
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const utils = trpc.useUtils();

  const submitMutation = trpc.guideFeedback.submit.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      utils.guideFeedback.stats.invalidate();
    },
  });

  // Reset state when section changes
  useMemo(() => {
    setRating(null);
    setComment("");
    setSubmitted(false);
  }, [sectionId, subsectionId]);

  const handleSubmit = () => {
    if (!rating) return;
    submitMutation.mutate({
      // @ts-ignore Sprint 85
      sectionId,
      subsectionId,
      rating,
      comment,
    });
  };

  if (submitted) {
    return (
      <div className="mt-6 p-4 rounded-lg border border-green-500/20 bg-green-500/5 text-center">
        <CheckCircle2 className="h-5 w-5 text-green-500 mx-auto mb-2" />
        <p className="text-sm font-medium text-green-400">
          Thank you for your feedback!
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Your input helps us improve the guide.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 p-4 rounded-lg border border-border bg-muted/20">
      <p className="text-sm font-medium mb-3">Was this section helpful?</p>
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => setRating("up")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors",
            rating === "up"
              ? "border-green-500 bg-green-500/10 text-green-400"
              : "border-border hover:bg-accent text-muted-foreground"
          )}
        >
          <ThumbsUp className="h-4 w-4" />
          Yes
        </button>
        <button
          onClick={() => setRating("down")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors",
            rating === "down"
              ? "border-red-500 bg-red-500/10 text-red-400"
              : "border-border hover:bg-accent text-muted-foreground"
          )}
        >
          <ThumbsDown className="h-4 w-4" />
          No
        </button>
      </div>

      {rating && (
        <div className="space-y-2">
          <Textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder={
              rating === "up"
                ? "What did you find most helpful? (optional)"
                : "How can we improve this section? (optional)"
            }
            className="min-h-[60px] text-sm resize-none"
            rows={2}
          />
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitMutation.isPending}
            className="w-full"
          >
            <Send className="h-3.5 w-3.5 mr-1.5" />
            {submitMutation.isPending ? "Submitting..." : "Submit Feedback"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function UserGuide() {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string>("getting-started");
  const [activeSubsection, setActiveSubsection] = useState<string>("overview");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["getting-started"])
  );
  const [, navigate] = useLocation();

  // Search filtering
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const query = searchQuery.toLowerCase();
    const results: {
      sectionId: string;
      subsectionId: string;
      title: string;
      sectionTitle: string;
      snippet: string;
    }[] = [];

    guideSections.forEach(section => {
      section.subsections.forEach(sub => {
        const matchesTitle = sub.title.toLowerCase().includes(query);
        const matchesContent = sub.content.toLowerCase().includes(query);
        const matchesTags = sub.tags?.some(t => t.includes(query));

        if (matchesTitle || matchesContent || matchesTags) {
          // Extract snippet around match
          const idx = sub.content.toLowerCase().indexOf(query);
          const start = Math.max(0, idx - 50);
          const end = Math.min(sub.content.length, idx + query.length + 80);
          const snippet =
            (start > 0 ? "..." : "") +
            sub.content.slice(start, end) +
            (end < sub.content.length ? "..." : "");

          results.push({
            sectionId: section.id,
            subsectionId: sub.id,
            title: sub.title,
            sectionTitle: section.title,
            snippet,
          });
        }
      });
    });

    return results;
  }, [searchQuery]);

  const toggleSection = (id: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectSubsection = (sectionId: string, subsectionId: string) => {
    setActiveSection(sectionId);
    setActiveSubsection(subsectionId);
    setExpandedSections(prev => new Set(prev).add(sectionId));
    setSearchQuery("");
  };

  // Find active content
  const currentSection = guideSections.find(s => s.id === activeSection);
  const currentSubsection = currentSection?.subsections.find(
    s => s.id === activeSubsection
  );

  return (
    <DashboardLayout>
      <div className="flex gap-6 h-[calc(100vh-6rem)]">
        {/* ── Left Sidebar: Table of Contents ────────────────────────── */}
        <div className="w-72 flex-shrink-0 flex flex-col border-r border-border pr-4">
          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search guide..."
              className="pl-9"
            />
          </div>

          {/* Search Results */}
          {searchResults && (
            <ScrollArea className="flex-1">
              {searchResults.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No results found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground mb-2">
                    {searchResults.length} results
                  </p>
                  {searchResults.map((r, i) => (
                    <button
                      key={i}
                      onClick={() =>
                        selectSubsection(r.sectionId, r.subsectionId)
                      }
                      className="w-full text-left p-3 rounded-lg hover:bg-accent transition-colors"
                    >
                      <p className="text-sm font-medium">{r.title}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {r.sectionTitle}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {r.snippet}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}

          {/* Table of Contents */}
          {!searchResults && (
            <ScrollArea className="flex-1">
              <div className="space-y-1">
                {guideSections.map(section => {
                  const Icon = section.icon;
                  const isExpanded = expandedSections.has(section.id);
                  const isActive = activeSection === section.id;

                  return (
                    <div key={section.id}>
                      <button
                        onClick={() => {
                          toggleSection(section.id);
                          if (!isExpanded) {
                            setActiveSection(section.id);
                            setActiveSubsection(
                              section.subsections[0]?.id || ""
                            );
                          }
                        }}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-accent text-foreground"
                        )}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        <span className="flex-1 text-left truncate">
                          {section.title}
                        </span>
                        <SidebarRatingBadge sectionId={section.id} />
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="ml-6 mt-1 space-y-0.5 mb-2">
                          {section.subsections.map(sub => (
                            <button
                              key={sub.id}
                              onClick={() =>
                                selectSubsection(section.id, sub.id)
                              }
                              className={cn(
                                "w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors",
                                activeSubsection === sub.id
                                  ? "bg-primary/10 text-primary font-medium"
                                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
                              )}
                            >
                              {sub.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* ── Main Content ────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <ScrollArea className="h-full pr-4">
            {currentSection && currentSubsection ? (
              <div className="max-w-3xl">
                {/* Breadcrumb */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>User Guide</span>
                  <ChevronRight className="h-3 w-3" />
                  <span>{currentSection.title}</span>
                  <ChevronRight className="h-3 w-3" />
                  <span className="text-foreground">
                    {currentSubsection.title}
                  </span>
                </div>

                {/* Title */}
                <h1 className="text-2xl font-bold mb-2">
                  {currentSubsection.title}
                </h1>

                {/* Tags */}
                {currentSubsection.tags && (
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {currentSubsection.tags.map(tag => (
                      <Badge
                        key={tag}
                        variant="outline"
                        className="text-[10px]"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Content */}
                <div className="prose prose-sm prose-invert max-w-none mb-6">
                  {currentSubsection.content
                    .split("\n\n")
                    .map((paragraph, i) => (
                      <p
                        key={i}
                        className="text-sm text-muted-foreground leading-relaxed mb-3 whitespace-pre-line"
                      >
                        {paragraph}
                      </p>
                    ))}
                </div>

                {/* Steps */}
                {currentSubsection.steps && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <ArrowRight className="h-4 w-4 text-primary" />
                      Step-by-Step Guide
                    </h3>
                    <div className="space-y-3">
                      {currentSubsection.steps.map((step, i) => (
                        <div
                          key={i}
                          className="flex gap-3 p-3 rounded-lg bg-muted/30 border border-border/50"
                        >
                          <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 text-sm font-bold">
                            {i + 1}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{step.title}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {step.description}
                            </p>
                            {step.tip && (
                              <div className="flex items-start gap-1.5 mt-2 text-xs text-amber-400">
                                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                <span>{step.tip}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Related Page Link */}
                {currentSubsection.relatedPage && (
                  <div className="mt-6 p-4 rounded-lg border border-border bg-muted/20">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ExternalLink className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">
                          Related Page
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(currentSubsection.relatedPage!)}
                        className="text-xs"
                      >
                        Open Page <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Feedback Widget ─────────────────────────────────── */}
                <SectionFeedback
                  sectionId={activeSection}
                  subsectionId={activeSubsection}
                />

                {/* Navigation */}
                <div className="flex items-center justify-between mt-8 pt-4 border-t border-border">
                  {(() => {
                    // Find prev/next subsections across all sections
                    const allSubs: {
                      sectionId: string;
                      subsectionId: string;
                      title: string;
                    }[] = [];
                    guideSections.forEach(s =>
                      s.subsections.forEach(sub =>
                        allSubs.push({
                          sectionId: s.id,
                          subsectionId: sub.id,
                          title: sub.title,
                        })
                      )
                    );
                    const currentIdx = allSubs.findIndex(
                      s =>
                        s.sectionId === activeSection &&
                        s.subsectionId === activeSubsection
                    );
                    const prev =
                      currentIdx > 0 ? allSubs[currentIdx - 1] : null;
                    const next =
                      currentIdx < allSubs.length - 1
                        ? allSubs[currentIdx + 1]
                        : null;

                    return (
                      <>
                        {prev ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              selectSubsection(
                                prev.sectionId,
                                prev.subsectionId
                              )
                            }
                            className="text-xs"
                          >
                            ← {prev.title}
                          </Button>
                        ) : (
                          <div />
                        )}
                        {next ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              selectSubsection(
                                next.sectionId,
                                next.subsectionId
                              )
                            }
                            className="text-xs"
                          >
                            {next.title} →
                          </Button>
                        ) : (
                          <div />
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="text-center py-20 text-muted-foreground">
                <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">
                  Select a topic from the sidebar
                </p>
              </div>
            )}
          </ScrollArea>
        </div>
      </div>
    </DashboardLayout>
  );
}
