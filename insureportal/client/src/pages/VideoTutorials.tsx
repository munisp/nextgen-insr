/**
 * VideoTutorials — Interactive video tutorial hub for the 5 most complex features
 *
 * Each tutorial includes:
 * - Embedded video player placeholder (with chapter markers)
 * - Step-by-step transcript/walkthrough
 * - Progress tracking (localStorage)
 * - Related guide links
 * - Duration and difficulty level
 */
import { useState, useCallback, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play,
  Pause,
  CheckCircle2,
  Clock,
  BarChart2,
  ChevronRight,
  ChevronDown,
  Search,
  BookOpen,
  Star,
  Monitor,
  Shield,
  FileCheck,
  Wallet,
  Settings,
  ArrowRight,
  RotateCcw,
  Video,
  Layers,
  Target,
  Award,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

// ─── Tutorial Types ─────────────────────────────────────────────────────────
interface TutorialChapter {
  id: string;
  title: string;
  timestamp: string; // "00:00"
  duration: string;
  content: string;
  steps: string[];
  tips?: string[];
}

interface Tutorial {
  id: string;
  title: string;
  description: string;
  icon: any;
  difficulty: "beginner" | "intermediate" | "advanced";
  duration: string;
  chapters: TutorialChapter[];
  relatedPages: { label: string; path: string }[];
  prerequisites?: string[];
  tags: string[];
}

// ─── Tutorial Content ───────────────────────────────────────────────────────
const tutorials: Tutorial[] = [
  {
    id: "cash-transactions",
    title: "Processing Cash-In & Cash-Out Transactions",
    description:
      "Master the complete cash-in and cash-out workflow, including customer verification, float management, receipt generation, and error handling.",
    icon: Wallet,
    difficulty: "beginner",
    duration: "12 min",
    tags: ["cash-in", "cash-out", "transactions", "float", "receipt"],
    prerequisites: [
      "Active agent account with valid KYC",
      "Sufficient float balance",
    ],
    relatedPages: [
      { label: "Service Node", path: "/" },
      { label: "User Guide: Transactions", path: "/user-guide" },
    ],
    chapters: [
      {
        id: "cash-overview",
        title: "Understanding Cash Operations",
        timestamp: "00:00",
        duration: "2 min",
        content:
          "Cash-in (deposits) and cash-out (withdrawals) are the most common POS operations. Cash-in adds money to a customer's account while cash-out allows them to withdraw. Both operations require proper customer identification and affect your float balance.",
        steps: [
          "Navigate to the Service Node from the Hub",
          "Select either 'Premium Payment' or 'Claim Payout' from the transaction menu",
          "The system will check your current float balance before proceeding",
        ],
        tips: [
          "Always verify the customer's identity before processing any transaction",
        ],
      },
      {
        id: "cash-in-process",
        title: "Processing a Cash-In (Deposit)",
        timestamp: "02:00",
        duration: "3 min",
        content:
          "A cash-in transaction involves collecting physical cash from the customer and crediting their account. The amount is deducted from your float balance and the customer receives a deposit confirmation.",
        steps: [
          "Select 'Premium Payment' from the Service Node menu",
          "Enter the customer's account number or phone number",
          "Enter the deposit amount (minimum ₦100, maximum ₦500,000)",
          "Verify the customer name displayed on screen matches the person",
          "Collect the physical cash from the customer",
          "Click 'Process Transaction' to complete the deposit",
          "Print or send the receipt to the customer via SMS",
        ],
        tips: [
          "Count the cash in front of the customer to avoid disputes",
          "The commission rate for cash-in is typically 0.5% of the transaction amount",
        ],
      },
      {
        id: "cash-out-process",
        title: "Processing a Cash-Out (Withdrawal)",
        timestamp: "05:00",
        duration: "3 min",
        content:
          "A cash-out transaction involves debiting the customer's account and dispensing physical cash. This increases your float balance. Ensure you have sufficient physical cash before starting.",
        steps: [
          "Select 'Claim Payout' from the Service Node menu",
          "Enter the customer's account number or phone number",
          "Enter the withdrawal amount",
          "The customer authorizes the transaction via their bank's approval",
          "Dispense the exact cash amount to the customer",
          "Click 'Confirm Dispensed' to complete the transaction",
          "Provide the receipt to the customer",
        ],
        tips: [
          "Always count cash twice before handing it to the customer",
          "If the transaction fails after authorization, contact support immediately",
        ],
      },
      {
        id: "float-management",
        title: "Managing Your Float Balance",
        timestamp: "08:00",
        duration: "2 min",
        content:
          "Your float balance determines how many cash-in transactions you can process. Cash-in reduces float, cash-out increases it. Monitor your float regularly and request top-ups when running low.",
        steps: [
          "Check your current float in the Service Node header bar",
          "Navigate to Admin Panel > Float Requests to request a top-up",
          "Enter the desired top-up amount and submit",
          "Wait for supervisor approval (you'll receive a notification)",
          "Once approved, your float balance updates automatically",
        ],
        tips: [
          "Request float top-ups before your balance drops below ₦50,000",
          "Float requests are typically approved within 1-2 hours during business hours",
        ],
      },
      {
        id: "error-handling",
        title: "Handling Transaction Errors",
        timestamp: "10:00",
        duration: "2 min",
        content:
          "Transactions can fail due to network issues, insufficient funds, or system errors. Understanding error codes helps you resolve issues quickly and maintain customer trust.",
        steps: [
          "Note the error code displayed (e.g., E001 = Network timeout)",
          "For network errors: wait 30 seconds and retry the transaction",
          "For insufficient float: request a top-up before retrying",
          "For customer account errors: verify the account number and try again",
          "If the error persists, use the chat support widget for assistance",
          "For reversed transactions, check the Audit Log for confirmation",
        ],
        tips: [
          "Never retry a transaction without first checking if the original went through",
          "Keep a manual log of failed transactions for reconciliation",
        ],
      },
    ],
  },
  {
    id: "fraud-detection",
    title: "Fraud Detection & Alert Management",
    description:
      "Learn to identify, investigate, and resolve fraud alerts using the AI-powered fraud detection system, including pattern analysis and escalation workflows.",
    icon: Shield,
    difficulty: "advanced",
    duration: "18 min",
    tags: ["fraud", "alerts", "investigation", "AI", "escalation", "security"],
    prerequisites: ["Admin or supervisor role", "Completed fraud training"],
    relatedPages: [
      { label: "Fraud Dashboard", path: "/admin/fraud" },
      { label: "User Guide: Fraud Detection", path: "/user-guide" },
    ],
    chapters: [
      {
        id: "fraud-overview",
        title: "Understanding the Fraud Detection System",
        timestamp: "00:00",
        duration: "3 min",
        content:
          "The InsurePortal fraud detection system uses AI and rule-based engines to monitor transactions in real-time. It assigns fraud scores (0-100) and categorizes alerts by severity: Critical (80+), High (60-79), Medium (40-59), and Low (0-39).",
        steps: [
          "Navigate to Admin Panel > Fraud tab or the dedicated Fraud Dashboard",
          "Review the overview panel showing active alerts by severity",
          "Critical alerts require immediate attention within 15 minutes",
          "The AI engine analyzes transaction patterns, velocity, amounts, and geolocation",
        ],
        tips: [
          "Critical alerts trigger real-time notifications via push and SMS",
        ],
      },
      {
        id: "investigating-alerts",
        title: "Investigating a Fraud Alert",
        timestamp: "03:00",
        duration: "4 min",
        content:
          "Each fraud alert contains detailed information including the transaction details, customer history, AI analysis explanation, and recommended actions. Proper investigation follows a structured workflow.",
        steps: [
          "Click on an alert to open the detail panel",
          "Review the AI Explanation field for the detection rationale",
          "Check the customer's transaction history for unusual patterns",
          "Verify the transaction amount against the customer's typical behavior",
          "Review the geolocation data for inconsistencies",
          "Check if the same customer has previous fraud alerts",
        ],
        tips: [
          "Look for velocity anomalies: many transactions in a short time window",
          "Cross-reference with the agent's transaction log for corroboration",
        ],
      },
      {
        id: "resolving-alerts",
        title: "Resolving & Escalating Alerts",
        timestamp: "07:00",
        duration: "4 min",
        content:
          "After investigation, you can resolve an alert as legitimate, confirm fraud, or escalate for further review. Each action is logged in the audit trail.",
        steps: [
          "Click 'Resolve' to mark as legitimate (false positive)",
          "Click 'Confirm Fraud' to flag and block the transaction",
          "Click 'Escalate' to send to senior fraud team with notes",
          "Click 'Snooze' to temporarily defer (set a reminder time)",
          "Add investigation notes in the comments field",
          "The system automatically updates the customer's risk profile",
        ],
        tips: [
          "Always add detailed notes when resolving or escalating",
          "Confirmed fraud automatically triggers account review",
        ],
      },
      {
        id: "auto-rules",
        title: "Configuring Auto-Resolution Rules",
        timestamp: "11:00",
        duration: "4 min",
        content:
          "The dispute auto-resolution engine can automatically handle certain alert types based on configurable rules. This reduces manual workload for common false-positive patterns.",
        steps: [
          "Navigate to Dispute Auto Rules page",
          "Create a new rule with conditions (amount range, type, score threshold)",
          "Set the automatic action (resolve, escalate, or flag for review)",
          "Test the rule against historical data before activating",
          "Monitor the rule's performance in the analytics dashboard",
        ],
        tips: [
          "Start with conservative rules and gradually expand",
          "Review auto-resolved alerts weekly for accuracy",
        ],
      },
      {
        id: "fraud-analytics",
        title: "Fraud Analytics & Reporting",
        timestamp: "15:00",
        duration: "3 min",
        content:
          "The fraud analytics dashboard provides insights into detection patterns, false positive rates, resolution times, and trending fraud types. Use these metrics to optimize your fraud prevention strategy.",
        steps: [
          "View the fraud trend chart in Admin Analytics",
          "Monitor the false positive rate (target: below 15%)",
          "Track average resolution time per severity level",
          "Export fraud reports for compliance documentation",
          "Set up custom thresholds for alert triggers",
        ],
      },
    ],
  },
  {
    id: "kyc-verification",
    title: "KYC Document Verification Workflow",
    description:
      "Complete guide to the Know Your Customer verification process, including document submission, review procedures, approval workflows, and compliance requirements.",
    icon: FileCheck,
    difficulty: "intermediate",
    duration: "15 min",
    tags: ["kyc", "verification", "documents", "compliance", "identity"],
    prerequisites: ["Agent or admin account"],
    relatedPages: [
      { label: "KYC Verification", path: "/kyc-verification" },
      { label: "User Guide: KYC", path: "/user-guide" },
    ],
    chapters: [
      {
        id: "kyc-overview",
        title: "KYC Requirements Overview",
        timestamp: "00:00",
        duration: "3 min",
        content:
          "Know Your Customer (KYC) verification is mandatory for all agents and high-value customers. Nigerian CBN regulations require identity verification before processing transactions above ₦50,000. The platform supports NIN, BVN, International Passport, and Driver's License verification.",
        steps: [
          "Navigate to KYC Verification from the sidebar",
          "Review the required document types for your verification tier",
          "Tier 1 (Basic): NIN or BVN — up to ₦300,000 daily limit",
          "Tier 2 (Standard): NIN + Utility Bill — up to ₦1,000,000 daily limit",
          "Tier 3 (Enhanced): Full document set — unlimited transactions",
        ],
        tips: ["Start KYC early — standard processing takes 24-48 hours"],
      },
      {
        id: "document-submission",
        title: "Submitting KYC Documents",
        timestamp: "03:00",
        duration: "4 min",
        content:
          "Document submission requires clear, legible copies of identity documents. The system performs automated checks on document validity before human review.",
        steps: [
          "Click 'Submit New Document' on the KYC Verification page",
          "Select the document type (NIN Slip, BVN Printout, Passport, etc.)",
          "Upload a clear photo or scan (JPEG/PNG, max 5MB)",
          "Enter the document number for automated verification",
          "Add any additional notes for the reviewer",
          "Submit and wait for the automated pre-check (30-60 seconds)",
          "If pre-check passes, the document enters the review queue",
        ],
        tips: [
          "Ensure all four corners of the document are visible",
          "Photos should be well-lit with no glare or shadows",
          "Expired documents will be automatically rejected",
        ],
      },
      {
        id: "review-process",
        title: "The Review Process (Admin View)",
        timestamp: "07:00",
        duration: "4 min",
        content:
          "Admins and compliance officers review submitted documents against CBN guidelines. The review includes document authenticity checks, data cross-referencing, and risk assessment.",
        steps: [
          "Open the KYC Verification page as an admin",
          "Filter by 'Pending Review' to see the queue",
          "Click a submission to open the review panel",
          "Verify document authenticity (check security features)",
          "Cross-reference the document number with the national database",
          "Check the applicant's risk score and transaction history",
          "Approve, reject (with reason), or request additional documents",
        ],
        tips: [
          "Rejection reasons must be specific to help the applicant resubmit",
          "Flag suspicious documents for the compliance team",
        ],
      },
      {
        id: "status-tracking",
        title: "Tracking Verification Status",
        timestamp: "11:00",
        duration: "2 min",
        content:
          "Both agents and customers can track their KYC verification status in real-time. The system sends notifications at each stage of the process.",
        steps: [
          "View your current KYC status on the KYC Verification page",
          "Status flow: Submitted → Under Review → Approved/Rejected",
          "Receive push notifications when status changes",
          "If rejected, review the reason and resubmit corrected documents",
          "Approved KYC automatically upgrades your transaction limits",
        ],
      },
      {
        id: "compliance",
        title: "Compliance & Regulatory Requirements",
        timestamp: "13:00",
        duration: "2 min",
        content:
          "The platform enforces CBN regulatory requirements including periodic KYC renewal, transaction monitoring thresholds, and suspicious activity reporting.",
        steps: [
          "KYC documents expire annually — renewal reminders are sent 30 days before",
          "Transaction limits are enforced based on current KYC tier",
          "Suspicious activity is automatically flagged for compliance review",
          "Maintain records of all KYC submissions for audit purposes",
          "Report any suspected identity fraud through the fraud alert system",
        ],
      },
    ],
  },
  {
    id: "float-settlement",
    title: "Agent Float Management & Settlement",
    description:
      "Comprehensive guide to float balance management, top-up requests, daily settlement processes, reconciliation, and commission payouts.",
    icon: BarChart2,
    difficulty: "intermediate",
    duration: "14 min",
    tags: ["float", "settlement", "reconciliation", "commission", "payout"],
    prerequisites: [
      "Active agent account",
      "Completed at least 10 transactions",
    ],
    relatedPages: [
      {
        label: "Settlement Reconciliation",
        path: "/settlement-reconciliation",
      },
      { label: "Commission Payouts", path: "/commission-payouts" },
      { label: "User Guide: Reports", path: "/user-guide" },
    ],
    chapters: [
      {
        id: "float-basics",
        title: "Understanding Float Balance",
        timestamp: "00:00",
        duration: "3 min",
        content:
          "Float is the working capital that enables agents to process transactions. Cash-in transactions reduce your float (you give the customer credit and collect cash), while cash-out transactions increase it (customer's account is debited and you dispense cash).",
        steps: [
          "View your current float balance in the Service Node header",
          "Monitor float changes in real-time as you process transactions",
          "Set up low-float alerts in Settings > Notifications",
          "Understand the float formula: Starting Float + Cash-Outs - Cash-Ins = Current Float",
        ],
        tips: [
          "Maintain a minimum float of ₦100,000 for uninterrupted operations",
          "Float top-up requests should be submitted before 2:00 PM for same-day processing",
        ],
      },
      {
        id: "topup-workflow",
        title: "Float Top-Up Request Workflow",
        timestamp: "03:00",
        duration: "3 min",
        content:
          "When your float runs low, submit a top-up request through the platform. Requests go through an approval workflow with your supervisor or admin.",
        steps: [
          "Navigate to Admin Panel > Float Requests",
          "Click 'Request Top-Up' and enter the desired amount",
          "Select your preferred funding method (bank transfer, cash deposit)",
          "Submit the request — your supervisor receives a notification",
          "Track the request status: Pending → Approved/Rejected",
          "Once approved, the float is credited to your account immediately",
          "If rejected, review the reason and resubmit with corrections",
        ],
      },
      {
        id: "daily-settlement",
        title: "Daily Settlement Process",
        timestamp: "06:00",
        duration: "3 min",
        content:
          "Settlement runs automatically at 5:00 PM WAT daily. It aggregates all transactions, calculates commissions, and generates settlement reports for each agent.",
        steps: [
          "Settlement triggers automatically at 5:00 PM WAT",
          "The system aggregates: transaction count, total volume, commissions, failed transactions",
          "Each agent receives an SMS summary of their daily settlement",
          "Admins can trigger manual settlement from the Admin Panel Overview",
          "Settlement reports are available in the Weekly Reports section",
        ],
        tips: [
          "Ensure all pending transactions are completed before 5:00 PM",
          "Manual settlement can be triggered for urgent reconciliation needs",
        ],
      },
      {
        id: "reconciliation",
        title: "Settlement Reconciliation",
        timestamp: "09:00",
        duration: "3 min",
        content:
          "Reconciliation compares your transaction records with the bank's records to identify discrepancies. Any mismatches are flagged for investigation.",
        steps: [
          "Navigate to Settlement Reconciliation page",
          "Review the reconciliation summary for the selected period",
          "Green items: matched and confirmed",
          "Yellow items: minor discrepancies (timing differences)",
          "Red items: significant mismatches requiring investigation",
          "Click any discrepancy to see the detailed comparison",
          "Submit dispute tickets for unresolved discrepancies",
        ],
      },
      {
        id: "commission-payouts",
        title: "Commission Payouts",
        timestamp: "12:00",
        duration: "2 min",
        content:
          "Commissions are calculated per transaction based on type and amount. They accumulate daily and are paid out during settlement.",
        steps: [
          "View your commission breakdown on the Commission Payouts page",
          "Commission rates vary by transaction type (cash-in: 0.5%, cash-out: 0.3%, etc.)",
          "Daily commissions are calculated during settlement",
          "Payouts are credited to your registered bank account",
          "View historical payouts and download statements",
        ],
      },
    ],
  },
  {
    id: "admin-analytics",
    title: "Admin Panel & Analytics Dashboard",
    description:
      "Master the admin panel features including real-time analytics, agent management, system monitoring, report generation, and platform configuration.",
    icon: Settings,
    difficulty: "advanced",
    duration: "20 min",
    tags: [
      "admin",
      "analytics",
      "dashboard",
      "monitoring",
      "reports",
      "management",
    ],
    prerequisites: ["Admin role", "Platform admin training"],
    relatedPages: [
      { label: "Admin Panel", path: "/admin" },
      { label: "Analytics Dashboard", path: "/admin-analytics" },
      { label: "System Health", path: "/system-health" },
    ],
    chapters: [
      {
        id: "admin-overview",
        title: "Admin Panel Overview",
        timestamp: "00:00",
        duration: "3 min",
        content:
          "The Admin Panel is the central management hub for platform administrators. It provides real-time visibility into all operations, agent performance, system health, and compliance status.",
        steps: [
          "Access the Admin Panel via the sidebar or the ⬡ button in the POS header",
          "The Overview tab shows key KPIs: transaction volume, active agents, fraud rate",
          "Use the sidebar tabs to navigate: Overview, Fraud, Audit, Analytics, Agents, Float",
          "Real-time data refreshes every 30 seconds",
        ],
        tips: ["Pin the Admin Panel as your default landing page in Settings"],
      },
      {
        id: "analytics-dashboard",
        title: "Analytics Dashboard Deep Dive",
        timestamp: "03:00",
        duration: "4 min",
        content:
          "The analytics dashboard provides comprehensive data visualization including transaction trends, agent performance comparisons, revenue breakdowns, and predictive insights.",
        steps: [
          "Navigate to the Analytics tab in Admin Panel",
          "Use date range pickers to filter data (today, this week, this month, custom)",
          "Transaction Volume chart shows daily/hourly trends",
          "Revenue Breakdown pie chart shows income by transaction type",
          "Agent Performance bar chart compares agent productivity",
          "Export any chart data as CSV for external analysis",
        ],
        tips: [
          "Compare week-over-week trends to identify growth patterns",
          "Use the CSV export for detailed Excel-based analysis",
        ],
      },
      {
        id: "agent-management",
        title: "Managing Agents",
        timestamp: "07:00",
        duration: "4 min",
        content:
          "The Agents tab provides full lifecycle management for field agents including onboarding, role assignment, performance monitoring, and account suspension.",
        steps: [
          "View all agents with their status, tier, float, and performance metrics",
          "Promote agents to admin role using the role dropdown",
          "Suspend/activate agents with the toggle switch",
          "View individual agent transaction history and performance",
          "Manage float top-up requests from the Float Requests tab",
          "Monitor agent KPI scores on the Agent Performance page",
        ],
      },
      {
        id: "system-monitoring",
        title: "System Health Monitoring",
        timestamp: "11:00",
        duration: "4 min",
        content:
          "The System Health page provides real-time monitoring of all platform services including API endpoints, database connections, external integrations, and infrastructure metrics.",
        steps: [
          "Navigate to System Health from the sidebar",
          "Green indicators: service healthy and responding normally",
          "Yellow indicators: degraded performance (response time > threshold)",
          "Red indicators: service down or unreachable",
          "Click any service to see detailed metrics and recent incidents",
          "Configure alert thresholds on the Threshold Manager page",
        ],
        tips: [
          "Set up SMS alerts for critical service outages",
          "Review system health daily during peak transaction hours",
        ],
      },
      {
        id: "report-generation",
        title: "Generating & Scheduling Reports",
        timestamp: "15:00",
        duration: "3 min",
        content:
          "The platform supports automated weekly reports, on-demand report generation, and scheduled email delivery to stakeholders.",
        steps: [
          "Navigate to Weekly Reports for automated summaries",
          "Use Report Comparison to compare any two report periods",
          "Schedule email delivery on the Scheduled Email Delivery page",
          "Configure recipients, frequency, and report format",
          "Download reports as PDF or CSV for offline use",
        ],
      },
      {
        id: "platform-config",
        title: "Platform Configuration",
        timestamp: "18:00",
        duration: "2 min",
        content:
          "Platform-wide settings control security policies, notification preferences, API rate limits, and integration configurations.",
        steps: [
          "Access Settings from the sidebar",
          "Configure notification channels and quiet hours",
          "Set API rate limits per endpoint on the Rate Limits page",
          "Manage webhook configurations for external integrations",
          "Review and update security policies regularly",
        ],
      },
    ],
  },
];

// ─── Progress Tracking ──────────────────────────────────────────────────────
function getProgress(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem("tutorial-progress") || "{}");
  } catch {
    return {};
  }
}

function saveProgress(tutorialId: string, chapterId: string) {
  const progress = getProgress();
  if (!progress[tutorialId]) progress[tutorialId] = [];
  if (!progress[tutorialId].includes(chapterId)) {
    progress[tutorialId].push(chapterId);
  }
  localStorage.setItem("tutorial-progress", JSON.stringify(progress));
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function VideoTutorials() {
  const [selectedTutorial, setSelectedTutorial] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [progress, setProgress] = useState(getProgress);
  const [, navigate] = useLocation();

  // Collect all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    tutorials.forEach(t => t.tags.forEach(tag => tags.add(tag)));
    return Array.from(tags).sort();
  }, []);

  const filteredTutorials = useMemo(() => {
    return tutorials.filter(t => {
      // Text search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesText =
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some(tag => tag.includes(q)) ||
          t.chapters.some(
            c =>
              c.title.toLowerCase().includes(q) ||
              c.content.toLowerCase().includes(q)
          );
        if (!matchesText) return false;
      }
      // Difficulty filter
      if (difficultyFilter !== "all" && t.difficulty !== difficultyFilter)
        return false;
      // Tag filter
      if (tagFilter !== "all" && !t.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [searchQuery, difficultyFilter, tagFilter]);

  const activeTutorial = tutorials.find(t => t.id === selectedTutorial);
  const activeChapter = activeTutorial?.chapters.find(
    c => c.id === selectedChapter
  );

  const handleMarkComplete = useCallback(
    (tutorialId: string, chapterId: string) => {
      saveProgress(tutorialId, chapterId);
      setProgress(getProgress());
    },
    []
  );

  const getTutorialProgress = (tutorialId: string) => {
    const completed = progress[tutorialId]?.length || 0;
    const total =
      tutorials.find(t => t.id === tutorialId)?.chapters.length || 1;
    return Math.round((completed / total) * 100);
  };

  const difficultyColors: Record<string, string> = {
    beginner: "text-green-400 border-green-500/30 bg-green-500/10",
    intermediate: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    advanced: "text-red-400 border-red-500/30 bg-red-500/10",
  };

  // ─── Tutorial Detail View ─────────────────────────────────────────────────
  if (activeTutorial) {
    return (
      <DashboardLayout>
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedTutorial(null);
              setSelectedChapter(null);
            }}
          >
            ← Back to Tutorials
          </Button>

          {/* Tutorial Header */}
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
              <activeTutorial.icon className="h-7 w-7 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{activeTutorial.title}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {activeTutorial.description}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <Badge
                  variant="outline"
                  className={difficultyColors[activeTutorial.difficulty]}
                >
                  {activeTutorial.difficulty}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {activeTutorial.duration}
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Layers className="h-3 w-3" />{" "}
                  {activeTutorial.chapters.length} chapters
                </span>
                <span className="text-xs text-primary font-medium">
                  {getTutorialProgress(activeTutorial.id)}% complete
                </span>
              </div>
            </div>
          </div>

          {/* Prerequisites */}
          {activeTutorial.prerequisites && (
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <p className="text-xs font-semibold text-amber-400 mb-1">
                Prerequisites
              </p>
              <ul className="space-y-0.5">
                {activeTutorial.prerequisites.map((p, i) => (
                  <li
                    key={i}
                    className="text-xs text-muted-foreground flex items-center gap-1.5"
                  >
                    <CheckCircle2 className="h-3 w-3 text-amber-400" /> {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Main Content: Chapters + Detail */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chapter List */}
            <div className="lg:col-span-1">
              <h3 className="text-sm font-semibold mb-3">Chapters</h3>
              <div className="space-y-1.5">
                {activeTutorial.chapters.map((chapter, idx) => {
                  const isComplete = progress[activeTutorial.id]?.includes(
                    chapter.id
                  );
                  const isActive = selectedChapter === chapter.id;

                  return (
                    <button
                      key={chapter.id}
                      onClick={() => setSelectedChapter(chapter.id)}
                      className={cn(
                        "w-full text-left p-3 rounded-lg border transition-colors",
                        isActive
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            "h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0",
                            isComplete
                              ? "bg-green-500 text-white"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {isComplete ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            idx + 1
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {chapter.title}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {chapter.timestamp} · {chapter.duration}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Related Pages */}
              <div className="mt-6">
                <h3 className="text-sm font-semibold mb-2">Related Pages</h3>
                <div className="space-y-1">
                  {activeTutorial.relatedPages.map(page => (
                    <button
                      key={page.path}
                      onClick={() => navigate(page.path)}
                      className="w-full text-left text-xs text-muted-foreground hover:text-primary flex items-center gap-1.5 py-1"
                    >
                      <ExternalLink className="h-3 w-3" /> {page.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Chapter Detail */}
            <div className="lg:col-span-2">
              {activeChapter ? (
                <div className="space-y-6">
                  {/* Video Player Placeholder */}
                  <div className="aspect-video rounded-xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(var(--primary-rgb,59,130,246),0.1),transparent_70%)]" />
                    <div className="relative z-10 text-center">
                      <div className="h-16 w-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-3">
                        <Play className="h-8 w-8 text-primary ml-1" />
                      </div>
                      <p className="text-sm font-semibold">
                        {activeChapter.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Chapter{" "}
                        {activeTutorial.chapters.indexOf(activeChapter) + 1} ·{" "}
                        {activeChapter.duration}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-2 max-w-xs mx-auto">
                        Video content will be available once the media library
                        is configured. Follow the step-by-step guide below.
                      </p>
                    </div>
                  </div>

                  {/* Chapter Content */}
                  <div>
                    <h2 className="text-lg font-semibold mb-2">
                      {activeChapter.title}
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {activeChapter.content}
                    </p>
                  </div>

                  {/* Steps */}
                  <div>
                    <h3 className="text-sm font-semibold mb-3">
                      Step-by-Step Guide
                    </h3>
                    <div className="space-y-2">
                      {activeChapter.steps.map((step, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-3 p-3 rounded-lg bg-muted/30"
                        >
                          <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0 mt-0.5">
                            {i + 1}
                          </div>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {step}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tips */}
                  {activeChapter.tips && activeChapter.tips.length > 0 && (
                    <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                      <h3 className="text-xs font-semibold text-primary mb-2 flex items-center gap-1.5">
                        <Star className="h-3.5 w-3.5" /> Pro Tips
                      </h3>
                      <ul className="space-y-1.5">
                        {activeChapter.tips.map((tip, i) => (
                          <li
                            key={i}
                            className="text-xs text-muted-foreground flex items-start gap-1.5"
                          >
                            <Target className="h-3 w-3 text-primary mt-0.5 flex-shrink-0" />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Mark Complete / Next Chapter */}
                  <div className="flex items-center gap-3 pt-2">
                    {!progress[activeTutorial.id]?.includes(
                      activeChapter.id
                    ) ? (
                      <Button
                        onClick={() =>
                          handleMarkComplete(
                            activeTutorial.id,
                            activeChapter.id
                          )
                        }
                        className="flex-1"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Mark as Complete
                      </Button>
                    ) : (
                      <Button variant="outline" className="flex-1" disabled>
                        <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />
                        Completed
                      </Button>
                    )}
                    {activeTutorial.chapters.indexOf(activeChapter) <
                      activeTutorial.chapters.length - 1 && (
                      <Button
                        variant="outline"
                        onClick={() => {
                          const nextIdx =
                            activeTutorial.chapters.indexOf(activeChapter) + 1;
                          setSelectedChapter(
                            activeTutorial.chapters[nextIdx].id
                          );
                        }}
                      >
                        Next Chapter <ArrowRight className="h-3.5 w-3.5 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-center py-20">
                  <Video className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    Select a chapter to begin
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() =>
                      setSelectedChapter(activeTutorial.chapters[0].id)
                    }
                  >
                    Start from Chapter 1
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // ─── Tutorial List View ───────────────────────────────────────────────────
  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Video className="h-6 w-6 text-primary" />
              Video Tutorials
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Step-by-step guides for the platform's most complex features
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Award className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              {Object.values(progress).reduce(
                (sum: any, arr: any) => sum + arr.length,
                0
              )}{" "}
              /{" "}
              {tutorials.reduce(
                (sum: any, t: any) => sum + t.chapters.length,
                0
              )}{" "}
              chapters completed
            </span>
          </div>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search tutorials, chapters, or topics..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <select
            value={difficultyFilter}
            onChange={e => setDifficultyFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Levels</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
          <select
            value={tagFilter}
            onChange={e => setTagFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All Topics</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>
                {tag.charAt(0).toUpperCase() + tag.slice(1)}
              </option>
            ))}
          </select>
          {(searchQuery ||
            difficultyFilter !== "all" ||
            tagFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchQuery("");
                setDifficultyFilter("all");
                setTagFilter("all");
              }}
            >
              <RotateCcw className="h-3 w-3 mr-1" /> Clear filters
            </Button>
          )}
        </div>

        {/* Tutorial Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTutorials.map(tutorial => {
            const Icon = tutorial.icon;
            const progressPct = getTutorialProgress(tutorial.id);

            return (
              <button
                key={tutorial.id}
                onClick={() => {
                  setSelectedTutorial(tutorial.id);
                  setSelectedChapter(null);
                }}
                className="text-left rounded-xl border border-border p-5 hover:border-primary/30 hover:bg-primary/5 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">
                      {tutorial.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {tutorial.description}
                    </p>
                    <div className="flex items-center gap-3 mt-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          difficultyColors[tutorial.difficulty]
                        )}
                      >
                        {tutorial.difficulty}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {tutorial.duration}
                      </span>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Layers className="h-3 w-3" />{" "}
                        {tutorial.chapters.length} chapters
                      </span>
                    </div>
                    {/* Progress Bar */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">
                          Progress
                        </span>
                        <span className="text-[10px] font-medium text-primary">
                          {progressPct}%
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {filteredTutorials.length === 0 && (
          <div className="text-center py-12">
            <Search className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No tutorials match your search
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
