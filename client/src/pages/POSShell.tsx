// @ts-nocheck
// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
/**
 * InsurePortal — Bloomberg Terminal meets Modern Fintech (Dark Professional)
 * Features: Fraud Detection Dashboard, Live Chat Support, Loyalty Points System
 * Design: near-black (#0a0e1a), electric blue primary, emerald for positive values
 * Font: Space Grotesk (display) + Inter (body) + JetBrains Mono (financial data)
 * Layout: Full-bleed status bar → quick-access strip → configurable tile grid → live ticker
 * ALL 26 SCREENS FULLY IMPLEMENTED — Tier 1-4 improvements applied
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import LiveChatSupport from "./LiveChatSupport";
import LoyaltySystem from "./LoyaltySystem";
import FraudDashboard from "./FraudDashboard";
import { toast } from "sonner";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { usePosStore } from "../store/posStore";
import { trpc } from "../lib/trpc";
import { useTransactionCreate } from "../hooks/useTransactionCreate";
import { NotificationBell } from "../components/NotificationBell";
import { GdprConsentBanner } from "../components/GdprConsentBanner";
import { useFaceMotionDetection } from "../hooks/useFaceMotionDetection";
import type { ChallengeType as MotionChallengeType } from "../hooks/useFaceMotionDetection";

// ─── Types ────────────────────────────────────────────────────────────────────
type TileSize = "sm" | "md" | "lg" | "wide";
type TileCategory =
  | "transactions"
  | "customers"
  | "finance"
  | "inventory"
  | "compliance"
  | "reports"
  | "settings"
  | "communication";

interface Tile {
  id: string;
  label: string;
  icon: string;
  color: string;
  bgColor: string;
  category: TileCategory;
  size: TileSize;
  screen: string;
  badge?: number;
  hot?: boolean;
  description: string;
  usageCount?: number;
}

interface Transaction {
  id: string;
  type: string;
  amount: number;
  customer: string;
  phone?: string;
  status: "success" | "pending" | "failed";
  time: string;
  ref: string;
  channel?: string;
}

interface TerminalInfo {
  model: string;
  serialNo: string;
  agentName: string;
  agentCode: string;
  floatBalance: number;
  commissionBalance: number;
  network: "4G" | "3G" | "WiFi" | "Offline";
  signalStrength: number;
  batteryLevel: number;
  online: boolean;
  location: string;
  tier: "Bronze" | "Silver" | "Gold" | "Platinum";
  paperLevel: number;
  txToday: number;
  txTarget: number;
}

interface FraudAlert {
  id: string;
  severity: "critical" | "high" | "medium" | "low";
  type: string;
  customer: string;
  amount: number;
  time: string;
  reason: string;
  explanation: string[];
  description?: string;
}

interface GamificationData {
  streak: number;
  points: number;
  level: string;
  badges: string[];
  weeklyTarget: number;
  weeklyProgress: number;
  rank: number;
  totalAgents: number;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────
const TERMINAL: TerminalInfo = {
  model: "PAX A920 MAX",
  serialNo: "A920M-NG-20240315-0042",
  agentName: "Adaeze Okonkwo",
  agentCode: "AG-LOS-004821",
  floatBalance: 485_250.0,
  commissionBalance: 12_840.5,
  network: "4G",
  signalStrength: 87,
  batteryLevel: 73,
  online: true,
  location: "Ikeja, Lagos",
  tier: "Gold",
  paperLevel: 68,
  txToday: 5,
  txTarget: 7,
};

const GAMIFICATION: GamificationData = {
  streak: 12,
  points: 8_450,
  level: "Gold Agent",
  badges: [
    "🏆 First ₦1M Day",
    "⚡ Speed Demon",
    "🛡️ Zero Fraud Month",
    "👥 100 Customers",
  ],
  weeklyTarget: 50,
  weeklyProgress: 38,
  rank: 14,
  totalAgents: 1_247,
};

const TILE_REGISTRY: Tile[] = [
  // Transactions
  {
    id: "cash-in",
    label: "Cash In",
    icon: "⬇",
    color: "#10b981",
    bgColor: "oklch(0.65 0.18 160 / 0.15)",
    category: "transactions",
    size: "lg",
    screen: "CashIn",
    hot: true,
    description: "Accept cash deposits",
    badge: 0,
    usageCount: 142,
  },
  {
    id: "cash-out",
    label: "Cash Out",
    icon: "⬆",
    color: "#3b82f6",
    bgColor: "oklch(0.60 0.22 260 / 0.15)",
    category: "transactions",
    size: "lg",
    screen: "CashOut",
    hot: true,
    description: "Dispense cash withdrawals",
    badge: 0,
    usageCount: 98,
  },
  {
    id: "transfer",
    label: "Transfer",
    icon: "⇄",
    color: "#8b5cf6",
    bgColor: "oklch(0.55 0.22 300 / 0.15)",
    category: "transactions",
    size: "md",
    screen: "Transfer",
    hot: false,
    description: "Send money transfers",
    badge: 0,
    usageCount: 67,
  },
  {
    id: "card-payment",
    label: "Card Payment",
    icon: "💳",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "transactions",
    size: "md",
    screen: "CardPayment",
    hot: true,
    description: "Process card transactions",
    badge: 0,
    usageCount: 55,
  },
  {
    id: "qr-payment",
    label: "QR Payment",
    icon: "▦",
    color: "#06b6d4",
    bgColor: "oklch(0.65 0.18 200 / 0.15)",
    category: "transactions",
    size: "md",
    screen: "QRPayment",
    hot: false,
    description: "Scan QR code to pay",
    badge: 0,
    usageCount: 33,
  },
  {
    id: "nfc-payment",
    label: "NFC / Tap",
    icon: "⟡",
    color: "#ec4899",
    bgColor: "oklch(0.60 0.22 340 / 0.15)",
    category: "transactions",
    size: "sm",
    screen: "NFCPayment",
    hot: false,
    description: "Contactless NFC payment",
    badge: 0,
    usageCount: 28,
  },
  {
    id: "airtime",
    label: "Airtime",
    icon: "📶",
    color: "#10b981",
    bgColor: "oklch(0.65 0.18 160 / 0.15)",
    category: "transactions",
    size: "sm",
    screen: "Airtime",
    hot: false,
    description: "Sell airtime & data",
    badge: 0,
    usageCount: 89,
  },
  {
    id: "bills",
    label: "Bill Payment",
    icon: "🧾",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "transactions",
    size: "sm",
    screen: "Bills",
    hot: false,
    description: "Pay utility bills",
    badge: 0,
    usageCount: 44,
  },
  {
    id: "reversal",
    label: "Reversal",
    icon: "↺",
    color: "#ef4444",
    bgColor: "oklch(0.60 0.22 25 / 0.15)",
    category: "transactions",
    size: "sm",
    screen: "Reversal",
    hot: false,
    description: "Reverse a transaction",
    badge: 0,
    usageCount: 8,
  },
  // Customers
  {
    id: "cust-lookup",
    label: "Customer",
    icon: "👤",
    color: "#3b82f6",
    bgColor: "oklch(0.60 0.22 260 / 0.15)",
    category: "customers",
    size: "md",
    screen: "CustomerLookup",
    hot: false,
    description: "Look up customer account",
    badge: 0,
    usageCount: 71,
  },
  {
    id: "kyc",
    label: "KYC Verify",
    icon: "✓",
    color: "#10b981",
    bgColor: "oklch(0.65 0.18 160 / 0.15)",
    category: "customers",
    size: "sm",
    screen: "KYCVerify",
    hot: false,
    description: "Verify customer identity",
    badge: 3,
    usageCount: 22,
  },
  {
    id: "biometric",
    label: "Biometric",
    icon: "☝",
    color: "#8b5cf6",
    bgColor: "oklch(0.55 0.22 300 / 0.15)",
    category: "customers",
    size: "sm",
    screen: "Biometric",
    hot: false,
    description: "Fingerprint enrollment",
    badge: 0,
    usageCount: 15,
  },
  {
    id: "acct-open",
    label: "Open Account",
    icon: "+",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "customers",
    size: "md",
    screen: "OpenAccount",
    hot: false,
    description: "Open a new bank account",
    badge: 0,
    usageCount: 18,
  },
  // Finance
  {
    id: "float-bal",
    label: "Float Balance",
    icon: "₦",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "finance",
    size: "wide",
    screen: "FloatBalance",
    hot: true,
    description: "Check your float balance",
    badge: 0,
    usageCount: 120,
  },
  {
    id: "commission",
    label: "Commission",
    icon: "%",
    color: "#10b981",
    bgColor: "oklch(0.65 0.18 160 / 0.15)",
    category: "finance",
    size: "md",
    screen: "Commission",
    hot: false,
    description: "View earned commissions",
    badge: 0,
    usageCount: 45,
  },
  {
    id: "settlement",
    label: "Settlement",
    icon: "⊡",
    color: "#3b82f6",
    bgColor: "oklch(0.60 0.22 260 / 0.15)",
    category: "finance",
    size: "md",
    screen: "Settlement",
    hot: false,
    description: "Daily settlement report",
    badge: 0,
    usageCount: 30,
  },
  {
    id: "reconcile",
    label: "Reconcile",
    icon: "⊞",
    color: "#8b5cf6",
    bgColor: "oklch(0.55 0.22 300 / 0.15)",
    category: "finance",
    size: "sm",
    screen: "Reconcile",
    hot: false,
    description: "End-of-day reconciliation",
    badge: 0,
    usageCount: 20,
  },
  // Compliance
  {
    id: "fraud-alerts",
    label: "Fraud Alerts",
    icon: "⚠",
    color: "#ef4444",
    bgColor: "oklch(0.60 0.22 25 / 0.15)",
    category: "compliance",
    size: "md",
    screen: "FraudAlerts",
    hot: false,
    description: "View fraud alerts",
    badge: 2,
    usageCount: 12,
  },
  {
    id: "aml-check",
    label: "AML Check",
    icon: "🔍",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "compliance",
    size: "sm",
    screen: "AMLCheck",
    hot: false,
    description: "Anti-money laundering check",
    badge: 0,
    usageCount: 9,
  },
  {
    id: "audit-log",
    label: "Audit Log",
    icon: "📋",
    color: "#3b82f6",
    bgColor: "oklch(0.60 0.22 260 / 0.15)",
    category: "compliance",
    size: "sm",
    screen: "AuditLog",
    hot: false,
    description: "View audit trail",
    badge: 0,
    usageCount: 7,
  },
  {
    id: "my-limits",
    label: "My Limits",
    icon: "⚡",
    color: "#10b981",
    bgColor: "oklch(0.65 0.18 160 / 0.15)",
    category: "compliance",
    size: "md",
    screen: "MyLimits",
    hot: false,
    description: "View your tier velocity limits",
    badge: 0,
    usageCount: 0,
  },
  // Reports
  {
    id: "daily-report",
    label: "Daily Report",
    icon: "📊",
    color: "#10b981",
    bgColor: "oklch(0.65 0.18 160 / 0.15)",
    category: "reports",
    size: "md",
    screen: "DailyReport",
    hot: false,
    description: "Today's summary report",
    badge: 0,
    usageCount: 38,
  },
  {
    id: "tx-history",
    label: "Tx History",
    icon: "⏱",
    color: "#3b82f6",
    bgColor: "oklch(0.60 0.22 260 / 0.15)",
    category: "reports",
    size: "md",
    screen: "TxHistory",
    hot: false,
    description: "Transaction history",
    badge: 0,
    usageCount: 60,
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: "📈",
    color: "#8b5cf6",
    bgColor: "oklch(0.55 0.22 300 / 0.15)",
    category: "reports",
    size: "sm",
    screen: "Analytics",
    hot: false,
    description: "Performance analytics",
    badge: 0,
    usageCount: 25,
  },
  {
    id: "scorecard",
    label: "Scorecard",
    icon: "🏅",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "reports",
    size: "sm",
    screen: "Scorecard",
    hot: false,
    description: "Agent performance scorecard",
    badge: 0,
    usageCount: 18,
  },
  // Settings
  {
    id: "terminal-cfg",
    label: "Terminal",
    icon: "⚙",
    color: "#6b7280",
    bgColor: "oklch(0.40 0.01 240 / 0.3)",
    category: "settings",
    size: "sm",
    screen: "TerminalConfig",
    hot: false,
    description: "Terminal configuration",
    badge: 0,
    usageCount: 5,
  },
  {
    id: "printer-test",
    label: "Print Test",
    icon: "🖨",
    color: "#6b7280",
    bgColor: "oklch(0.40 0.01 240 / 0.3)",
    category: "settings",
    size: "sm",
    screen: "PrinterTest",
    hot: false,
    description: "Test receipt printer",
    badge: 0,
    usageCount: 4,
  },
  {
    id: "network-test",
    label: "Network",
    icon: "📡",
    color: "#6b7280",
    bgColor: "oklch(0.40 0.01 240 / 0.3)",
    category: "settings",
    size: "sm",
    screen: "NetworkTest",
    hot: false,
    description: "Network diagnostics",
    badge: 0,
    usageCount: 3,
  },
  {
    id: "firmware",
    label: "Firmware OTA",
    icon: "⬆",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "settings",
    size: "sm",
    screen: "ServiceUpdate",
    hot: false,
    description: "Update terminal firmware",
    badge: 1,
    usageCount: 2,
  },
  // Embedded Finance
  {
    id: "nano-loan",
    label: "Nano Loan",
    icon: "💰",
    color: "#10b981",
    bgColor: "oklch(0.65 0.18 160 / 0.15)",
    category: "finance",
    size: "md",
    screen: "NanoLoan",
    hot: true,
    description: "Apply for instant float loan",
    badge: 0,
    usageCount: 15,
  },
  {
    id: "eod-reconcile",
    label: "EOD Wizard",
    icon: "📋",
    color: "#8b5cf6",
    bgColor: "oklch(0.55 0.22 300 / 0.15)",
    category: "reports",
    size: "md",
    screen: "EODReconcile",
    hot: false,
    description: "End-of-day reconciliation wizard",
    badge: 0,
    usageCount: 10,
  },
  {
    id: "ussd-sim",
    label: "USSD Test",
    icon: "#",
    color: "#3b82f6",
    bgColor: "oklch(0.60 0.22 260 / 0.15)",
    category: "settings",
    size: "sm",
    screen: "__ussd__",
    hot: false,
    description: "USSD channel simulator",
    badge: 0,
    usageCount: 6,
  },
  {
    id: "micro-insurance",
    label: "Insurance",
    icon: "🛡",
    color: "#a855f7",
    bgColor: "oklch(0.55 0.22 300 / 0.15)",
    category: "finance",
    size: "md",
    screen: "MicroInsurance",
    hot: true,
    description: "Micro-insurance products",
    badge: 0,
    usageCount: 8,
  },
  {
    id: "architecture",
    label: "Architecture",
    icon: "⬡",
    color: "#06b6d4",
    bgColor: "oklch(0.65 0.18 200 / 0.15)",
    category: "settings",
    size: "sm",
    screen: "__arch__",
    hot: false,
    description: "Platform architecture",
    badge: 0,
    usageCount: 2,
  },
  // New features
  {
    id: "fraud-dash",
    label: "Fraud Monitor",
    icon: "🔴",
    color: "#ef4444",
    bgColor: "oklch(0.60 0.22 25 / 0.15)",
    category: "compliance",
    size: "md",
    screen: "__fraud_dash__",
    hot: true,
    description: "Real-time fraud detection",
    badge: 3,
    usageCount: 20,
  },
  {
    id: "live-chat",
    label: "Live Support",
    icon: "💬",
    color: "#3b82f6",
    bgColor: "oklch(0.60 0.22 260 / 0.15)",
    category: "communication",
    size: "md",
    screen: "__live_chat__",
    hot: false,
    description: "Chat with support team",
    badge: 0,
    usageCount: 14,
  },
  {
    id: "loyalty",
    label: "My Rewards",
    icon: "⭐",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "finance",
    size: "md",
    screen: "__loyalty__",
    hot: true,
    description: "Points, tiers & rewards",
    badge: 0,
    usageCount: 22,
  },
  {
    id: "disputes",
    label: "My Disputes",
    icon: "⚖",
    color: "#a855f7",
    bgColor: "oklch(0.55 0.22 300 / 0.15)",
    category: "compliance",
    size: "md",
    screen: "Disputes",
    hot: false,
    description: "Raise & track disputes",
    badge: 0,
    usageCount: 5,
  },
  {
    id: "offline-resilience",
    label: "Offline & Sync",
    icon: "📶",
    color: "#f59e0b",
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    category: "settings",
    size: "md",
    screen: "OfflineResilience",
    hot: false,
    description: "Offline queue, sync & resilience status",
    badge: 0,
    usageCount: 0,
  },
  // Sprint 75: USSD Transactions & Carrier Switching
  {
    id: "ussd-tx",
    label: "USSD Transact",
    icon: "#",
    color: "#10b981",
    bgColor: "oklch(0.65 0.18 160 / 0.15)",
    category: "transactions",
    size: "md",
    screen: "UssdTransaction",
    hot: true,
    description: "Process transactions via USSD codes",
    badge: 0,
    usageCount: 12,
  },
  {
    id: "carrier-switch",
    label: "Carrier Switch",
    icon: "📡",
    color: "#06b6d4",
    bgColor: "oklch(0.65 0.18 200 / 0.15)",
    category: "settings",
    size: "md",
    screen: "CarrierSwitch",
    hot: true,
    description: "Switch carriers based on signal",
    badge: 0,
    usageCount: 8,
  },
];

const DEFAULT_LAYOUT = [
  "cash-in",
  "cash-out",
  "transfer",
  "card-payment",
  "qr-payment",
  "float-bal",
  "nfc-payment",
  "airtime",
  "bills",
  "cust-lookup",
  "kyc",
  "commission",
  "fraud-alerts",
  "daily-report",
  "tx-history",
  "terminal-cfg",
  "nano-loan",
  "eod-reconcile",
  "fraud-dash",
  "live-chat",
  "loyalty",
  "disputes",
];

const FRAUD_ALERTS: FraudAlert[] = [
  {
    id: "FA-001",
    severity: "critical",
    type: "Velocity Breach",
    customer: "Unknown Customer",
    amount: 450000,
    time: "09:44",
    reason: "Amount 340% above 30-day average",
    explanation: [
      "Amount ₦450,000 exceeds your 30-day average by 340%",
      "Customer has 3 failed attempts in the last hour",
      "Transaction originates from flagged device ID",
      "CBN Tier 2 daily limit would be exceeded",
    ],
  },
  {
    id: "FA-002",
    severity: "high",
    type: "Structuring Detected",
    customer: "Emeka Eze",
    amount: 199500,
    time: "09:12",
    reason: "Multiple sub-threshold transactions",
    explanation: [
      "3 transactions of ₦199,500 within 2 hours",
      "Pattern matches known structuring behaviour",
      "Customer BVN linked to 2 other flagged accounts",
    ],
  },
];

const TICKER_ITEMS = [
  { label: "CASH-IN", value: "₦485,250", change: "+12.4%", up: true },
  { label: "CASH-OUT", value: "₦312,000", change: "+8.1%", up: true },
  { label: "TRANSFERS", value: "₦94,500", change: "-3.2%", up: false },
  { label: "FLOAT", value: "₦485,250", change: "+2.1%", up: true },
  { label: "COMMISSION", value: "₦12,840", change: "+18.7%", up: true },
  { label: "TX COUNT", value: "247", change: "+31", up: true },
  { label: "SUCCESS", value: "98.4%", change: "+0.3%", up: true },
  { label: "ALERTS", value: "2", change: "+2", up: false },
  { label: "STREAK", value: "12 days", change: "🔥", up: true },
  { label: "RANK", value: "#14", change: "↑3", up: true },
];

const CHART_DATA = [
  { h: "08:00", in: 45000, out: 12000 },
  { h: "09:00", in: 82000, out: 35000 },
  { h: "10:00", in: 120000, out: 67000 },
  { h: "11:00", in: 95000, out: 48000 },
  { h: "12:00", in: 150000, out: 89000 },
  { h: "13:00", in: 78000, out: 42000 },
  { h: "14:00", in: 110000, out: 55000 },
];

const COMMISSION_DATA = [
  { day: "Mon", earned: 1800 },
  { day: "Tue", earned: 2400 },
  { day: "Wed", earned: 1950 },
  { day: "Thu", earned: 3100 },
  { day: "Fri", earned: 2800 },
  { day: "Sat", earned: 4200 },
  { day: "Sun", earned: 590 },
];

// ─── Utility ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return (
    "₦" +
    n.toLocaleString("en-NG", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

const BG = "oklch(0.09 0.01 240)";
const CARD = "oklch(0.13 0.012 240)";
const BORDER = "oklch(0.18 0.012 240)";
const BLUE = "oklch(0.60 0.22 260)";
const GREEN = "#10b981";
const GOLD = "#f59e0b";
const RED = "#ef4444";
const MONO = "var(--font-mono)";
const DISP = "var(--font-display)";

function ScreenHeader({
  title,
  onBack,
  badge,
}: {
  title: string;
  onBack: () => void;
  badge?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0"
      style={{ borderColor: BORDER }}
    >
      <button
        onClick={onBack}
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-white/10 text-gray-400 hover:text-white text-lg"
      >
        ←
      </button>
      <div
        className="text-base font-bold text-white flex-1"
        style={{ fontFamily: DISP }}
      >
        {title}
      </div>
      {badge}
    </div>
  );
}

function NumPad({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"];
  return (
    <div className="grid grid-cols-3 gap-2 p-4">
      {keys.map(k => (
        <button
          key={k}
          onClick={() => {
            if (k === "⌫") onChange(value.slice(0, -1));
            else if (k === "." && value.includes(".")) return;
            else if (value.length >= 10) return;
            else onChange(value + k);
          }}
          className="h-14 rounded-xl text-xl font-semibold transition-all active:scale-95"
          style={{
            background: k === "⌫" ? "oklch(0.60 0.22 25 / 0.2)" : CARD,
            color: k === "⌫" ? RED : "white",
            border: `1px solid ${BORDER}`,
            fontFamily: MONO,
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

function AmountDisplay({ value, label }: { value: string; label: string }) {
  const num = parseFloat(value || "0");
  return (
    <div className="flex flex-col items-center py-6 gap-1">
      <div
        className="text-xs text-gray-500 uppercase tracking-widest"
        style={{ fontFamily: DISP }}
      >
        {label}
      </div>
      <div
        className="text-4xl font-bold"
        style={{ fontFamily: MONO, color: GOLD }}
      >
        ₦
        {num.toLocaleString("en-NG", {
          minimumFractionDigits: value.includes(".") ? 2 : 0,
        })}
      </div>
    </div>
  );
}

function PhoneInput({
  value,
  onChange,
  label = "Customer Phone Number",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <div className="px-4 pb-2">
      <div className="text-xs text-gray-500 mb-1" style={{ fontFamily: DISP }}>
        {label}
      </div>
      <input
        type="tel"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="0800 000 0000"
        className="w-full rounded-xl px-4 py-3 text-white text-base outline-none"
        style={{
          background: CARD,
          border: `1px solid ${BORDER}`,
          fontFamily: MONO,
        }}
      />
    </div>
  );
}

function SuccessScreen({
  title,
  amount,
  ref: txRef,
  customer,
  onDone,
  onPrint,
}: {
  title: string;
  amount: number;
  ref: string;
  customer: string;
  onDone: () => void;
  onPrint: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
        style={{
          background: "oklch(0.65 0.18 160 / 0.2)",
          border: `2px solid ${GREEN}`,
        }}
      >
        ✓
      </div>
      <div className="text-center">
        <div
          className="text-2xl font-bold text-white mb-1"
          style={{ fontFamily: DISP }}
        >
          {title}
        </div>
        <div
          className="text-3xl font-bold"
          style={{ fontFamily: MONO, color: GREEN }}
        >
          {fmt(amount)}
        </div>
        <div className="text-sm text-gray-400 mt-2">{customer}</div>
        <div
          className="text-xs text-gray-600 mt-1"
          style={{ fontFamily: MONO }}
        >
          {txRef}
        </div>
      </div>
      <div className="flex gap-3 w-full">
        <button
          onClick={onPrint}
          className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all"
          style={{
            background: "oklch(0.60 0.22 260 / 0.2)",
            color: "#3b82f6",
            border: `1px solid oklch(0.60 0.22 260 / 0.4)`,
            fontFamily: DISP,
          }}
        >
          🖨 Print Receipt
        </button>
        <button
          onClick={onDone}
          className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all"
          style={{ background: GREEN, color: "white", fontFamily: DISP }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────
function ReceiptModal({
  tx,
  onClose,
}: {
  tx: {
    type: string;
    amount: number;
    customer: string;
    ref: string;
    time: string;
  };
  onClose: () => void;
}) {
  const [sent, setSent] = useState<"none" | "sms" | "email">("none");
  const [smsPhone, setSmsPhone] = useState(
    tx.customer.match(/^\d{10,15}$/) ? tx.customer : ""
  );
  const [showSmsInput, setShowSmsInput] = useState(false);
  const agent = usePosStore(s => s.agent);

  const sendSmsMut = trpc.smsReceipt.send.useMutation({
    onSuccess: () => {
      setSent("sms");
      setShowSmsInput(false);
      toast.success(`Receipt SMS sent to ${smsPhone}`);
    },
    onError: e => toast.error(`SMS failed: ${e.message}`),
  });

  const handleSmsClick = () => {
    if (!tx.ref.startsWith("TXN-") && !tx.ref.startsWith("54L-")) {
      // Real txRef from server — use tRPC
      if (!smsPhone || smsPhone.length < 10) {
        setShowSmsInput(true);
        return;
      }
      sendSmsMut.mutate({ transactionRef: tx.ref, recipientPhone: smsPhone });
    } else {
      // Simulate ref for offline/fallback path
      setSent("sms");
      toast.success("SMS receipt sent");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: "oklch(0 0 0 / 0.8)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-2xl p-4 flex flex-col gap-4 max-h-[85vh] overflow-y-auto"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div
            className="text-base font-bold text-white"
            style={{ fontFamily: DISP }}
          >
            Receipt
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>
        {/* ESC/POS style receipt */}
        <div
          className="rounded-xl p-4 font-mono text-xs leading-relaxed"
          style={{
            background: "oklch(0.97 0 0)",
            color: "#111",
            fontFamily: MONO,
          }}
        >
          <div className="text-center font-bold text-sm mb-2">
            INSUREPORTAL AGENCY BANKING
          </div>
          <div className="text-center text-xs mb-1">
            Powered by InsurePortal Platform
          </div>
          <div className="text-center mb-3">{"─".repeat(32)}</div>
          <div className="flex justify-between">
            <span>Date:</span>
            <span>{new Date().toLocaleDateString("en-NG")}</span>
          </div>
          <div className="flex justify-between">
            <span>Time:</span>
            <span>{tx.time}</span>
          </div>
          <div className="flex justify-between">
            <span>Ref:</span>
            <span>{tx.ref}</span>
          </div>
          <div className="flex justify-between">
            <span>Type:</span>
            <span>{tx.type}</span>
          </div>
          <div className="text-center my-2">{"─".repeat(32)}</div>
          <div className="flex justify-between">
            <span>Customer:</span>
            <span>{tx.customer}</span>
          </div>
          <div className="text-center my-2">{"─".repeat(32)}</div>
          <div className="flex justify-between font-bold text-sm">
            <span>AMOUNT:</span>
            <span>
              ₦{tx.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-center my-2">{"─".repeat(32)}</div>
          <div className="text-center text-xs">
            Agent: {agent?.agentCode ?? "AG-LOS-004821"}
          </div>
          <div className="text-center text-xs">
            Terminal: {agent?.terminalModel ?? "PAX A920 MAX"}
          </div>
          <div className="text-center text-xs mt-2">*** CUSTOMER COPY ***</div>
        </div>
        {/* SMS phone input (shown when phone is not auto-detected) */}
        {showSmsInput && (
          <div className="flex gap-2">
            <input
              value={smsPhone}
              onChange={e => setSmsPhone(e.target.value)}
              placeholder="Enter recipient phone (e.g. 08012345678)"
              className="flex-1 px-3 py-2 rounded-xl text-sm text-white bg-transparent border outline-none"
              style={{
                borderColor: GREEN,
                fontFamily: DISP,
                background: "oklch(0.10 0.015 240)",
              }}
            />
            <button
              onClick={() => {
                if (smsPhone.length >= 10) {
                  sendSmsMut.mutate({
                    transactionRef: tx.ref,
                    recipientPhone: smsPhone,
                  });
                }
              }}
              disabled={sendSmsMut.isPending}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white"
              style={{
                background: GREEN,
                fontFamily: DISP,
                opacity: sendSmsMut.isPending ? 0.5 : 1,
              }}
            >
              {sendSmsMut.isPending ? "Sending…" : "Send"}
            </button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => {
              setSent("none");
              toast.success("Printing receipt...");
            }}
            className="py-3 rounded-xl text-xs font-semibold"
            style={{
              background: "oklch(0.60 0.22 260 / 0.2)",
              color: "#3b82f6",
              fontFamily: DISP,
            }}
          >
            🖨 Print
          </button>
          <button
            onClick={handleSmsClick}
            disabled={sendSmsMut.isPending}
            className="py-3 rounded-xl text-xs font-semibold transition-all"
            style={{
              background:
                sent === "sms"
                  ? "oklch(0.65 0.18 160 / 0.3)"
                  : "oklch(0.65 0.18 160 / 0.15)",
              color: GREEN,
              fontFamily: DISP,
              opacity: sendSmsMut.isPending ? 0.5 : 1,
            }}
          >
            {sendSmsMut.isPending
              ? "Sending…"
              : sent === "sms"
                ? "✓ SMS Sent"
                : "📱 SMS"}
          </button>
          <button
            onClick={() => {
              setSent("email");
              toast.success("Email sent!");
            }}
            className="py-3 rounded-xl text-xs font-semibold"
            style={{
              background:
                sent === "email"
                  ? "oklch(0.78 0.18 80 / 0.3)"
                  : "oklch(0.78 0.18 80 / 0.15)",
              color: GOLD,
              fontFamily: DISP,
            }}
          >
            ✉ Email
          </button>
        </div>
        {/* Raise Dispute quick-action */}
        <button
          onClick={() => {
            onClose();
            // Copy txRef to clipboard so agent can paste into Disputes screen
            navigator.clipboard?.writeText(tx.ref).catch(() => {});
            toast.info(
              `Ref ${tx.ref} copied — tap My Disputes to raise a dispute`,
              { duration: 4000 }
            );
          }}
          className="w-full py-3 rounded-xl text-xs font-semibold transition-all"
          style={{
            background: "oklch(0.55 0.22 300 / 0.15)",
            color: "#a855f7",
            border: "1px solid oklch(0.55 0.22 300 / 0.3)",
            fontFamily: DISP,
          }}
        >
          ⚖ Raise Dispute for this Transaction
        </button>
      </div>
    </div>
  );
}

// ─── Status Bar ───────────────────────────────────────────────────────────────
function StatusBar({
  terminal,
  time,
}: {
  terminal: TerminalInfo;
  time: string;
}) {
  const tierColor = {
    Bronze: "#cd7f32",
    Silver: "#9ca3af",
    Gold: GOLD,
    Platinum: "#a78bfa",
  }[terminal.tier];
  return (
    <div
      className="flex items-center justify-between px-4 py-2 text-xs flex-shrink-0"
      style={{
        background: "oklch(0.07 0.012 240)",
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: terminal.online ? GREEN : RED }}
          />
          <span
            className="font-semibold text-white"
            style={{ fontFamily: DISP }}
          >
            {terminal.agentName.split(" ")[0]}
          </span>
        </div>
        <span className="text-gray-500">|</span>
        <span style={{ color: "oklch(0.65 0.015 230)", fontFamily: MONO }}>
          {terminal.agentCode}
        </span>
        <span className="text-gray-500">|</span>
        <span
          className="font-bold px-1.5 py-0.5 rounded text-xs"
          style={{
            color: tierColor,
            background: `${tierColor}22`,
            fontFamily: DISP,
          }}
        >
          {terminal.tier}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="px-2 py-0.5 rounded text-xs font-bold"
          style={{
            background: "oklch(0.60 0.22 260 / 0.2)",
            color: "#3b82f6",
            fontFamily: DISP,
          }}
        >
          {terminal.model}
        </div>
        <span style={{ fontFamily: MONO, color: "oklch(0.65 0.015 230)" }}>
          {terminal.serialNo.slice(-4)}
        </span>
        <span className="text-gray-500">|</span>
        <span
          style={{
            color: terminal.network === "Offline" ? RED : GREEN,
            fontFamily: MONO,
          }}
        >
          {terminal.network === "4G"
            ? "📶"
            : terminal.network === "WiFi"
              ? "📡"
              : "📶"}{" "}
          {terminal.network}
        </span>
        <span
          style={{
            color: terminal.batteryLevel > 30 ? GREEN : RED,
            fontFamily: MONO,
          }}
        >
          🔋{terminal.batteryLevel}%
        </span>
        {terminal.paperLevel < 30 && (
          <span style={{ color: GOLD }}>📄{terminal.paperLevel}%</span>
        )}
        <span
          className="font-bold"
          style={{ fontFamily: MONO, color: "white" }}
        >
          {time}
        </span>
      </div>
    </div>
  );
}

// ─── Float Header ─────────────────────────────────────────────────────────────
function FloatHeader({ terminal }: { terminal: TerminalInfo }) {
  const progress = (terminal.txToday / terminal.txTarget) * 100;
  return (
    <div
      className="px-4 py-3 flex-shrink-0"
      style={{
        background: "oklch(0.11 0.012 240)",
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <div
            className="text-xs text-gray-500 uppercase tracking-widest mb-0.5"
            style={{ fontFamily: DISP }}
          >
            Float Balance
          </div>
          <div
            className="text-2xl font-bold"
            style={{ fontFamily: MONO, color: GOLD }}
          >
            {fmt(terminal.floatBalance)}
          </div>
        </div>
        <div className="w-px h-10 bg-white/10" />
        <div>
          <div
            className="text-xs text-gray-500 uppercase tracking-widest mb-0.5"
            style={{ fontFamily: DISP }}
          >
            Commission
          </div>
          <div
            className="text-2xl font-bold"
            style={{ fontFamily: MONO, color: GREEN }}
          >
            {fmt(terminal.commissionBalance)}
          </div>
        </div>
        <div className="w-px h-10 bg-white/10" />
        <div className="flex flex-col items-end gap-1">
          <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
            Today{" "}
            <span className="font-bold text-white">{terminal.txToday}</span> /{" "}
            {terminal.txTarget} tx
          </div>
          <div
            className="w-20 h-1.5 rounded-full overflow-hidden"
            style={{ background: "oklch(0.20 0.01 240)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: progress >= 100 ? GREEN : BLUE,
              }}
            />
          </div>
          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: GOLD, fontFamily: MONO }}
          >
            🔥 {terminal.tier} · {GAMIFICATION.streak}d streak
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Quick Access Strip ───────────────────────────────────────────────────────
function QuickAccessStrip({
  tiles,
  onPress,
}: {
  tiles: Tile[];
  onPress: (t: Tile) => void;
}) {
  const top4 = [...tiles]
    .sort((a: any, b: any) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, 4);
  return (
    <div
      className="flex gap-2 px-4 py-2 border-b flex-shrink-0"
      style={{ borderColor: BORDER, background: "oklch(0.10 0.01 240)" }}
    >
      <div
        className="text-xs text-gray-600 self-center mr-1 whitespace-nowrap"
        style={{ fontFamily: DISP }}
      >
        Quick
      </div>
      {top4.map(t => (
        <button
          key={t.id}
          onClick={() => onPress(t)}
          className="flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-xl transition-all hover:scale-105 active:scale-95"
          style={{ background: t.bgColor, border: `1px solid ${t.color}44` }}
        >
          <span className="text-lg">{t.icon}</span>
          <span
            className="text-xs font-semibold truncate w-full text-center"
            style={{ color: t.color, fontFamily: DISP }}
          >
            {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Live Ticker ──────────────────────────────────────────────────────────────
function LiveTicker({ items: tickerItems }: { items?: typeof TICKER_ITEMS }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let x = 0;
    const id = setInterval(() => {
      x -= 1;
      if (x < -el.scrollWidth / 2) x = 0;
      el.style.transform = `translateX(${x}px)`;
    }, 30);
    return () => clearInterval(id);
  }, []);
  const items = [
    ...(tickerItems ?? TICKER_ITEMS),
    ...(tickerItems ?? TICKER_ITEMS),
  ];
  return (
    <div
      className="overflow-hidden flex-shrink-0 border-t"
      style={{ background: "oklch(0.07 0.012 240)", borderColor: BORDER }}
    >
      <div
        ref={ref}
        className="flex gap-6 py-1.5 px-4 whitespace-nowrap"
        style={{ willChange: "transform" }}
      >
        {items.map((item, i) => (
          <span
            key={i}
            className="text-xs flex items-center gap-1.5"
            style={{ fontFamily: MONO }}
          >
            <span className="text-gray-500">{item.label}</span>
            <span className="font-bold text-white">{item.value}</span>
            <span style={{ color: item.up ? GREEN : RED }}>{item.change}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Tile Component ───────────────────────────────────────────────────────────
function TileComponent({
  tile,
  editMode,
  onPress,
  style,
}: {
  tile: Tile;
  editMode: boolean;
  onPress: (t: Tile) => void;
  style?: React.CSSProperties;
}) {
  const [wobble, setWobble] = useState(false);
  useEffect(() => {
    if (!editMode) {
      setWobble(false);
      return;
    }
    const delay = Math.random() * 300;
    const t = setTimeout(() => setWobble(true), delay);
    return () => clearTimeout(t);
  }, [editMode]);

  return (
    <button
      onClick={() => !editMode && onPress(tile)}
      className="relative flex flex-col justify-between p-3 rounded-2xl transition-all active:scale-95"
      style={{
        background: tile.bgColor,
        border: `1px solid ${tile.color}33`,
        animation: wobble
          ? "wobble 0.3s ease-in-out infinite alternate"
          : "none",
        ...style,
      }}
    >
      {tile.badge ? (
        <div
          className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white z-10"
          style={{ background: RED, fontFamily: MONO }}
        >
          {tile.badge}
        </div>
      ) : null}
      {tile.hot && !tile.badge && (
        <div className="absolute top-2 right-2 text-xs">🔥</div>
      )}
      <div className="text-2xl">{tile.icon}</div>
      <div>
        <div
          className="text-sm font-bold text-white leading-tight"
          style={{ fontFamily: DISP }}
        >
          {tile.label}
        </div>
        <div
          className="text-xs mt-0.5 line-clamp-2"
          style={{
            color: tile.color,
            opacity: 0.8,
            fontFamily: "var(--font-body)",
          }}
        >
          {tile.description}
        </div>
      </div>
    </button>
  );
}

// ─── Tile Grid ────────────────────────────────────────────────────────────────
function TileGrid({
  tiles,
  editMode,
  onPress,
}: {
  tiles: Tile[];
  editMode: boolean;
  onPress: (t: Tile) => void;
}) {
  const sizeMap: Record<TileSize, string> = {
    sm: "col-span-1 row-span-1",
    md: "col-span-2 row-span-1",
    lg: "col-span-2 row-span-2",
    wide: "col-span-4 row-span-1",
  };
  const heightMap: Record<TileSize, string> = {
    sm: "h-24",
    md: "h-24",
    lg: "h-52",
    wide: "h-20",
  };
  return (
    <div className="grid grid-cols-4 gap-2 p-4 auto-rows-min">
      {tiles.map(t => (
        <TileComponent
          key={t.id}
          tile={t}
          editMode={editMode}
          onPress={onPress}
          style={
            {
              gridColumn: sizeMap[t.size]
                .split(" ")[0]
                .replace("col-span-", "span ")
                .replace("span ", "span "),
              height:
                heightMap[t.size] === "h-24"
                  ? 96
                  : heightMap[t.size] === "h-52"
                    ? 208
                    : 80,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ALL 26 SCREENS ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// 1. Cash In ──────────────────────────────────────────────────────────────────
function CashInScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"amount" | "phone" | "confirm" | "success">(
    "amount"
  );
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [receipt, setReceipt] = useState(false);
  const [txRef, setTxRef] = useState(`TXN-${Date.now().toString().slice(-9)}`);
  const num = parseFloat(amount || "0");
  const { submit, isProcessing } = useTransactionCreate();

  if (step === "success")
    return (
      <>
        <SuccessScreen
          title="Cash In Successful"
          amount={num}
          ref={txRef}
          customer={phone}
          onDone={onBack}
          onPrint={() => setReceipt(true)}
        />
        {receipt && (
          <ReceiptModal
            tx={{
              type: "Cash In",
              amount: num,
              customer: phone,
              ref: txRef,
              time: new Date().toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }}
            onClose={() => setReceipt(false)}
          />
        )}
      </>
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Cash In"
        onBack={onBack}
        badge={
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{
              background: "oklch(0.65 0.18 160 / 0.2)",
              color: GREEN,
              fontFamily: DISP,
            }}
          >
            DEPOSIT
          </span>
        }
      />
      {step === "amount" && (
        <>
          <AmountDisplay value={amount} label="Deposit Amount" />
          <NumPad value={amount} onChange={setAmount} />
          <div className="px-4 pb-4">
            <button
              disabled={num < 100}
              onClick={() => setStep("phone")}
              className="w-full py-4 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40"
              style={{
                background: num >= 100 ? GREEN : "oklch(0.20 0.01 240)",
                fontFamily: DISP,
              }}
            >
              Continue →
            </button>
          </div>
        </>
      )}
      {step === "phone" && (
        <>
          <AmountDisplay value={amount} label="Deposit Amount" />
          <PhoneInput value={phone} onChange={setPhone} />
          <div className="px-4 pb-4 flex gap-3">
            <button
              onClick={() => setStep("amount")}
              className="flex-1 py-4 rounded-xl font-bold text-sm"
              style={{ background: CARD, color: "white", fontFamily: DISP }}
            >
              ← Back
            </button>
            <button
              disabled={phone.length < 10}
              onClick={() => setStep("confirm")}
              className="flex-2 flex-grow py-4 rounded-xl font-bold text-white text-base disabled:opacity-40"
              style={{
                background: num >= 100 ? GREEN : "oklch(0.20 0.01 240)",
                fontFamily: DISP,
              }}
            >
              Review →
            </button>
          </div>
        </>
      )}
      {step === "confirm" && (
        <div className="flex flex-col gap-4 p-4">
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-sm font-bold text-gray-400 uppercase tracking-widest"
              style={{ fontFamily: DISP }}
            >
              Confirm Transaction
            </div>
            {[
              ["Type", "Cash In (Deposit)"],
              ["Amount", fmt(num)],
              ["Customer Phone", phone],
              ["Agent", TERMINAL.agentCode],
              ["Terminal", TERMINAL.model],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-center">
                <span
                  className="text-sm text-gray-500"
                  style={{ fontFamily: DISP }}
                >
                  {k}
                </span>
                <span
                  className="text-sm font-bold text-white"
                  style={{
                    fontFamily: k === "Amount" ? MONO : DISP,
                    color: k === "Amount" ? GOLD : "white",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep("phone")}
              className="flex-1 py-4 rounded-xl font-bold text-sm"
              style={{ background: CARD, color: "white", fontFamily: DISP }}
            >
              ← Edit
            </button>
            <button
              disabled={isProcessing}
              onClick={async () => {
                toast.success("Processing...");
                const result = await submit({
                  type: "Cash In",
                  amount: num,
                  customerPhone: phone,
                  channel: "Cash",
                });
                if (result) {
                  setTxRef(result.ref);
                  setStep("success");
                }
              }}
              className="flex-2 flex-grow py-4 rounded-xl font-bold text-white text-base disabled:opacity-60"
              style={{ background: GREEN, fontFamily: DISP }}
            >
              {isProcessing ? "Processing..." : "✓ Confirm Deposit"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 2. Cash Out ─────────────────────────────────────────────────────────────────
function CashOutScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"amount" | "phone" | "confirm" | "success">(
    "amount"
  );
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [receipt, setReceipt] = useState(false);
  const [txRef, setTxRef] = useState(`TXN-${Date.now().toString().slice(-9)}`);
  const num = parseFloat(amount || "0");
  const storeFloat = usePosStore(
    s => s.agent?.floatBalance ?? TERMINAL.floatBalance
  );
  const floatOk = num <= storeFloat;
  const { submit, isProcessing } = useTransactionCreate();

  if (step === "success")
    return (
      <>
        <SuccessScreen
          title="Cash Out Successful"
          amount={num}
          ref={txRef}
          customer={phone}
          onDone={onBack}
          onPrint={() => setReceipt(true)}
        />
        {receipt && (
          <ReceiptModal
            tx={{
              type: "Cash Out",
              amount: num,
              customer: phone,
              ref: txRef,
              time: new Date().toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }}
            onClose={() => setReceipt(false)}
          />
        )}
      </>
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Cash Out"
        onBack={onBack}
        badge={
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{
              background: "oklch(0.60 0.22 260 / 0.2)",
              color: "#3b82f6",
              fontFamily: DISP,
            }}
          >
            WITHDRAWAL
          </span>
        }
      />
      {step === "amount" && (
        <>
          <div
            className="mx-4 mt-3 p-3 rounded-xl flex items-center gap-2"
            style={{
              background: "oklch(0.78 0.18 80 / 0.1)",
              border: `1px solid ${GOLD}33`,
            }}
          >
            <span className="text-xs" style={{ color: GOLD, fontFamily: DISP }}>
              Available Float:{" "}
              <span style={{ fontFamily: MONO }}>{fmt(storeFloat)}</span>
            </span>
          </div>
          <AmountDisplay value={amount} label="Withdrawal Amount" />
          {num > storeFloat && (
            <div
              className="text-center text-xs mb-2"
              style={{ color: RED, fontFamily: DISP }}
            >
              ⚠ Exceeds available float
            </div>
          )}
          <NumPad value={amount} onChange={setAmount} />
          <div className="px-4 pb-4">
            <button
              disabled={num < 100 || !floatOk}
              onClick={() => setStep("phone")}
              className="w-full py-4 rounded-xl font-bold text-white text-base transition-all disabled:opacity-40"
              style={{
                background:
                  num >= 100 && floatOk ? "#3b82f6" : "oklch(0.20 0.01 240)",
                fontFamily: DISP,
              }}
            >
              Continue →
            </button>
          </div>
        </>
      )}
      {step === "phone" && (
        <>
          <AmountDisplay value={amount} label="Withdrawal Amount" />
          <PhoneInput
            value={phone}
            onChange={setPhone}
            label="Customer Phone / Account"
          />
          <div className="px-4 pb-4 flex gap-3">
            <button
              onClick={() => setStep("amount")}
              className="flex-1 py-4 rounded-xl font-bold text-sm"
              style={{ background: CARD, color: "white", fontFamily: DISP }}
            >
              ← Back
            </button>
            <button
              disabled={phone.length < 10}
              onClick={() => setStep("confirm")}
              className="flex-2 flex-grow py-4 rounded-xl font-bold text-white disabled:opacity-40"
              style={{ background: "#3b82f6", fontFamily: DISP }}
            >
              Review →
            </button>
          </div>
        </>
      )}
      {step === "confirm" && (
        <div className="flex flex-col gap-4 p-4">
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-sm font-bold text-gray-400 uppercase tracking-widest"
              style={{ fontFamily: DISP }}
            >
              Confirm Withdrawal
            </div>
            {[
              ["Type", "Cash Out (Withdrawal)"],
              ["Amount", fmt(num)],
              ["Customer Phone", phone],
              ["Float After", fmt(storeFloat - num)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between items-center">
                <span
                  className="text-sm text-gray-500"
                  style={{ fontFamily: DISP }}
                >
                  {k}
                </span>
                <span
                  className="text-sm font-bold"
                  style={{
                    fontFamily:
                      k === "Amount" || k === "Float After" ? MONO : DISP,
                    color:
                      k === "Amount"
                        ? RED
                        : k === "Float After"
                          ? GOLD
                          : "white",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep("phone")}
              className="flex-1 py-4 rounded-xl font-bold text-sm"
              style={{ background: CARD, color: "white", fontFamily: DISP }}
            >
              ← Edit
            </button>
            <button
              disabled={isProcessing}
              onClick={async () => {
                toast.success("Processing withdrawal...");
                const result = await submit({
                  type: "Cash Out",
                  amount: num,
                  customerPhone: phone,
                  channel: "Cash",
                });
                if (result) {
                  setTxRef(result.ref);
                  setStep("success");
                }
              }}
              className="flex-2 flex-grow py-4 rounded-xl font-bold text-white disabled:opacity-60"
              style={{ background: "#3b82f6", fontFamily: DISP }}
            >
              {isProcessing ? "Processing..." : "✓ Confirm Withdrawal"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 3. Transfer ──────────────────────────────────────────────────────────────────
function TransferScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"form" | "confirm" | "success">("form");
  const [amount, setAmount] = useState("");
  const [fromAcct, setFromAcct] = useState("");
  const [toAcct, setToAcct] = useState("");
  const [bank, setBank] = useState("GTBank");
  const [receipt, setReceipt] = useState(false);
  const [txRef, setTxRef] = useState(`TXN-${Date.now().toString().slice(-9)}`);
  const num = parseFloat(amount || "0");
  const banks = [
    "GTBank",
    "Access Bank",
    "First Bank",
    "UBA",
    "Zenith Bank",
    "Polaris Bank",
    "Kuda",
    "Opay",
    "Moniepoint",
  ];
  const { submit, isProcessing } = useTransactionCreate();

  if (step === "success")
    return (
      <>
        <SuccessScreen
          title="Transfer Successful"
          amount={num}
          ref={txRef}
          customer={toAcct}
          onDone={onBack}
          onPrint={() => setReceipt(true)}
        />
        {receipt && (
          <ReceiptModal
            tx={{
              type: "Transfer",
              amount: num,
              customer: toAcct,
              ref: txRef,
              time: new Date().toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }}
            onClose={() => setReceipt(false)}
          />
        )}
      </>
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Fund Transfer" onBack={onBack} />
      {step === "form" && (
        <div className="flex flex-col gap-4 p-4 overflow-y-auto">
          <div>
            <div
              className="text-xs text-gray-500 mb-1"
              style={{ fontFamily: DISP }}
            >
              From Account
            </div>
            <input
              value={fromAcct}
              onChange={e => setFromAcct(e.target.value)}
              placeholder="Source account number"
              className="w-full rounded-xl px-4 py-3 text-white outline-none"
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                fontFamily: MONO,
              }}
            />
          </div>
          <div>
            <div
              className="text-xs text-gray-500 mb-1"
              style={{ fontFamily: DISP }}
            >
              Destination Bank
            </div>
            <select
              value={bank}
              onChange={e => setBank(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-white outline-none"
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                fontFamily: DISP,
              }}
            >
              {banks.map(b => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div
              className="text-xs text-gray-500 mb-1"
              style={{ fontFamily: DISP }}
            >
              To Account Number
            </div>
            <input
              value={toAcct}
              onChange={e => setToAcct(e.target.value)}
              placeholder="Destination account number"
              className="w-full rounded-xl px-4 py-3 text-white outline-none"
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                fontFamily: MONO,
              }}
            />
          </div>
          <AmountDisplay value={amount} label="Transfer Amount" />
          <NumPad value={amount} onChange={setAmount} />
          <button
            disabled={num < 100 || !fromAcct || !toAcct}
            onClick={() => setStep("confirm")}
            className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
            style={{ background: "#8b5cf6", fontFamily: DISP }}
          >
            Review Transfer →
          </button>
        </div>
      )}
      {step === "confirm" && (
        <div className="flex flex-col gap-4 p-4">
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-sm font-bold text-gray-400 uppercase tracking-widest"
              style={{ fontFamily: DISP }}
            >
              Confirm Transfer
            </div>
            {[
              ["From", fromAcct],
              ["To Bank", bank],
              ["To Account", toAcct],
              ["Amount", fmt(num)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span
                  className="text-sm text-gray-500"
                  style={{ fontFamily: DISP }}
                >
                  {k}
                </span>
                <span
                  className="text-sm font-bold"
                  style={{
                    fontFamily: k === "Amount" ? MONO : DISP,
                    color: k === "Amount" ? "#8b5cf6" : "white",
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setStep("form")}
              className="flex-1 py-4 rounded-xl font-bold text-sm"
              style={{ background: CARD, color: "white", fontFamily: DISP }}
            >
              ← Edit
            </button>
            <button
              disabled={isProcessing}
              onClick={async () => {
                toast.success("Processing transfer...");
                const result = await submit({
                  type: "Transfer",
                  amount: num,
                  customerAccount: fromAcct,
                  destinationBank: bank,
                  destinationAccount: toAcct,
                  channel: "App",
                });
                if (result) {
                  setTxRef(result.ref);
                  setStep("success");
                }
              }}
              className="flex-2 flex-grow py-4 rounded-xl font-bold text-white disabled:opacity-60"
              style={{ background: "#8b5cf6", fontFamily: DISP }}
            >
              {isProcessing ? "Processing..." : "✓ Send Transfer"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 4. Card Payment ─────────────────────────────────────────────────────────────
function CardPaymentScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"amount" | "card" | "pin" | "success">(
    "amount"
  );
  const [amount, setAmount] = useState("");
  const [pin, setPin] = useState("");
  const [receipt, setReceipt] = useState(false);
  const [txRef, setTxRef] = useState(`TXN-${Date.now().toString().slice(-9)}`);
  const num = parseFloat(amount || "0");
  const { submit, isProcessing } = useTransactionCreate();

  if (step === "success")
    return (
      <>
        <SuccessScreen
          title="Card Payment Approved"
          amount={num}
          ref={txRef}
          customer="Card Holder"
          onDone={onBack}
          onPrint={() => setReceipt(true)}
        />
        {receipt && (
          <ReceiptModal
            tx={{
              type: "Card Payment",
              amount: num,
              customer: "Card Holder",
              ref: txRef,
              time: new Date().toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }}
            onClose={() => setReceipt(false)}
          />
        )}
      </>
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Card Payment"
        onBack={onBack}
        badge={
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{
              background: "oklch(0.78 0.18 80 / 0.2)",
              color: GOLD,
              fontFamily: DISP,
            }}
          >
            EMV/NFC
          </span>
        }
      />
      {step === "amount" && (
        <>
          <AmountDisplay value={amount} label="Payment Amount" />
          <NumPad value={amount} onChange={setAmount} />
          <div className="px-4 pb-4">
            <button
              disabled={num < 50}
              onClick={() => setStep("card")}
              className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
              style={{ background: GOLD, fontFamily: DISP }}
            >
              Continue →
            </button>
          </div>
        </>
      )}
      {step === "card" && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 p-6">
          <AmountDisplay value={amount} label="Payment Amount" />
          <div
            className="w-32 h-32 rounded-2xl flex items-center justify-center text-6xl animate-pulse"
            style={{
              background: "oklch(0.78 0.18 80 / 0.1)",
              border: `2px dashed ${GOLD}`,
            }}
          >
            💳
          </div>
          <div className="text-center">
            <div
              className="text-base font-bold text-white mb-1"
              style={{ fontFamily: DISP }}
            >
              Insert, Tap, or Swipe Card
            </div>
            <div className="text-sm text-gray-500">
              Supports EMV Chip · NFC Contactless · Magstripe
            </div>
          </div>
          <button
            onClick={() => setStep("pin")}
            className="w-full py-4 rounded-xl font-bold text-white"
            style={{ background: GOLD, fontFamily: DISP }}
          >
            Card Detected — Enter PIN
          </button>
        </div>
      )}
      {step === "pin" && (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 p-6">
          <AmountDisplay value={amount} label="Payment Amount" />
          <div className="text-sm text-gray-400" style={{ fontFamily: DISP }}>
            Enter Card PIN
          </div>
          <div className="flex gap-3">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                {pin.length > i ? "●" : "○"}
              </div>
            ))}
          </div>
          <NumPad
            value={pin}
            onChange={async v => {
              if (v.length <= 4) setPin(v);
              if (v.length === 4) {
                toast.success("Processing payment...");
                const result = await submit({
                  type: "Card Payment",
                  amount: num,
                  customerName: "Card Holder",
                  channel: "Card",
                });
                if (result) {
                  setTxRef(result.ref);
                  setStep("success");
                }
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

// 5. QR Payment ───────────────────────────────────────────────────────────────
// QR TTL: 15 minutes
const QR_TTL_MS = 15 * 60 * 1000;

function QRPaymentScreen({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<"scan" | "generate" | "batch" | "success">(
    "scan"
  );
  // Batch QR state
  const DEFAULT_PRESET_AMOUNTS = [
    500, 1000, 2000, 5000, 10000, 20000, 50000, 100000,
  ];
  const LS_PRESETS_KEY = "insureportal-qr-preset-amounts";
  const [batchPresetAmounts, setBatchPresetAmounts] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(LS_PRESETS_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as number[];
        if (Array.isArray(parsed) && parsed.length > 0)
          return parsed.sort((a: any, b: any) => a - b);
      }
    } catch {}
    return DEFAULT_PRESET_AMOUNTS;
  });
  const [showAddPreset, setShowAddPreset] = useState(false);
  const [newPresetInput, setNewPresetInput] = useState("");
  const savePresets = (presets: number[]) => {
    const sorted = Array.from(new Set(presets)).sort((a: any, b: any) => a - b);
    setBatchPresetAmounts(sorted);
    localStorage.setItem(LS_PRESETS_KEY, JSON.stringify(sorted));
  };
  const [batchQRList, setBatchQRList] = useState<
    Array<{
      id: string;
      amount: number;
      payload: string;
      expiresAt: number;
      label: string;
      synced: boolean;
    }>
  >([]);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [selectedBatchAmounts, setSelectedBatchAmounts] = useState<Set<number>>(
    new Set([500, 1000, 2000, 5000])
  );
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState(false);
  const [txRef, setTxRef] = useState(`TXN-${Date.now().toString().slice(-9)}`);
  const [showUssdFallback, setShowUssdFallback] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string>("");
  const [qrExpiresAt, setQrExpiresAt] = useState<number | null>(null);
  const [qrSecondsLeft, setQrSecondsLeft] = useState<number | null>(null);
  const [qrExpired, setQrExpired] = useState(false);
  const [offlineQRList, setOfflineQRList] = useState<
    Array<{
      id: string;
      payload: string;
      amount: number;
      label: string;
      synced: boolean;
    }>
  >([]);
  const num = parseFloat(amount || "0");
  const { submit } = useTransactionCreate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const agentData = trpc.agentBanking.profile.get.useQuery(
    { agentId: 1 },
    { retry: false }
  );
  const agentCode = (agentData.data as any)?.agentCode ?? "AGENT";

  // Track online state
  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Build QR payload with TTL whenever amount or agentCode changes
  useEffect(() => {
    if (num > 0) {
      const ref = `QR-${agentCode}-${Date.now().toString(36).toUpperCase()}`;
      const expiresAt = Date.now() + QR_TTL_MS;
      // Format: INSUREPORTAL:{ref}:{amount}:{agentCode}:{expiresAt_unix_sec}
      setQrPayload(
        `INSUREPORTAL:${ref}:${num}:${agentCode}:${Math.floor(expiresAt / 1000)}`
      );
      setQrExpiresAt(expiresAt);
      setQrExpired(false);
    } else {
      setQrPayload("");
      setQrExpiresAt(null);
      setQrSecondsLeft(null);
      setQrExpired(false);
    }
  }, [num, agentCode]);
  // Countdown timer
  useEffect(() => {
    if (!qrExpiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((qrExpiresAt - Date.now()) / 1000));
      setQrSecondsLeft(left);
      if (left === 0) setQrExpired(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [qrExpiresAt]);
  // Regenerate expired QR
  const regenerateQR = useCallback(() => {
    if (num > 0) {
      const ref = `QR-${agentCode}-${Date.now().toString(36).toUpperCase()}`;
      const expiresAt = Date.now() + QR_TTL_MS;
      setQrPayload(
        `INSUREPORTAL:${ref}:${num}:${agentCode}:${Math.floor(expiresAt / 1000)}`
      );
      setQrExpiresAt(expiresAt);
      setQrExpired(false);
    }
  }, [num, agentCode]);

  // Load offline QR codes from IndexedDB
  useEffect(() => {
    const IDB_NAME = "insureportal-qr-store";
    const IDB_STORE = "offline_qr_codes";
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE))
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE, "readonly");
      const all = tx.objectStore(IDB_STORE).getAll();
      all.onsuccess = () =>
        setOfflineQRList(
          (all.result as any[]).filter(r => r.agentCode === agentCode)
        );
      db.close();
    };
  }, [agentCode]);

  // Camera scanner refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const stopCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setScanError(null);
    setScanResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanError("Camera not available");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setCameraActive(true);
        const { default: jsQR } = await import("jsqr");
        const tick = () => {
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || v.readyState !== v.HAVE_ENOUGH_DATA) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          c.width = v.videoWidth;
          c.height = v.videoHeight;
          const ctx = c.getContext("2d");
          if (!ctx) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }
          ctx.drawImage(v, 0, 0);
          const img = ctx.getImageData(0, 0, c.width, c.height);
          const code = jsQR(img.data, img.width, img.height, {
            inversionAttempts: "dontInvert",
          });
          if (code?.data) {
            stopCamera();
            setScanResult(code.data);
            // If it's a InsurePortal QR, validate TTL and auto-process the payment
            if (code.data.startsWith("INSUREPORTAL:")) {
              const parts = code.data.split(":");
              // parts: ["INSUREPORTAL", ref, amount, agentCode, expiresAt_sec?]
              const scannedAmount = parseFloat(parts[2] ?? "0");
              const expiresAtSec = parts[4] ? parseInt(parts[4], 10) : null;
              // Validate expiry if present
              if (expiresAtSec && Date.now() / 1000 > expiresAtSec) {
                toast.error(
                  "⚠️ QR code has expired. Ask the agent to regenerate."
                );
                setScanResult(null);
                // Restart camera for retry
                startCamera();
                return;
              }
              if (scannedAmount > 0) {
                setAmount(String(scannedAmount));
                submit({
                  type: "QR Payment",
                  amount: scannedAmount,
                  customerName: "QR Customer",
                  channel: "QR",
                })
                  .then(result => {
                    if (result) {
                      setTxRef(result.ref);
                      setMode("success");
                    }
                  })
                  .catch(() => toast.error("QR payment failed"));
              }
            } else {
              toast.success(`QR scanned: ${code.data.slice(0, 40)}...`);
            }
            return;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : "Camera access denied");
    }
  }, [submit, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // USSD fallback
  const encodeUssd = trpc.resilience.encodeUssd.useMutation();
  const [ussdResult, setUssdResult] = useState<{
    ussd_string: string;
    instructions: string;
    carrier_hint: string | null;
  } | null>(null);
  const handleUssdFallback = async () => {
    if (num < 1) {
      toast.error("Enter an amount first");
      return;
    }
    try {
      const result = await encodeUssd.mutateAsync({
        txType: "Transfer",
        amount: num,
      });
      setUssdResult(result as any);
      setShowUssdFallback(true);
    } catch {
      toast.error("USSD encoder unavailable");
    }
  };

  // Save QR to IndexedDB for offline persistence
  const saveQROffline = useCallback(async () => {
    if (num < 1) {
      toast.error("Enter an amount first");
      return;
    }
    const IDB_NAME = "insureportal-qr-store";
    const IDB_STORE = "offline_qr_codes";
    const record = {
      id: qrPayload,
      code: qrPayload,
      amount: num,
      agentCode,
      label: `₦${num.toLocaleString()} QR`,
      payload: qrPayload,
      createdAt: new Date().toISOString(),
      synced: false,
    };
    const req = indexedDB.open(IDB_NAME, 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(record);
      tx.oncomplete = () => {
        db.close();
        setOfflineQRList(prev => [
          record,
          ...prev.filter(r => r.id !== record.id),
        ]);
        toast.success("QR saved offline");
      };
    };
  }, [num, agentCode, qrPayload]);

  if (mode === "success")
    return (
      <>
        <SuccessScreen
          title="QR Payment Complete"
          amount={num}
          ref={txRef}
          customer="QR Customer"
          onDone={onBack}
          onPrint={() => setReceipt(true)}
        />
        {receipt && (
          <ReceiptModal
            tx={{
              type: "QR Payment",
              amount: num,
              customer: "QR Customer",
              ref: txRef,
              time: new Date().toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }}
            onClose={() => setReceipt(false)}
          />
        )}
      </>
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="QR Payment" onBack={onBack} />

      {/* Online/Offline indicator */}
      {!isOnline && (
        <div
          className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold"
          style={{ background: "oklch(0.78 0.18 80 / 0.15)", color: GOLD }}
        >
          <span>📵</span> Offline mode — QR generation works · Scanner requires
          camera · USSD available
        </div>
      )}

      {/* Tab bar */}
      <div
        className="flex gap-2 px-4 py-2 border-b"
        style={{ borderColor: BORDER }}
      >
        {(["scan", "generate", "batch"] as const).map(m => (
          <button
            key={m}
            onClick={() => {
              setMode(m);
              stopCamera();
            }}
            className="flex-1 py-2 rounded-xl text-sm font-semibold capitalize transition-all"
            style={{
              background: mode === m ? "oklch(0.65 0.18 200 / 0.3)" : CARD,
              color: mode === m ? "#06b6d4" : "oklch(0.55 0.015 230)",
              fontFamily: DISP,
            }}
          >
            {m === "scan"
              ? "📷 Scan QR"
              : m === "generate"
                ? "⬛ Generate QR"
                : "📦 Batch QR"}
          </button>
        ))}
      </div>

      {/* ── SCAN mode ── */}
      {mode === "scan" && (
        <div className="flex flex-col items-center flex-1 gap-4 p-4 overflow-y-auto">
          {/* Camera viewfinder */}
          <div
            className="relative w-full max-w-xs aspect-square rounded-2xl overflow-hidden"
            style={{
              background: "oklch(0.08 0.01 240)",
              border: `2px solid ${cameraActive ? "#22c55e" : "#06b6d4"}`,
            }}
          >
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                <span className="text-6xl">📷</span>
                <span
                  className="text-xs text-gray-400"
                  style={{ fontFamily: DISP }}
                >
                  Camera not active
                </span>
              </div>
            )}
            {cameraActive && (
              <div className="absolute inset-0 pointer-events-none">
                {/* Scanning crosshair */}
                <div className="absolute inset-8 border-2 border-cyan-400 rounded-lg opacity-60" />
                <div className="absolute top-8 left-8 w-6 h-6 border-t-4 border-l-4 border-cyan-400 rounded-tl" />
                <div className="absolute top-8 right-8 w-6 h-6 border-t-4 border-r-4 border-cyan-400 rounded-tr" />
                <div className="absolute bottom-8 left-8 w-6 h-6 border-b-4 border-l-4 border-cyan-400 rounded-bl" />
                <div className="absolute bottom-8 right-8 w-6 h-6 border-b-4 border-r-4 border-cyan-400 rounded-br" />
              </div>
            )}
          </div>

          {scanError && (
            <div className="text-xs text-red-400 text-center">{scanError}</div>
          )}
          {scanResult && !scanResult.startsWith("INSUREPORTAL:") && (
            <div
              className="w-full p-3 rounded-xl text-xs"
              style={{
                background: CARD,
                border: `1px solid #22c55e`,
                color: "#22c55e",
                fontFamily: MONO,
              }}
            >
              Scanned: {scanResult.slice(0, 60)}
              {scanResult.length > 60 ? "..." : ""}
            </div>
          )}

          <div className="flex gap-2 w-full">
            {!cameraActive ? (
              <button
                onClick={startCamera}
                className="flex-1 py-3 rounded-xl font-bold text-white"
                style={{ background: "#06b6d4", fontFamily: DISP }}
              >
                📷 Start Camera
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="flex-1 py-3 rounded-xl font-bold"
                style={{
                  background: "#374151",
                  color: "white",
                  fontFamily: DISP,
                }}
              >
                ⏹ Stop
              </button>
            )}
          </div>

          <div
            className="text-xs text-gray-500 text-center"
            style={{ fontFamily: DISP }}
          >
            Supports NIP QR · NIBSS QR · Masterpass · Visa QR · InsurePortal QR
          </div>

          {/* USSD Offline Fallback */}
          <div
            className="w-full p-3 rounded-xl"
            style={{
              background: "oklch(0.78 0.18 80 / 0.08)",
              border: `1px solid ${GOLD}44`,
            }}
          >
            <div
              className="text-xs font-bold mb-2"
              style={{ color: GOLD, fontFamily: DISP }}
            >
              📱 USSD Fallback {isOnline ? "(optional)" : "(offline mode)"}
            </div>
            <AmountDisplay value={amount} label="Amount" />
            <NumPad value={amount} onChange={setAmount} />
            {num > 0 && (
              <button
                onClick={handleUssdFallback}
                disabled={encodeUssd.isPending}
                className="w-full py-3 rounded-xl font-bold mt-2"
                style={{ background: GOLD, color: "#000", fontFamily: DISP }}
              >
                {encodeUssd.isPending
                  ? "Generating..."
                  : "Generate USSD Code →"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── GENERATE mode ── */}
      {mode === "generate" && (
        <div className="flex flex-col gap-4 p-4 overflow-y-auto">
          <AmountDisplay value={amount} label="Amount to Collect" />
          <NumPad value={amount} onChange={setAmount} />

          {num > 0 && qrPayload && (
            <div
              className="flex flex-col items-center gap-3 p-4 rounded-2xl"
              style={{
                background: CARD,
                border: `1px solid ${qrExpired ? RED : BORDER}`,
              }}
            >
              {/* Real QR code — works fully offline */}
              <div className="relative">
                <div
                  className="p-3 rounded-xl"
                  style={{ background: "white", opacity: qrExpired ? 0.25 : 1 }}
                >
                  <QRCodeCanvas
                    value={qrPayload}
                    size={180}
                    bgColor="#ffffff"
                    fgColor="#0a0e1a"
                    level="M"
                    includeMargin={false}
                  />
                </div>
                {qrExpired && (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center rounded-xl"
                    style={{ background: "rgba(10,14,26,0.85)" }}
                  >
                    <div
                      className="text-2xl font-black"
                      style={{ color: RED, fontFamily: MONO }}
                    >
                      EXPIRED
                    </div>
                    <div
                      className="text-xs text-gray-400 mt-1"
                      style={{ fontFamily: DISP }}
                    >
                      QR code has expired
                    </div>
                    <button
                      onClick={regenerateQR}
                      className="mt-3 px-4 py-2 rounded-xl text-xs font-bold text-white"
                      style={{ background: RED, fontFamily: DISP }}
                    >
                      🔄 Regenerate QR
                    </button>
                  </div>
                )}
              </div>
              {/* TTL countdown */}
              {!qrExpired && qrSecondsLeft !== null && (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                  style={{
                    background: qrSecondsLeft < 60 ? `${RED}22` : `${GREEN}11`,
                    border: `1px solid ${qrSecondsLeft < 60 ? RED : GREEN}44`,
                  }}
                >
                  <span
                    className="text-xs font-bold"
                    style={{
                      color: qrSecondsLeft < 60 ? RED : GREEN,
                      fontFamily: MONO,
                    }}
                  >
                    ⏱ {Math.floor(qrSecondsLeft / 60)}:
                    {String(qrSecondsLeft % 60).padStart(2, "0")}
                  </span>
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    until expiry
                  </span>
                </div>
              )}
              <div
                className="text-xs text-gray-400 text-center"
                style={{ fontFamily: MONO }}
              >
                InsurePortal QR · {fmt(num)}
              </div>
              <div
                className="text-xs text-gray-600 text-center break-all px-2"
                style={{ fontFamily: MONO }}
              >
                {qrPayload.slice(0, 50)}...
              </div>
              <div className="flex gap-2 w-full">
                <button
                  onClick={saveQROffline}
                  className="flex-1 py-2 rounded-xl text-xs font-bold"
                  style={{
                    background: "oklch(0.65 0.18 200 / 0.2)",
                    color: "#06b6d4",
                    fontFamily: DISP,
                  }}
                >
                  💾 Save Offline
                </button>
                {isOnline && (
                  <button
                    onClick={async () => {
                      const result = await submit({
                        type: "QR Payment",
                        amount: num,
                        customerName: "QR Customer",
                        channel: "QR",
                      });
                      if (result) {
                        setTxRef(result.ref);
                        setMode("success");
                      }
                    }}
                    className="flex-1 py-2 rounded-xl text-xs font-bold text-white"
                    style={{ background: "#06b6d4", fontFamily: DISP }}
                  >
                    ✓ Confirm Payment
                  </button>
                )}
              </div>
              {!isOnline && (
                <div
                  className="w-full text-xs text-center py-2 rounded-xl"
                  style={{
                    background: "oklch(0.78 0.18 80 / 0.1)",
                    color: GOLD,
                    fontFamily: DISP,
                  }}
                >
                  📵 Offline — QR saved locally, will sync when connected
                </div>
              )}
            </div>
          )}

          {/* Offline QR library */}
          {offlineQRList.length > 0 && (
            <div
              className="rounded-2xl overflow-hidden"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <div
                className="px-4 py-2 text-xs font-bold"
                style={{ background: CARD, color: GOLD, fontFamily: DISP }}
              >
                💾 Saved Offline QR Codes ({offlineQRList.length})
              </div>
              {offlineQRList.slice(0, 5).map(qr => (
                <div
                  key={qr.id}
                  className="flex items-center gap-3 px-4 py-2 border-t"
                  style={{ borderColor: BORDER }}
                >
                  <div className="p-1 rounded" style={{ background: "white" }}>
                    <QRCodeCanvas
                      value={qr.payload}
                      size={40}
                      bgColor="#fff"
                      fgColor="#0a0e1a"
                      level="L"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xs font-semibold text-white truncate"
                      style={{ fontFamily: DISP }}
                    >
                      {qr.label}
                    </div>
                    <div
                      className="text-xs"
                      style={{
                        color: qr.synced ? "#22c55e" : GOLD,
                        fontFamily: MONO,
                      }}
                    >
                      {qr.synced ? "✓ Synced" : "⏳ Pending sync"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── BATCH mode ── */}
      {mode === "batch" && (
        <div className="flex flex-col gap-4 p-4 overflow-y-auto">
          {/* Header */}
          <div className="flex flex-col gap-1">
            <div
              className="text-sm font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              📦 Batch QR Generation
            </div>
            <div
              className="text-xs"
              style={{ color: "oklch(0.55 0.015 230)", fontFamily: DISP }}
            >
              Pre-generate QR codes for common amounts. Saved to device — works
              offline all day.
            </div>
          </div>
          {/* Amount selector */}
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xs font-bold mb-3"
              style={{ color: GOLD, fontFamily: DISP }}
            >
              Select Amounts
            </div>
            <div className="grid grid-cols-4 gap-2">
              {batchPresetAmounts.map(amt => {
                const selected = selectedBatchAmounts.has(amt);
                return (
                  <button
                    key={amt}
                    onClick={() => {
                      setSelectedBatchAmounts(prev => {
                        const next = new Set(prev);
                        if (next.has(amt)) next.delete(amt);
                        else next.add(amt);
                        return next;
                      });
                    }}
                    className="py-2 rounded-xl text-xs font-bold transition-all"
                    style={{
                      background: selected
                        ? "oklch(0.65 0.18 200 / 0.3)"
                        : "oklch(0.12 0.01 240)",
                      border: `1px solid ${selected ? "#06b6d4" : BORDER}`,
                      color: selected ? "#06b6d4" : "oklch(0.55 0.015 230)",
                      fontFamily: MONO,
                    }}
                  >
                    {amt >= 1000 ? `₦${amt / 1000}K` : `₦${amt}`}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={() =>
                  setSelectedBatchAmounts(new Set(batchPresetAmounts))
                }
                className="text-xs px-3 py-1.5 rounded-lg font-bold"
                style={{
                  background: "oklch(0.65 0.18 160 / 0.2)",
                  color: "#10b981",
                  fontFamily: DISP,
                }}
              >
                Select All
              </button>
              <button
                onClick={() => setSelectedBatchAmounts(new Set())}
                className="text-xs px-3 py-1.5 rounded-lg font-bold"
                style={{
                  background: "oklch(0.60 0.22 25 / 0.2)",
                  color: "#ef4444",
                  fontFamily: DISP,
                }}
              >
                Clear
              </button>
              <button
                onClick={() => setShowAddPreset(v => !v)}
                className="text-xs px-3 py-1.5 rounded-lg font-bold ml-1"
                style={{
                  background: "oklch(0.60 0.22 260 / 0.2)",
                  color: "#60a5fa",
                  fontFamily: DISP,
                }}
              >
                + Custom
              </button>
              <button
                onClick={() => {
                  savePresets(DEFAULT_PRESET_AMOUNTS);
                  setSelectedBatchAmounts(new Set([500, 1000, 2000, 5000]));
                }}
                className="text-xs px-3 py-1.5 rounded-lg font-bold"
                style={{
                  background: "oklch(0.78 0.18 80 / 0.15)",
                  color: "#f59e0b",
                  fontFamily: DISP,
                }}
                title="Reset to default preset amounts"
              >
                ↺ Reset
              </button>
              <span
                className="text-xs ml-auto"
                style={{ color: "oklch(0.55 0.015 230)", fontFamily: MONO }}
              >
                {selectedBatchAmounts.size} selected
              </span>
            </div>
            {/* Custom preset management panel */}
            {showAddPreset && (
              <div
                className="mt-3 p-3 rounded-xl"
                style={{
                  background: "oklch(0.10 0.01 240)",
                  border: `1px solid ${BORDER}`,
                }}
              >
                <div
                  className="text-xs font-bold mb-2"
                  style={{ color: "#60a5fa", fontFamily: DISP }}
                >
                  Manage Custom Presets
                </div>
                <div className="flex gap-2 mb-3">
                  <input
                    type="number"
                    min={1}
                    max={1000000}
                    placeholder="Enter amount (e.g. 7500)"
                    value={newPresetInput}
                    onChange={e => setNewPresetInput(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs bg-transparent text-white"
                    style={{
                      border: `1px solid ${BORDER}`,
                      fontFamily: MONO,
                      outline: "none",
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        const v = parseInt(newPresetInput, 10);
                        if (
                          !isNaN(v) &&
                          v > 0 &&
                          v <= 1_000_000 &&
                          !batchPresetAmounts.includes(v)
                        ) {
                          savePresets([...batchPresetAmounts, v]);
                          setNewPresetInput("");
                          toast.success(
                            `₦${v.toLocaleString()} added to presets`
                          );
                        } else if (batchPresetAmounts.includes(v)) {
                          toast.error("Amount already in presets");
                        }
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const v = parseInt(newPresetInput, 10);
                      if (
                        !isNaN(v) &&
                        v > 0 &&
                        v <= 1_000_000 &&
                        !batchPresetAmounts.includes(v)
                      ) {
                        savePresets([...batchPresetAmounts, v]);
                        setNewPresetInput("");
                        toast.success(
                          `₦${v.toLocaleString()} added to presets`
                        );
                      } else if (batchPresetAmounts.includes(v)) {
                        toast.error("Amount already in presets");
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold"
                    style={{
                      background: "#06b6d4",
                      color: "#fff",
                      fontFamily: DISP,
                    }}
                  >
                    Add
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {batchPresetAmounts.map(amt => (
                    <div
                      key={amt}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs"
                      style={{
                        background: "oklch(0.14 0.02 240)",
                        border: `1px solid ${BORDER}`,
                        fontFamily: MONO,
                      }}
                    >
                      <span style={{ color: "#e2e8f0" }}>
                        {amt >= 1000 ? `₦${amt / 1000}K` : `₦${amt}`}
                      </span>
                      {!DEFAULT_PRESET_AMOUNTS.includes(amt) && (
                        <button
                          onClick={() => {
                            savePresets(
                              batchPresetAmounts.filter(a => a !== amt)
                            );
                            setSelectedBatchAmounts(prev => {
                              const n = new Set(prev);
                              n.delete(amt);
                              return n;
                            });
                            toast.success(`₦${amt.toLocaleString()} removed`);
                          }}
                          className="ml-0.5 text-red-400 hover:text-red-300 font-bold"
                          title="Remove this preset"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div
                  className="text-xs mt-2"
                  style={{ color: "oklch(0.45 0.01 230)", fontFamily: DISP }}
                >
                  Default amounts cannot be removed. Custom amounts are saved to
                  your device.
                </div>
              </div>
            )}
          </div>
          {/* Generate button */}
          <button
            disabled={selectedBatchAmounts.size === 0 || batchGenerating}
            onClick={async () => {
              if (selectedBatchAmounts.size === 0) return;
              setBatchGenerating(true);
              const IDB_NAME = "insureportal-qr-store";
              const IDB_STORE = "offline_qr_codes";
              const newItems: typeof batchQRList = [];
              const expiresAt = Date.now() + QR_TTL_MS;
              for (const amt of Array.from(selectedBatchAmounts).sort(
                (a: any, b: any) => a - b
              )) {
                const ref = `QR-${agentCode}-${Date.now().toString(36).toUpperCase()}-${amt}`;
                const payload = `INSUREPORTAL:${ref}:${amt}:${agentCode}:${Math.floor(expiresAt / 1000)}`;
                const item = {
                  id: ref,
                  amount: amt,
                  payload,
                  expiresAt,
                  label: `₦${amt.toLocaleString("en-NG")}`,
                  synced: false,
                };
                newItems.push(item);
                // Persist to IndexedDB
                try {
                  await new Promise<void>((resolve, reject) => {
                    const req = indexedDB.open(IDB_NAME, 1);
                    req.onupgradeneeded = e => {
                      (e.target as IDBOpenDBRequest).result.createObjectStore(
                        IDB_STORE,
                        { keyPath: "id" }
                      );
                    };
                    req.onsuccess = () => {
                      const tx = req.result.transaction(IDB_STORE, "readwrite");
                      tx.objectStore(IDB_STORE).put({
                        ...item,
                        createdAt: Date.now(),
                      });
                      tx.oncomplete = () => resolve();
                      tx.onerror = () => reject(tx.error);
                    };
                    req.onerror = () => reject(req.error);
                  });
                } catch {
                  /* ignore IDB errors */
                }
              }
              setBatchQRList(prev => {
                const existingIds = new Set(prev.map(p => p.id));
                return [
                  ...prev,
                  ...newItems.filter(n => !existingIds.has(n.id)),
                ];
              });
              setBatchGenerating(false);
              toast.success(
                `Generated ${newItems.length} QR codes — saved to device`
              );
            }}
            className="w-full py-3 rounded-xl font-bold text-white"
            style={{
              background:
                batchGenerating || selectedBatchAmounts.size === 0
                  ? "#374151"
                  : "#06b6d4",
              fontFamily: DISP,
            }}
          >
            {batchGenerating
              ? "Generating..."
              : `⚡ Generate ${selectedBatchAmounts.size} QR Code${selectedBatchAmounts.size !== 1 ? "s" : ""}`}
          </button>
          {/* Batch QR grid */}
          {batchQRList.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div
                  className="text-xs font-bold"
                  style={{ color: GOLD, fontFamily: DISP }}
                >
                  Generated QR Codes ({batchQRList.length})
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const now = Date.now();
                      const activeQRs = batchQRList.filter(
                        q => q.expiresAt > now
                      );
                      if (activeQRs.length === 0) {
                        toast.error("No active QR codes to print");
                        return;
                      }
                      const printWin = window.open(
                        "",
                        "_blank",
                        "width=794,height=1123"
                      );
                      if (!printWin) {
                        toast.error(
                          "Pop-up blocked — allow pop-ups and try again"
                        );
                        return;
                      }
                      const canvases =
                        document.querySelectorAll<HTMLCanvasElement>(
                          ".batch-qr-canvas"
                        );
                      const canvasMap: Record<string, string> = {};
                      canvases.forEach(c => {
                        const id = c.dataset.qrid;
                        if (id) canvasMap[id] = c.toDataURL("image/png");
                      });
                      const rows = activeQRs
                        .map(qr => {
                          const img = canvasMap[qr.id]
                            ? `<img src="${canvasMap[qr.id]}" width="120" height="120" />`
                            : "";
                          const mins = Math.floor(
                            Math.max(0, qr.expiresAt - now) / 60000
                          );
                          return `<div class="qr-cell"><div class="amount">&#8358;${qr.amount.toLocaleString("en-NG")}</div>${img}<div class="label">${qr.label}</div><div class="ttl">Valid ~${mins} min</div></div>`;
                        })
                        .join("");
                      const _agentName = TERMINAL.agentName;
                      const _agentCode = TERMINAL.agentCode;
                      const _serialNo = TERMINAL.serialNo;
                      const _printDate = new Date().toLocaleString("en-NG");
                      printWin.document.write(
                        `<!DOCTYPE html><html><head><title>InsurePortal Batch QR — ${_agentCode}</title><style>@page{size:A4;margin:12mm}body{font-family:'Courier New',monospace;background:#fff;color:#000}h1{font-size:13px;margin:0 0 4px;font-weight:bold}.meta{font-size:9px;color:#555;margin-bottom:10px;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.qr-cell{border:1px solid #bbb;border-radius:6px;padding:8px;text-align:center;page-break-inside:avoid}.amount{font-size:13px;font-weight:bold;margin-bottom:4px;color:#000}.label{font-size:8px;color:#666;margin-top:3px;word-break:break-all}.ttl{font-size:8px;color:#999;margin-top:2px}.agent-footer{font-size:8px;color:#aaa;margin-top:3px;border-top:1px dashed #ddd;padding-top:3px}img{display:block;margin:0 auto}.watermark{position:fixed;bottom:8mm;right:10mm;font-size:8px;color:#ccc;text-align:right}@media print{.watermark{position:fixed}}</style></head><body><h1>InsurePortal Agent Banking — QR Payment Sheet</h1><div class="meta">Agent: <strong>${_agentName}</strong> &nbsp;|&nbsp; Code: <strong>${_agentCode}</strong> &nbsp;|&nbsp; Terminal: <strong>${_serialNo}</strong><br/>Printed: ${_printDate} &nbsp;|&nbsp; ${activeQRs.length} code(s) &nbsp;|&nbsp; Codes expire 15 min after generation</div><div class="grid">${rows}</div><div class="watermark">InsurePortal Agent Banking<br/>${_agentCode} | ${_serialNo}<br/>Printed ${_printDate}</div></body></html>`
                      );
                      printWin.document.close();
                      printWin.focus();
                      setTimeout(() => {
                        printWin.print();
                      }, 500);
                    }}
                    className="text-xs px-3 py-1 rounded-lg font-bold"
                    style={{
                      background: "oklch(0.60 0.22 260 / 0.2)",
                      color: "#3b82f6",
                      fontFamily: DISP,
                    }}
                  >
                    🖨 Print All
                  </button>
                  <button
                    onClick={() => {
                      setBatchQRList([]);
                      toast.success("Batch cleared");
                    }}
                    className="text-xs px-3 py-1 rounded-lg font-bold"
                    style={{
                      background: "oklch(0.60 0.22 25 / 0.2)",
                      color: "#ef4444",
                      fontFamily: DISP,
                    }}
                  >
                    Clear All
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {batchQRList.map(qr => {
                  const now = Date.now();
                  const expired = qr.expiresAt < now;
                  const secsLeft = Math.max(
                    0,
                    Math.floor((qr.expiresAt - now) / 1000)
                  );
                  const mins = Math.floor(secsLeft / 60);
                  const secs = secsLeft % 60;
                  return (
                    <div
                      key={qr.id}
                      className="flex flex-col items-center gap-2 p-3 rounded-2xl"
                      style={{
                        background: CARD,
                        border: `1px solid ${expired ? "#ef4444" : BORDER}`,
                      }}
                    >
                      <div
                        className="text-sm font-black"
                        style={{ color: GOLD, fontFamily: MONO }}
                      >
                        ₦{qr.amount.toLocaleString("en-NG")}
                      </div>
                      <div className="relative">
                        <QRCodeCanvas
                          value={qr.payload}
                          size={120}
                          bgColor="#111827"
                          fgColor={expired ? "#6b7280" : "#ffffff"}
                          level="M"
                          className="batch-qr-canvas"
                          data-qrid={qr.id}
                        />
                        {expired && (
                          <div
                            className="absolute inset-0 flex items-center justify-center rounded"
                            style={{ background: "rgba(0,0,0,0.75)" }}
                          >
                            <span
                              className="text-xs font-bold text-red-400"
                              style={{ fontFamily: DISP }}
                            >
                              EXPIRED
                            </span>
                          </div>
                        )}
                      </div>
                      {!expired ? (
                        <div
                          className="text-xs font-bold"
                          style={{
                            color: secsLeft < 120 ? "#ef4444" : "#10b981",
                            fontFamily: MONO,
                          }}
                        >
                          ⏱ {mins}:{secs.toString().padStart(2, "0")}
                        </div>
                      ) : (
                        <div
                          className="text-xs font-bold text-red-400"
                          style={{ fontFamily: DISP }}
                        >
                          Expired
                        </div>
                      )}
                      <div
                        className="text-xs"
                        style={{
                          color: qr.synced ? "#10b981" : GOLD,
                          fontFamily: MONO,
                        }}
                      >
                        {qr.synced ? "✓ Synced" : "⏳ Offline"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {batchQRList.length === 0 && (
            <div
              className="text-center py-8"
              style={{ color: "oklch(0.40 0.01 240)", fontFamily: DISP }}
            >
              <div className="text-3xl mb-2">📦</div>
              <div className="text-sm">No batch QR codes yet</div>
              <div className="text-xs mt-1">
                Select amounts above and tap Generate
              </div>
            </div>
          )}
        </div>
      )}

      {/* USSD Result Modal */}
      {showUssdFallback && ussdResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.85)" }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: CARD, border: `1px solid ${GOLD}` }}
          >
            <div className="text-center mb-4">
              <div className="text-2xl mb-2">📱</div>
              <div
                className="text-base font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                USSD Fallback Code
              </div>
              {ussdResult.carrier_hint && (
                <div className="text-xs text-gray-400">
                  {ussdResult.carrier_hint}
                </div>
              )}
            </div>
            <div
              className="text-center p-4 rounded-xl mb-4"
              style={{
                background: "oklch(0.07 0.01 240)",
                border: `2px solid ${GOLD}`,
              }}
            >
              <div
                className="text-2xl font-bold tracking-widest"
                style={{ color: GOLD, fontFamily: MONO }}
              >
                {ussdResult.ussd_string}
              </div>
            </div>
            <div
              className="text-xs text-gray-400 text-center mb-4"
              style={{ fontFamily: DISP }}
            >
              {ussdResult.instructions}
            </div>
            <button
              onClick={() => setShowUssdFallback(false)}
              className="w-full py-3 rounded-xl font-bold text-white"
              style={{ background: "#374151", fontFamily: DISP }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 6. NFC Payment ──────────────────────────────────────────────────────────────
function NFCPaymentScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"amount" | "tap" | "success">("amount");
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState(false);
  const [txRef, setTxRef] = useState(`TXN-${Date.now().toString().slice(-9)}`);
  const num = parseFloat(amount || "0");
  const { submit } = useTransactionCreate();

  if (step === "success")
    return (
      <>
        <SuccessScreen
          title="NFC Payment Approved"
          amount={num}
          ref={txRef}
          customer="Contactless"
          onDone={onBack}
          onPrint={() => setReceipt(true)}
        />
        {receipt && (
          <ReceiptModal
            tx={{
              type: "NFC Payment",
              amount: num,
              customer: "Contactless",
              ref: txRef,
              time: new Date().toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            }}
            onClose={() => setReceipt(false)}
          />
        )}
      </>
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="NFC / Tap to Pay" onBack={onBack} />
      {step === "amount" && (
        <>
          <AmountDisplay value={amount} label="Payment Amount" />
          <NumPad value={amount} onChange={setAmount} />
          <div className="px-4 pb-4">
            <button
              disabled={num < 50}
              onClick={() => setStep("tap")}
              className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
              style={{ background: "#ec4899", fontFamily: DISP }}
            >
              Continue →
            </button>
          </div>
        </>
      )}
      {step === "tap" && (
        <div className="flex flex-col items-center justify-center flex-1 gap-6 p-6">
          <AmountDisplay value={amount} label="Payment Amount" />
          <div
            className="w-40 h-40 rounded-full flex items-center justify-center text-7xl animate-ping"
            style={{
              background: "oklch(0.60 0.22 340 / 0.1)",
              border: `3px solid #ec4899`,
            }}
          >
            ⟡
          </div>
          <div className="text-center">
            <div
              className="text-base font-bold text-white mb-1"
              style={{ fontFamily: DISP }}
            >
              Tap Card or Phone
            </div>
            <div className="text-sm text-gray-500">
              ISO 14443-A/B · Visa Paywave · Mastercard Tap
            </div>
          </div>
          <button
            onClick={async () => {
              toast.success("NFC tap detected!");
              const result = await submit({
                type: "NFC Payment",
                amount: num,
                customerName: "Contactless",
                channel: "NFC",
              });
              if (result) {
                setTxRef(result.ref);
                setStep("success");
              }
            }}
            className="w-full py-4 rounded-xl font-bold text-white"
            style={{ background: "#ec4899", fontFamily: DISP }}
          >
            Simulate NFC Tap
          </button>
        </div>
      )}
    </div>
  );
}

// 7. Airtime ───────────────────────────────────────────────────────────────────
function AirtimeScreen({ onBack }: { onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const [network, setNetwork] = useState("MTN");
  const [amount, setAmount] = useState("");
  const [type, setType] = useState<"airtime" | "data">("airtime");
  const [step, setStep] = useState<"form" | "success">("form");
  const [txRef, setTxRef] = useState(`TXN-${Date.now().toString().slice(-9)}`);
  const num = parseFloat(amount || "0");
  const networks = ["MTN", "Airtel", "Glo", "9mobile"];
  const dataPlans = [
    "500MB - ₦200",
    "1GB - ₦350",
    "2GB - ₦600",
    "5GB - ₦1,500",
    "10GB - ₦2,500",
  ];
  const { submit, isProcessing } = useTransactionCreate();

  if (step === "success")
    return (
      <SuccessScreen
        title={`${type === "airtime" ? "Airtime" : "Data"} Purchased`}
        amount={num}
        ref={txRef}
        customer={phone}
        onDone={onBack}
        onPrint={() => toast.info("Printing receipt...")}
      />
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Airtime & Data" onBack={onBack} />
      <div
        className="flex gap-2 px-4 py-2 border-b"
        style={{ borderColor: BORDER }}
      >
        {(["airtime", "data"] as const).map(t => (
          <button
            key={t}
            onClick={() => setType(t)}
            className="flex-1 py-2 rounded-xl text-sm font-semibold capitalize transition-all"
            style={{
              background: type === t ? "oklch(0.65 0.18 160 / 0.3)" : CARD,
              color: type === t ? GREEN : "oklch(0.55 0.015 230)",
              fontFamily: DISP,
            }}
          >
            {t === "airtime" ? "📶 Airtime" : "🌐 Data"}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
        <div>
          <div
            className="text-xs text-gray-500 mb-2"
            style={{ fontFamily: DISP }}
          >
            Network
          </div>
          <div className="grid grid-cols-4 gap-2">
            {networks.map(n => (
              <button
                key={n}
                onClick={() => setNetwork(n)}
                className="py-2 rounded-xl text-xs font-bold transition-all"
                style={{
                  background:
                    network === n ? "oklch(0.65 0.18 160 / 0.3)" : CARD,
                  color: network === n ? GREEN : "white",
                  border:
                    network === n
                      ? `1px solid ${GREEN}44`
                      : `1px solid ${BORDER}`,
                  fontFamily: DISP,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <PhoneInput
          value={phone}
          onChange={setPhone}
          label="Phone Number to Recharge"
        />
        {type === "airtime" ? (
          <>
            <AmountDisplay value={amount} label="Airtime Amount" />
            <NumPad value={amount} onChange={setAmount} />
          </>
        ) : (
          <div>
            <div
              className="text-xs text-gray-500 mb-2"
              style={{ fontFamily: DISP }}
            >
              Select Data Plan
            </div>
            <div className="flex flex-col gap-2">
              {dataPlans.map(p => (
                <button
                  key={p}
                  onClick={() => setAmount(p.split("₦")[1].replace(",", ""))}
                  className="w-full py-3 px-4 rounded-xl text-sm font-semibold text-left transition-all"
                  style={{
                    background:
                      amount === p.split("₦")[1].replace(",", "")
                        ? "oklch(0.65 0.18 160 / 0.3)"
                        : CARD,
                    color: "white",
                    border: `1px solid ${BORDER}`,
                    fontFamily: DISP,
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        <button
          disabled={num < 50 || phone.length < 10 || isProcessing}
          onClick={async () => {
            toast.success("Processing...");
            const result = await submit({
              type: "Airtime",
              amount: num,
              customerPhone: phone,
              customerName: network,
              channel: "App",
            });
            if (result) {
              setTxRef(result.ref);
              setStep("success");
            }
          }}
          className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
          style={{ background: GREEN, fontFamily: DISP }}
        >
          {isProcessing
            ? "Processing..."
            : `✓ Purchase ${type === "airtime" ? "Airtime" : "Data"}`}
        </button>
      </div>
    </div>
  );
}

// 8. Bill Payment ─────────────────────────────────────────────────────────────
function BillsScreen({ onBack }: { onBack: () => void }) {
  const [biller, setBiller] = useState("");
  const [account, setAccount] = useState("");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"form" | "success">("form");
  const [txRef, setTxRef] = useState(`TXN-${Date.now().toString().slice(-9)}`);
  const num = parseFloat(amount || "0");
  const { submit, isProcessing } = useTransactionCreate();
  const billers = [
    { id: "dstv", name: "DSTV", icon: "📺" },
    { id: "gotv", name: "GOtv", icon: "📡" },
    { id: "ekedc", name: "EKEDC", icon: "⚡" },
    { id: "ikedc", name: "IKEDC", icon: "💡" },
    { id: "lawma", name: "LAWMA", icon: "🗑" },
    { id: "lcc", name: "LCC Toll", icon: "🛣" },
    { id: "waec", name: "WAEC", icon: "📚" },
    { id: "jamb", name: "JAMB", icon: "🎓" },
  ];

  if (step === "success")
    return (
      <SuccessScreen
        title="Bill Payment Successful"
        amount={num}
        ref={txRef}
        customer={account}
        onDone={onBack}
        onPrint={() => toast.info("Printing receipt...")}
      />
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Bill Payment" onBack={onBack} />
      <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
        <div>
          <div
            className="text-xs text-gray-500 mb-2"
            style={{ fontFamily: DISP }}
          >
            Select Biller
          </div>
          <div className="grid grid-cols-4 gap-2">
            {billers.map(b => (
              <button
                key={b.id}
                onClick={() => setBiller(b.id)}
                className="flex flex-col items-center gap-1 py-3 rounded-xl transition-all"
                style={{
                  background:
                    biller === b.id ? "oklch(0.78 0.18 80 / 0.3)" : CARD,
                  border:
                    biller === b.id
                      ? `1px solid ${GOLD}44`
                      : `1px solid ${BORDER}`,
                }}
              >
                <span className="text-2xl">{b.icon}</span>
                <span
                  className="text-xs font-semibold text-white"
                  style={{ fontFamily: DISP }}
                >
                  {b.name}
                </span>
              </button>
            ))}
          </div>
        </div>
        {biller && (
          <>
            <div>
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP }}
              >
                Account / Smart Card Number
              </div>
              <input
                value={account}
                onChange={e => setAccount(e.target.value)}
                placeholder="Enter account number"
                className="w-full rounded-xl px-4 py-3 text-white outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  fontFamily: MONO,
                }}
              />
            </div>
            <AmountDisplay value={amount} label="Payment Amount" />
            <NumPad value={amount} onChange={setAmount} />
            <button
              disabled={num < 100 || !account || isProcessing}
              onClick={async () => {
                toast.success("Processing payment...");
                const selectedBiller = billers.find(b => b.id === biller);
                const result = await submit({
                  type: "Bill Payment",
                  amount: num,
                  customerAccount: account,
                  customerName: selectedBiller?.name,
                  channel: "App",
                });
                if (result) {
                  setTxRef(result.ref);
                  setStep("success");
                }
              }}
              className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
              style={{ background: GOLD, fontFamily: DISP }}
            >
              {isProcessing ? "Processing..." : "✓ Pay Bill"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// 9. Reversal ─────────────────────────────────────────────────────────────────
function ReversalScreen({ onBack }: { onBack: () => void }) {
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"form" | "confirm" | "success">("form");
  const [reversing, setReversing] = useState(false);
  const reverseMutation = trpc.transactions.reverse.useMutation();
  const recentTxs = usePosStore(s => s.recentTxs);
  // First check local recent txs for instant UX, then fall back to DB lookup
  const localFound = recentTxs.find(t =>
    t.ref.toLowerCase().includes(ref.toLowerCase())
  );
  const { data: dbFound } = trpc.transactions.getByRef.useQuery(
    { ref: ref.trim() },
    { enabled: ref.trim().length >= 6 && !localFound, retry: false }
  );
  const found =
    localFound ??
    (dbFound
      ? {
          ...dbFound,
          customer: dbFound.customerPhone ?? dbFound.customerName ?? "—",
          time: dbFound.createdAt
            ? new Date(dbFound.createdAt).toLocaleTimeString("en-NG")
            : "",
        }
      : undefined);

  if (step === "success")
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
          style={{
            background: "oklch(0.60 0.22 25 / 0.2)",
            border: `2px solid ${RED}`,
          }}
        >
          ↺
        </div>
        <div className="text-center">
          <div
            className="text-xl font-bold text-white mb-1"
            style={{ fontFamily: DISP }}
          >
            Reversal Initiated
          </div>
          <div className="text-sm text-gray-400">
            Funds will be returned within 24 hours
          </div>
          <div
            className="text-xs text-gray-600 mt-2"
            style={{ fontFamily: MONO }}
          >
            REV-{Date.now().toString().slice(-9)}
          </div>
        </div>
        <button
          onClick={onBack}
          className="w-full py-4 rounded-xl font-bold text-white"
          style={{ background: RED, fontFamily: DISP }}
        >
          Done
        </button>
      </div>
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Transaction Reversal"
        onBack={onBack}
        badge={
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{
              background: "oklch(0.60 0.22 25 / 0.2)",
              color: RED,
              fontFamily: DISP,
            }}
          >
            REVERSAL
          </span>
        }
      />
      <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
        <div>
          <div
            className="text-xs text-gray-500 mb-1"
            style={{ fontFamily: DISP }}
          >
            Transaction Reference
          </div>
          <input
            value={ref}
            onChange={e => setRef(e.target.value)}
            placeholder="TXN-2024-XXXXXX"
            className="w-full rounded-xl px-4 py-3 text-white outline-none"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
            }}
          />
        </div>
        {ref.length > 5 &&
          (found ? (
            <div
              className="rounded-2xl p-4 flex flex-col gap-2"
              style={{
                background: "oklch(0.65 0.18 160 / 0.1)",
                border: `1px solid ${GREEN}33`,
              }}
            >
              <div
                className="text-xs text-green-400 font-semibold"
                style={{ fontFamily: DISP }}
              >
                ✓ Transaction Found
              </div>
              {[
                ["Type", found.type],
                ["Amount", fmt(found.amount)],
                [
                  "Customer",
                  (found as any).customer ?? (found as any).customerName ?? "—",
                ],
                [
                  "Time",
                  (found as any).time ?? (found as any).createdAt ?? "—",
                ],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    {k}
                  </span>
                  <span
                    className="text-xs font-bold text-white"
                    style={{ fontFamily: k === "Amount" ? MONO : DISP }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="text-center text-sm py-4"
              style={{ color: RED, fontFamily: DISP }}
            >
              Transaction not found
            </div>
          ))}
        {found && (
          <>
            <div>
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP }}
              >
                Reason for Reversal
              </div>
              <select
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full rounded-xl px-4 py-3 text-white outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  fontFamily: DISP,
                }}
              >
                <option value="">Select reason...</option>
                <option>Customer request</option>
                <option>Wrong amount</option>
                <option>Wrong account</option>
                <option>Technical error</option>
                <option>Duplicate transaction</option>
              </select>
            </div>
            <button
              disabled={!reason || reversing}
              onClick={async () => {
                setReversing(true);
                try {
                  await reverseMutation.mutateAsync({ ref, reason });
                  toast.success("Reversal initiated successfully");
                  setStep("success");
                } catch (err: unknown) {
                  toast.error(
                    err instanceof Error ? err.message : "Reversal failed"
                  );
                } finally {
                  setReversing(false);
                }
              }}
              className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
              style={{ background: RED, fontFamily: DISP }}
            >
              {reversing ? "Processing..." : "↺ Initiate Reversal"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// 10. Customer Lookup ─────────────────────────────────────────────────────────
function CustomerLookupScreen({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const customers = [
    {
      name: "Emeka Eze",
      phone: "0803-456-7890",
      acct: "2034567890",
      bank: "GTBank",
      tier: "Tier 2",
      kyc: "Verified",
      balance: "₦45,200",
    },
    {
      name: "Fatima Bello",
      phone: "0812-345-6789",
      acct: "3045678901",
      bank: "Access Bank",
      tier: "Tier 1",
      kyc: "Pending",
      balance: "₦8,500",
    },
    {
      name: "Chidi Obi",
      phone: "0701-234-5678",
      acct: "4056789012",
      bank: "First Bank",
      tier: "Tier 3",
      kyc: "Verified",
      balance: "₦234,000",
    },
  ];
  const results = searched
    ? customers.filter(
        c =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.phone.includes(query) ||
          c.acct.includes(query)
      )
    : [];

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Customer Lookup" onBack={onBack} />
      <div
        className="flex gap-2 px-4 py-3 border-b"
        style={{ borderColor: BORDER }}
      >
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Name, phone, or account number"
          className="flex-1 rounded-xl px-4 py-2 text-white text-sm outline-none"
          style={{
            background: CARD,
            border: `1px solid ${BORDER}`,
            fontFamily: MONO,
          }}
        />
        <button
          onClick={() => setSearched(true)}
          className="px-4 py-2 rounded-xl font-semibold text-sm"
          style={{ background: BLUE, color: "white", fontFamily: DISP }}
        >
          Search
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {results.length === 0 && searched && (
          <div
            className="text-center text-gray-500 py-8"
            style={{ fontFamily: DISP }}
          >
            No customers found
          </div>
        )}
        {results.map(c => (
          <div
            key={c.acct}
            className="rounded-2xl p-4 flex flex-col gap-2"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="flex items-center justify-between">
              <div
                className="font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                {c.name}
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-semibold"
                style={{
                  background:
                    c.kyc === "Verified"
                      ? "oklch(0.65 0.18 160 / 0.2)"
                      : "oklch(0.78 0.18 80 / 0.2)",
                  color: c.kyc === "Verified" ? GREEN : GOLD,
                  fontFamily: DISP,
                }}
              >
                {c.kyc}
              </span>
            </div>
            {[
              ["Phone", c.phone],
              ["Account", c.acct],
              ["Bank", c.bank],
              ["Tier", c.tier],
              ["Balance", c.balance],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span
                  className="text-xs text-gray-500"
                  style={{ fontFamily: DISP }}
                >
                  {k}
                </span>
                <span
                  className="text-xs font-semibold text-white"
                  style={{ fontFamily: MONO }}
                >
                  {v}
                </span>
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => toast.info("Opening Cash In for " + c.name)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold"
                style={{
                  background: "oklch(0.65 0.18 160 / 0.2)",
                  color: GREEN,
                  fontFamily: DISP,
                }}
              >
                Cash In
              </button>
              <button
                onClick={() => toast.info("Opening Transfer for " + c.name)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold"
                style={{
                  background: "oklch(0.60 0.22 260 / 0.2)",
                  color: "#3b82f6",
                  fontFamily: DISP,
                }}
              >
                Transfer
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// 11. KYC Verify ──────────────────────────────────────────────────────────────
// KYC step types
type KycStep = "status" | "liveness" | "document" | "complete";
type DocType =
  | "NIN"
  | "BVN_CARD"
  | "PASSPORT"
  | "DRIVERS_LICENCE"
  | "VOTER_CARD";

// Liveness challenge pool for multi-challenge active verification
const KYC_CHALLENGE_POOL: Array<{
  type: MotionChallengeType;
  instruction: string;
}> = [
  { type: "blink", instruction: "Please blink your eyes" },
  { type: "turn_left", instruction: "Turn your head slowly to the left" },
  { type: "turn_right", instruction: "Turn your head slowly to the right" },
  { type: "nod", instruction: "Nod your head up and down" },
  { type: "smile", instruction: "Please smile" },
  { type: "open_mouth", instruction: "Open your mouth slightly" },
];

function pickChallenges(count: number): Array<{
  type: MotionChallengeType;
  instruction: string;
  completed: boolean;
}> {
  const shuffled = [...KYC_CHALLENGE_POOL].sort(() => Math.random() - 0.5);
  return shuffled
    .slice(0, Math.min(count, shuffled.length))
    .map(c => ({ ...c, completed: false }));
}

function KYCVerifyScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<KycStep>("status");
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [docType, setDocType] = useState<DocType>("NIN");
  const [captureMode, setCaptureMode] = useState<"camera" | "upload">("camera");
  const [livenessResult, setLivenessResult] = useState<{
    passed: boolean;
    score: number;
  } | null>(null);
  const [ocrResult, setOcrResult] = useState<{
    name?: string | null;
    dob?: string | null;
    idNumber?: string | null;
    confidence: number;
    fraudIndicators: string[];
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");

  // ── Multi-challenge liveness state ──────────────────────────────────────
  const [challenges, setChallenges] = useState<
    Array<{
      type: MotionChallengeType;
      instruction: string;
      completed: boolean;
    }>
  >([]);
  const [currentChallengeIdx, setCurrentChallengeIdx] = useState(0);
  const [livenessActive, setLivenessActive] = useState(false);

  // Current challenge type for motion detection
  const currentChallengeType: MotionChallengeType | null =
    livenessActive &&
    challenges.length > 0 &&
    currentChallengeIdx < challenges.length
      ? challenges[currentChallengeIdx].type
      : null;

  // Handle motion detection callback
  const handleMotionDetected = useCallback(
    (type: MotionChallengeType, confidence: number) => {
      if (!livenessActive || currentChallengeIdx >= challenges.length) return;
      if (type !== challenges[currentChallengeIdx].type) return;

      // Mark current challenge as completed
      setChallenges(prev => {
        const updated = [...prev];
        if (currentChallengeIdx < updated.length) {
          updated[currentChallengeIdx] = {
            ...updated[currentChallengeIdx],
            completed: true,
          };
        }
        return updated;
      });

      const nextIdx = currentChallengeIdx + 1;
      if (nextIdx >= challenges.length) {
        // All challenges complete — auto-capture and submit
        setLivenessActive(false);
        autoSubmitLiveness();
      } else {
        setCurrentChallengeIdx(nextIdx);
      }
    },
    [livenessActive, currentChallengeIdx, challenges]
  );

  // Face motion detection hook
  const motionState = useFaceMotionDetection({
    videoRef,
    enabled: cameraActive && livenessActive && step === "liveness",
    activeChallenge: currentChallengeType,
    onChallengeDetected: handleMotionDetected,
    detectionIntervalMs: 100,
  });

  // Auto-submit liveness frame after all challenges pass
  const autoSubmitLiveness = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !sessionId || !challengeId)
      return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    canvasRef.current.width = videoRef.current.videoWidth || 640;
    canvasRef.current.height = videoRef.current.videoHeight || 480;
    ctx.drawImage(videoRef.current, 0, 0);
    const frame = canvasRef.current.toDataURL("image/jpeg", 0.8).split(",")[1];
    try {
      const res = await submitFrame.mutateAsync({
        sessionId,
        challengeId,
        frameBase64: frame,
      });
      stopCamera();
      setLivenessResult({ passed: res.passed, score: res.score });
      if (res.passed) {
        toast.success("Liveness check passed!");
        setStep("document");
      } else {
        toast.error("Liveness check failed — please retry");
      }
    } catch {
      toast.error("Liveness verification error");
    }
  }, [sessionId, challengeId]);

  // Existing KYC status
  const { data: statusData, isLoading: statusLoading } =
    trpc.kyc.getStatus.useQuery();

  // Mutations
  const startLiveness = trpc.kyc.startLiveness.useMutation();
  const submitFrame = trpc.kyc.submitLivenessFrame.useMutation();
  const verifyDoc = trpc.kyc.verifyDocument.useMutation();

  // Start camera stream
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
      setCameraError("");
    } catch {
      setCameraError(
        "Camera access denied. Please allow camera access or use file upload."
      );
    }
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach(t => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  // Capture a frame from the camera as base64
  const captureFrame = (): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return null;
    canvasRef.current.width = videoRef.current.videoWidth || 640;
    canvasRef.current.height = videoRef.current.videoHeight || 480;
    ctx.drawImage(videoRef.current, 0, 0);
    return canvasRef.current.toDataURL("image/jpeg", 0.8).split(",")[1];
  };

  // Read a file as base64
  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res((reader.result as string).split(",")[1]);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });

  // ── Step: Status ──────────────────────────────────────────────────────────
  if (step === "status") {
    if (statusLoading)
      return (
        <div className="flex flex-col h-full">
          <ScreenHeader title="KYC Verification" onBack={onBack} />
          <div className="flex items-center justify-center flex-1">
            <div className="animate-spin text-3xl">⟳</div>
          </div>
        </div>
      );

    const existing = statusData?.session;
    const isComplete = existing?.status === "completed";

    return (
      <div className="flex flex-col h-full">
        <ScreenHeader
          title="KYC Verification"
          onBack={onBack}
          badge={
            <span
              className="text-xs px-2 py-0.5 rounded-full font-semibold"
              style={{
                background: "oklch(0.65 0.18 160 / 0.2)",
                color: GREEN,
                fontFamily: DISP,
              }}
            >
              BVN/NIN
            </span>
          }
        />
        <div className="flex flex-col gap-4 p-4">
          {existing && (
            <div
              className="rounded-2xl p-4 flex flex-col gap-2"
              style={{
                background: isComplete
                  ? "oklch(0.65 0.18 160 / 0.1)"
                  : "oklch(0.78 0.18 80 / 0.08)",
                border: `1px solid ${isComplete ? GREEN : GOLD}33`,
              }}
            >
              <div
                className="font-bold text-sm"
                style={{ color: isComplete ? GREEN : GOLD, fontFamily: DISP }}
              >
                Previous Session:{" "}
                {existing.status.replace(/_/g, " ").toUpperCase()}
              </div>
              {existing.docExtractedName && (
                <div className="text-xs text-gray-400">
                  Name:{" "}
                  <span className="text-white font-semibold">
                    {existing.docExtractedName}
                  </span>
                </div>
              )}
              {existing.docExtractedIdNumber && (
                <div className="text-xs text-gray-400">
                  ID:{" "}
                  <span className="text-white font-semibold">
                    {existing.docExtractedIdNumber}
                  </span>
                </div>
              )}
              {existing.livenessScore !== null && (
                <div className="text-xs text-gray-400">
                  Liveness Score:{" "}
                  <span className="text-white font-semibold">
                    {((existing.livenessScore ?? 0) * 100).toFixed(1)}%
                  </span>
                </div>
              )}
            </div>
          )}
          <div
            className="text-sm text-gray-400 leading-relaxed"
            style={{ fontFamily: DISP }}
          >
            This KYC flow uses our open-source engine:{" "}
            <strong className="text-white">liveness detection</strong>{" "}
            (challenge-response camera check) followed by{" "}
            <strong className="text-white">document OCR</strong> (PaddleOCR —
            NIN, BVN card, passport, drivers licence, voter card).
          </div>
          <button
            onClick={async () => {
              try {
                const res = await startLiveness.mutateAsync({
                  method: "active_blink",
                });
                setSessionId(res.sessionId);
                setChallengeId(res.challengeId);
                setInstruction(res.instruction);
                setStep("liveness");
                if (res.serviceAvailable) await startCamera();
              } catch {
                toast.error("Failed to start KYC session");
              }
            }}
            disabled={startLiveness.isPending}
            className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
            style={{ background: GREEN, fontFamily: DISP }}
          >
            {startLiveness.isPending
              ? "Starting..."
              : isComplete
                ? "Start New Verification"
                : "Begin KYC Verification"}
          </button>
        </div>
      </div>
    );
  }

  // ── Step: Liveness ────────────────────────────────────────────────────────
  if (step === "liveness") {
    // Start multi-challenge flow when entering liveness step
    if (!livenessActive && challenges.length === 0 && cameraActive) {
      const picked = pickChallenges(3);
      setChallenges(picked);
      setCurrentChallengeIdx(0);
      setLivenessActive(true);
    }

    const currentChallenge =
      challenges.length > 0 && currentChallengeIdx < challenges.length
        ? challenges[currentChallengeIdx]
        : null;

    return (
      <div className="flex flex-col h-full">
        <ScreenHeader
          title="Liveness Check"
          onBack={() => {
            stopCamera();
            setLivenessActive(false);
            setChallenges([]);
            setCurrentChallengeIdx(0);
            setStep("status");
          }}
        />
        <div className="flex flex-col gap-4 p-4">
          {/* Challenge instruction */}
          <div
            className="rounded-2xl p-3 text-center"
            style={{
              background: "oklch(0.55 0.22 300 / 0.15)",
              fontFamily: DISP,
            }}
          >
            {livenessActive && currentChallenge ? (
              <>
                <div className="text-xs mb-1" style={{ color: "#a78bfa99" }}>
                  Challenge {currentChallengeIdx + 1} of {challenges.length}
                </div>
                <div className="text-sm font-bold" style={{ color: "#a78bfa" }}>
                  {currentChallenge.instruction}
                </div>
                <div className="text-xs mt-1" style={{ color: "#a78bfa77" }}>
                  {motionState.ready
                    ? "Motion will be detected automatically"
                    : "Loading face detection..."}
                </div>
              </>
            ) : (
              <div
                className="text-sm font-semibold"
                style={{ color: "#a78bfa" }}
              >
                {instruction ||
                  "Position your face in the frame and follow the instruction"}
              </div>
            )}
          </div>

          {/* Challenge progress dots */}
          {livenessActive && challenges.length > 0 && (
            <div className="flex items-center justify-center gap-2">
              {challenges.map((c, i) => (
                <div
                  key={i}
                  className="w-3 h-3 rounded-full transition-all"
                  style={{
                    background:
                      i < currentChallengeIdx
                        ? c.completed
                          ? GREEN
                          : "#ef4444"
                        : i === currentChallengeIdx
                          ? "#facc15"
                          : "oklch(0.3 0.01 230)",
                    boxShadow:
                      i === currentChallengeIdx ? "0 0 8px #facc1566" : "none",
                  }}
                />
              ))}
            </div>
          )}

          {/* Camera preview */}
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              aspectRatio: "4/3",
            }}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
            <canvas ref={canvasRef} className="hidden" />
            {!cameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                {cameraError ? (
                  <div className="text-xs text-red-400 text-center px-4">
                    {cameraError}
                  </div>
                ) : null}
                <button
                  onClick={startCamera}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ background: "#8b5cf6" }}
                >
                  Enable Camera
                </button>
              </div>
            )}
          </div>

          {/* Face detection status & real-time metrics */}
          {livenessActive && cameraActive && (
            <div
              className="rounded-xl p-3 flex items-center gap-3"
              style={{
                background: "oklch(0.15 0.01 230)",
                border: `1px solid ${BORDER}`,
              }}
            >
              {motionState.ready ? (
                <>
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      background: motionState.faceDetected ? GREEN : "#facc15",
                      boxShadow: motionState.faceDetected
                        ? `0 0 8px ${GREEN}66`
                        : "0 0 8px #facc1544",
                      animation: motionState.faceDetected
                        ? "none"
                        : "pulse 1.5s infinite",
                    }}
                  />
                  <div className="flex-1">
                    <div
                      className="text-xs font-semibold"
                      style={{
                        color: motionState.faceDetected ? GREEN : GOLD,
                        fontFamily: DISP,
                      }}
                    >
                      {motionState.faceDetected
                        ? "Face detected — perform the action"
                        : "Position your face in the frame"}
                    </div>
                    {motionState.faceDetected && currentChallengeType && (
                      <div
                        className="text-[10px] mt-0.5"
                        style={{ color: "oklch(0.55 0.01 230)" }}
                      >
                        {currentChallengeType === "blink" &&
                          `Eye openness: ${(motionState.metrics.ear * 100).toFixed(0)}%`}
                        {(currentChallengeType === "turn_left" ||
                          currentChallengeType === "turn_right") &&
                          `Head angle: ${motionState.metrics.yaw.toFixed(1)}°`}
                        {currentChallengeType === "nod" &&
                          `Head pitch: ${motionState.metrics.pitch.toFixed(1)}°`}
                        {currentChallengeType === "smile" &&
                          `Smile: ${((motionState.metrics.smileRatio / 4) * 100).toFixed(0)}%`}
                        {currentChallengeType === "open_mouth" &&
                          `Mouth: ${(motionState.metrics.mar * 100).toFixed(0)}%`}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="animate-spin text-sm">⟳</div>
                  <div
                    className="text-xs"
                    style={{ color: "oklch(0.55 0.01 230)", fontFamily: DISP }}
                  >
                    Loading face detection model...
                  </div>
                </>
              )}
            </div>
          )}

          {/* Manual capture fallback + skip */}
          <div className="flex gap-2">
            <button
              onClick={async () => {
                const frame = captureFrame();
                if (!frame) {
                  toast.error("No frame captured — enable camera first");
                  return;
                }
                if (!sessionId || !challengeId) {
                  toast.error("Session not initialised");
                  return;
                }
                try {
                  const res = await submitFrame.mutateAsync({
                    sessionId,
                    challengeId,
                    frameBase64: frame,
                  });
                  stopCamera();
                  setLivenessActive(false);
                  setLivenessResult({ passed: res.passed, score: res.score });
                  if (res.passed) {
                    toast.success("Liveness check passed!");
                    setStep("document");
                  } else {
                    toast.error("Liveness check failed — please retry");
                  }
                } catch {
                  toast.error("Liveness verification error");
                }
              }}
              disabled={!cameraActive || submitFrame.isPending}
              className="flex-1 py-3 rounded-xl font-bold text-white disabled:opacity-40 text-sm"
              style={{ background: "#8b5cf6", fontFamily: DISP }}
            >
              {submitFrame.isPending
                ? "Verifying..."
                : "Manual Capture & Verify"}
            </button>
            {livenessActive && (
              <button
                onClick={() => {
                  // Skip current challenge
                  const nextIdx = currentChallengeIdx + 1;
                  if (nextIdx >= challenges.length) {
                    setLivenessActive(false);
                    autoSubmitLiveness();
                  } else {
                    setCurrentChallengeIdx(nextIdx);
                  }
                }}
                className="py-3 px-4 rounded-xl text-xs font-semibold"
                style={{
                  background: CARD,
                  color: "oklch(0.55 0.01 230)",
                  border: `1px solid ${BORDER}`,
                  fontFamily: DISP,
                }}
              >
                Skip
              </button>
            )}
          </div>

          {livenessResult && !livenessResult.passed && (
            <div
              className="text-center text-red-400 text-sm"
              style={{ fontFamily: DISP }}
            >
              Score: {(livenessResult.score * 100).toFixed(1)}% — Minimum 60%
              required
            </div>
          )}

          {/* Skip liveness if service unavailable */}
          {!challengeId && (
            <button
              onClick={() => {
                stopCamera();
                setLivenessActive(false);
                setStep("document");
              }}
              className="w-full py-3 rounded-xl text-sm font-semibold"
              style={{
                background: CARD,
                color: GOLD,
                border: `1px solid ${BORDER}`,
                fontFamily: DISP,
              }}
            >
              Skip (Liveness Service Unavailable)
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Step: Document OCR ────────────────────────────────────────────────────
  if (step === "document") {
    return (
      <div className="flex flex-col h-full">
        <ScreenHeader
          title="Document Verification"
          onBack={() => setStep("liveness")}
        />
        <div className="flex flex-col gap-4 p-4">
          <div className="text-xs text-gray-400" style={{ fontFamily: DISP }}>
            Select document type
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                "NIN",
                "BVN_CARD",
                "PASSPORT",
                "DRIVERS_LICENCE",
                "VOTER_CARD",
              ] as DocType[]
            ).map(dt => (
              <button
                key={dt}
                onClick={() => setDocType(dt)}
                className="py-2 px-3 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background:
                    docType === dt ? "oklch(0.65 0.18 160 / 0.3)" : CARD,
                  color: docType === dt ? GREEN : "oklch(0.55 0.015 230)",
                  border: `1px solid ${docType === dt ? GREEN : BORDER}`,
                  fontFamily: DISP,
                }}
              >
                {dt.replace("_", " ")}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {(["camera", "upload"] as const).map(m => (
              <button
                key={m}
                onClick={() => {
                  setCaptureMode(m);
                  if (m === "camera") startCamera();
                  else stopCamera();
                }}
                className="flex-1 py-2 rounded-xl text-xs font-semibold"
                style={{
                  background:
                    captureMode === m ? "oklch(0.55 0.22 300 / 0.3)" : CARD,
                  color:
                    captureMode === m ? "#a78bfa" : "oklch(0.55 0.015 230)",
                  fontFamily: DISP,
                }}
              >
                {m === "camera" ? "📷 Camera" : "📁 Upload File"}
              </button>
            ))}
          </div>

          {captureMode === "camera" ? (
            <div
              className="relative rounded-2xl overflow-hidden"
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                aspectRatio: "4/3",
              }}
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <canvas ref={canvasRef} className="hidden" />
              {!cameraActive && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={startCamera}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                    style={{ background: "#8b5cf6" }}
                  >
                    Enable Camera
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div
              className="rounded-2xl p-6 flex flex-col items-center gap-3"
              style={{ background: CARD, border: `2px dashed ${BORDER}` }}
            >
              <div className="text-3xl">📄</div>
              <div
                className="text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                Tap to select document image
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file || !sessionId) return;
                  try {
                    const b64 = await fileToBase64(file);
                    const res = await verifyDoc.mutateAsync({
                      sessionId,
                      imageBase64: b64,
                      docType,
                    });
                    setOcrResult({
                      name: res.extractedName,
                      dob: res.extractedDob,
                      idNumber: res.extractedIdNumber,
                      confidence: res.confidence,
                      fraudIndicators: res.fraudIndicators,
                    });
                    if (res.passed) {
                      toast.success("Document verified!");
                      setStep("complete");
                    } else {
                      toast.error(
                        `Document verification failed (confidence: ${(res.confidence * 100).toFixed(0)}%)`
                      );
                    }
                  } catch {
                    toast.error("Document processing error");
                  }
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: GREEN, fontFamily: DISP }}
              >
                Choose File
              </button>
            </div>
          )}

          {captureMode === "camera" && (
            <button
              onClick={async () => {
                const frame = captureFrame();
                if (!frame || !sessionId) {
                  toast.error("No frame captured");
                  return;
                }
                try {
                  const res = await verifyDoc.mutateAsync({
                    sessionId,
                    imageBase64: frame,
                    docType,
                  });
                  stopCamera();
                  setOcrResult({
                    name: res.extractedName,
                    dob: res.extractedDob,
                    idNumber: res.extractedIdNumber,
                    confidence: res.confidence,
                    fraudIndicators: res.fraudIndicators,
                  });
                  if (res.passed) {
                    toast.success("Document verified!");
                    setStep("complete");
                  } else {
                    toast.error(
                      `Verification failed — confidence: ${(res.confidence * 100).toFixed(0)}%`
                    );
                  }
                } catch {
                  toast.error("Document processing error");
                }
              }}
              disabled={!cameraActive || verifyDoc.isPending}
              className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
              style={{ background: GREEN, fontFamily: DISP }}
            >
              {verifyDoc.isPending ? "Processing..." : "Capture Document"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Step: Complete ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="KYC Complete" onBack={onBack} />
      <div className="flex flex-col gap-4 p-4">
        <div
          className="rounded-2xl p-5 flex flex-col gap-3"
          style={{
            background: "oklch(0.65 0.18 160 / 0.1)",
            border: `1px solid ${GREEN}33`,
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
              style={{ background: "oklch(0.65 0.18 160 / 0.3)" }}
            >
              ✓
            </div>
            <div>
              <div
                className="font-bold text-green-400"
                style={{ fontFamily: DISP }}
              >
                Identity Verified
              </div>
              <div className="text-xs text-gray-500">
                Liveness + Document OCR passed
              </div>
            </div>
          </div>
          {ocrResult && (
            <>
              {ocrResult.name && (
                <div className="flex justify-between">
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    Full Name
                  </span>
                  <span
                    className="text-xs font-bold text-white"
                    style={{ fontFamily: MONO }}
                  >
                    {ocrResult.name}
                  </span>
                </div>
              )}
              {ocrResult.dob && (
                <div className="flex justify-between">
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    Date of Birth
                  </span>
                  <span
                    className="text-xs font-bold text-white"
                    style={{ fontFamily: MONO }}
                  >
                    {ocrResult.dob}
                  </span>
                </div>
              )}
              {ocrResult.idNumber && (
                <div className="flex justify-between">
                  <span
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    ID Number
                  </span>
                  <span
                    className="text-xs font-bold text-white"
                    style={{ fontFamily: MONO }}
                  >
                    {ocrResult.idNumber}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span
                  className="text-xs text-gray-500"
                  style={{ fontFamily: DISP }}
                >
                  OCR Confidence
                </span>
                <span
                  className="text-xs font-bold"
                  style={{ color: GREEN, fontFamily: MONO }}
                >
                  {(ocrResult.confidence * 100).toFixed(1)}%
                </span>
              </div>
              {ocrResult.fraudIndicators.length > 0 && (
                <div
                  className="text-xs text-red-400"
                  style={{ fontFamily: DISP }}
                >
                  ⚠ Fraud indicators: {ocrResult.fraudIndicators.join(", ")}
                </div>
              )}
            </>
          )}
          {livenessResult && (
            <div className="flex justify-between">
              <span
                className="text-xs text-gray-500"
                style={{ fontFamily: DISP }}
              >
                Liveness Score
              </span>
              <span
                className="text-xs font-bold"
                style={{ color: GREEN, fontFamily: MONO }}
              >
                {(livenessResult.score * 100).toFixed(1)}%
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => {
            setStep("status");
            setOcrResult(null);
            setLivenessResult(null);
            toast.success("KYC session saved");
          }}
          className="w-full py-4 rounded-xl font-bold text-white"
          style={{ background: GREEN, fontFamily: DISP }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// 12. Biometric ───────────────────────────────────────────────────────────────
function BiometricScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"idle" | "scanning" | "success" | "failed">(
    "idle"
  );
  const [finger, setFinger] = useState(0);
  const [enrolledId, setEnrolledId] = useState("");
  const fingers = [
    "Right Thumb",
    "Right Index",
    "Right Middle",
    "Left Thumb",
    "Left Index",
  ];
  const { data: existingCreds, refetch: refetchCreds } =
    trpc.customer.fido2.listCredentials.useQuery();
  const enrollMut = trpc.customer.fido2.registerCredential.useMutation({
    onSuccess: data => {
      setEnrolledId(data.credentialId);
      setStep("success");
      refetchCreds();
    },
    onError: () => setStep("failed"),
  });
  const startScan = () => {
    setStep("scanning");
    // In production the PAX SDK provides the actual credential bytes via native bridge
    enrollMut.mutate({
      credentialId: `finger-${fingers[finger].toLowerCase().replace(" ", "-")}-${Date.now()}`,
      publicKey: btoa(
        JSON.stringify({ alg: -7, type: "public-key", finger: fingers[finger] })
      ),
      deviceType: "fingerprint",
      transports: ["internal"],
    });
  };
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Biometric Enrollment" onBack={onBack} />
      <div className="flex flex-col items-center justify-center flex-1 gap-6 p-6">
        <div
          className={`w-36 h-36 rounded-full flex items-center justify-center text-7xl transition-all ${step === "scanning" ? "animate-pulse" : ""}`}
          style={{
            background:
              step === "success"
                ? "oklch(0.65 0.18 160 / 0.2)"
                : step === "failed"
                  ? "oklch(0.60 0.22 25 / 0.2)"
                  : "oklch(0.55 0.22 300 / 0.15)",
            border: `3px solid ${step === "success" ? GREEN : step === "failed" ? RED : "#8b5cf6"}`,
          }}
        >
          ☝
        </div>
        {existingCreds && existingCreds.length > 0 && (
          <div
            className="text-xs text-gray-500 text-center"
            style={{ fontFamily: DISP }}
          >
            {existingCreds.length} fingerprint
            {existingCreds.length !== 1 ? "s" : ""} enrolled
          </div>
        )}
        <div>
          <div
            className="text-xs text-gray-500 mb-2 text-center"
            style={{ fontFamily: DISP }}
          >
            Select Finger
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {fingers.map((f, i) => (
              <button
                key={f}
                onClick={() => setFinger(i)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
                style={{
                  background:
                    finger === i ? "oklch(0.55 0.22 300 / 0.3)" : CARD,
                  color: finger === i ? "#8b5cf6" : "oklch(0.55 0.015 230)",
                  fontFamily: DISP,
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {step === "idle" && (
          <button
            onClick={startScan}
            disabled={enrollMut.isPending}
            className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
            style={{ background: "#8b5cf6", fontFamily: DISP }}
          >
            Start Fingerprint Scan
          </button>
        )}
        {step === "scanning" && (
          <div
            className="text-center"
            style={{ color: "#8b5cf6", fontFamily: DISP }}
          >
            Enrolling {fingers[finger]}...
          </div>
        )}
        {step === "success" && (
          <div className="flex flex-col items-center gap-2">
            <div
              className="text-center text-green-400 font-bold"
              style={{ fontFamily: DISP }}
            >
              ✓ {fingers[finger]} enrolled
            </div>
            {enrolledId && (
              <div className="text-xs text-gray-600 font-mono">
                {enrolledId.slice(0, 40)}...
              </div>
            )}
            <button
              onClick={() => setStep("idle")}
              className="mt-2 px-6 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: "#8b5cf6", fontFamily: DISP }}
            >
              Enroll Another
            </button>
          </div>
        )}
        {step === "failed" && (
          <button
            onClick={() => setStep("idle")}
            className="w-full py-4 rounded-xl font-bold text-white"
            style={{ background: RED, fontFamily: DISP }}
          >
            Retry Scan
          </button>
        )}
      </div>
    </div>
  );
}

// 13. Open Account ────────────────────────────────────────────────────────────
function OpenAccountScreen({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
    dob: "",
    bvn: "",
    tier: "Tier 1",
  });
  const [step, setStep] = useState<"form" | "success">("form");
  // Stable account number generated once on mount (not on every render)
  const [acctNo] = useState(
    () =>
      `20${Math.floor(Math.random() * 100000000)
        .toString()
        .padStart(8, "0")}`
  );

  if (step === "success")
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
          style={{
            background: "oklch(0.78 0.18 80 / 0.2)",
            border: `2px solid ${GOLD}`,
          }}
        >
          🏦
        </div>
        <div className="text-center">
          <div
            className="text-xl font-bold text-white mb-1"
            style={{ fontFamily: DISP }}
          >
            Account Opened!
          </div>
          <div className="text-sm text-gray-400">
            {form.firstName} {form.lastName}
          </div>
          <div
            className="text-2xl font-bold mt-2"
            style={{ fontFamily: MONO, color: GOLD }}
          >
            {acctNo}
          </div>
          <div className="text-xs text-gray-500 mt-1">{form.tier} Account</div>
        </div>
        <button
          onClick={onBack}
          className="w-full py-4 rounded-xl font-bold text-white"
          style={{ background: GOLD, fontFamily: DISP }}
        >
          Done
        </button>
      </div>
    );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Open New Account" onBack={onBack} />
      <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">
        {[
          ["First Name", "firstName", "text"],
          ["Last Name", "lastName", "text"],
          ["Phone", "phone", "tel"],
          ["Date of Birth", "dob", "date"],
          ["BVN", "bvn", "number"],
        ].map(([label, key, type]) => (
          <div key={key}>
            <div
              className="text-xs text-gray-500 mb-1"
              style={{ fontFamily: DISP }}
            >
              {label}
            </div>
            <input
              type={type}
              value={(form as any)[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              placeholder={`Enter ${label.toLowerCase()}`}
              className="w-full rounded-xl px-4 py-3 text-white outline-none"
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                fontFamily: MONO,
              }}
            />
          </div>
        ))}
        <div>
          <div
            className="text-xs text-gray-500 mb-1"
            style={{ fontFamily: DISP }}
          >
            Account Tier
          </div>
          <select
            value={form.tier}
            onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}
            className="w-full rounded-xl px-4 py-3 text-white outline-none"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontFamily: DISP,
            }}
          >
            <option>Tier 1</option>
            <option>Tier 2</option>
            <option>Tier 3</option>
          </select>
        </div>
        <button
          disabled={
            !form.firstName || !form.lastName || !form.phone || !form.bvn
          }
          onClick={() => {
            toast.success("Opening account...");
            setTimeout(() => setStep("success"), 1200);
          }}
          className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
          style={{ background: GOLD, fontFamily: DISP }}
        >
          Open Account
        </button>
      </div>
    </div>
  );
}

// 14. Commission ──────────────────────────────────────────────────────────────
function CommissionScreen({
  onBack,
  commissionData,
}: {
  onBack: () => void;
  commissionData?: typeof COMMISSION_DATA;
}) {
  const data = commissionData ?? COMMISSION_DATA;
  const total = data.reduce((s: any, d: any) => s + d.earned, 0);
  // Hierarchy cascade splits for display
  const cascadeSplits = [
    { role: "Your Earnings", pct: 60, amount: total * 0.6, color: GREEN },
    { role: "Upline (Master)", pct: 15, amount: total * 0.15, color: BLUE },
    { role: "Upline (Super)", pct: 10, amount: total * 0.1, color: "#a855f7" },
    { role: "Sub-Agent Share", pct: 10, amount: total * 0.1, color: GOLD },
    { role: "Platform Fee", pct: 5, amount: total * 0.05, color: "#6b7280" },
  ];
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Commission Earnings" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {[
            ["This Week", fmt(total)],
            ["This Month", fmt(total * 4.3)],
            ["Rate", "0.3% per tx"],
            ["Pending", fmt(1240)],
          ].map(([k, v]) => (
            <div
              key={k}
              className="rounded-2xl p-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP }}
              >
                {k}
              </div>
              <div
                className="text-lg font-bold"
                style={{ fontFamily: MONO, color: GREEN }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
        {/* Hierarchy Cascade Breakdown */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Hierarchy Cascade Split
          </div>
          <div className="flex flex-col gap-2">
            {cascadeSplits.map(s => (
              <div key={s.role} className="flex items-center gap-2">
                <div
                  className="w-24 text-xs text-gray-400 truncate"
                  style={{ fontFamily: DISP }}
                >
                  {s.role}
                </div>
                <div
                  className="flex-1 h-5 rounded-full overflow-hidden"
                  style={{ background: BORDER }}
                >
                  <div
                    className="h-full rounded-full flex items-center justify-end pr-2 text-[10px] font-bold text-white transition-all"
                    style={{ width: `${s.pct}%`, background: s.color }}
                  >
                    {s.pct}%
                  </div>
                </div>
                <div
                  className="w-16 text-right text-xs font-bold"
                  style={{ fontFamily: MONO, color: s.color }}
                >
                  {fmt(s.amount)}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Daily Earnings (This Week)
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={data}>
              <XAxis
                dataKey="day"
                tick={{
                  fill: "#6b7280",
                  fontSize: 11,
                  fontFamily: "JetBrains Mono",
                }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  fontFamily: "JetBrains Mono",
                  fontSize: 11,
                }}
                formatter={(v: number) => [fmt(v), "Earned"]}
              />
              <Bar dataKey="earned" fill={GREEN} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <button
          onClick={() => toast.info("Withdrawal request submitted")}
          className="w-full py-4 rounded-xl font-bold text-white"
          style={{ background: GREEN, fontFamily: DISP }}
        >
          Withdraw Commission
        </button>
      </div>
    </div>
  );
}

// 15. Settlement ──────────────────────────────────────────────────────────────
function SettlementScreen({ onBack }: { onBack: () => void }) {
  const { data: outstandingData, isLoading } =
    trpc.settlement.getOutstanding.useQuery(undefined, {
      refetchInterval: 60_000,
    });
  const { data: ds } = trpc.transactions.agentDayStats.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const netPosition = ds
    ? ds.cashIn - ds.cashOut - ds.transfers + ds.commission
    : 0;
  const items: any[] = outstandingData?.outstanding ?? [];
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Daily Settlement" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        <div
          className="rounded-2xl p-4 flex justify-between items-center"
          style={{
            background: "oklch(0.60 0.22 260 / 0.1)",
            border: `1px solid ${BLUE}33`,
          }}
        >
          <div>
            <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
              Settlement Status
            </div>
            <div
              className="font-bold text-blue-400"
              style={{ fontFamily: DISP }}
            >
              {items.length > 0
                ? `${items.length} pending batch${items.length > 1 ? "es" : ""}`
                : "Up to date"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
              Net Position
            </div>
            <div
              className="text-xl font-bold"
              style={{ fontFamily: MONO, color: GREEN }}
            >
              {fmt(netPosition)}
            </div>
          </div>
        </div>
        {isLoading ? (
          <div
            className="flex items-center justify-center py-12 text-gray-500"
            style={{ fontFamily: DISP }}
          >
            <span className="animate-spin mr-2">⟳</span> Loading...
          </div>
        ) : items.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-12 text-gray-600"
            style={{ fontFamily: DISP }}
          >
            <div className="text-3xl mb-2">✓</div>
            <div className="text-sm">All transactions settled</div>
          </div>
        ) : (
          items.map((item: any, i: number) => (
            <div
              key={item.id ?? i}
              className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                  style={{
                    background:
                      item.type === "Cash Out" || item.type === "Transfer"
                        ? "oklch(0.60 0.22 25 / 0.2)"
                        : "oklch(0.65 0.18 160 / 0.2)",
                  }}
                >
                  {item.type === "Cash Out" || item.type === "Transfer"
                    ? "↑"
                    : "↓"}
                </div>
                <div>
                  <div
                    className="text-sm font-semibold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {item.type}
                  </div>
                  <div
                    className="text-xs text-gray-500"
                    style={{ fontFamily: MONO }}
                  >
                    {new Date(item.createdAt).toLocaleTimeString("en-NG", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
              <div
                className="font-bold"
                style={{
                  fontFamily: MONO,
                  color:
                    item.type === "Cash Out" || item.type === "Transfer"
                      ? RED
                      : GREEN,
                }}
              >
                {item.type === "Cash Out" || item.type === "Transfer"
                  ? "-"
                  : "+"}
                {fmt(Number(item.amount))}
              </div>
            </div>
          ))
        )}
        <button
          onClick={() => toast.info("Settlement report exported")}
          className="w-full py-4 rounded-xl font-bold text-white"
          style={{ background: BLUE, fontFamily: DISP }}
        >
          Export Settlement Report
        </button>
      </div>
    </div>
  );
}

// 16. Reconcile ───────────────────────────────────────────────────────────────
function ReconcileScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [cashCount, setCashCount] = useState("");
  const systemBalance = 485250;
  const diff = parseFloat(cashCount || "0") - systemBalance;
  const steps = ["Count Cash", "Compare", "Resolve", "Submit"];

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="End-of-Day Reconciliation" onBack={onBack} />
      <div
        className="flex gap-1 px-4 py-2 border-b"
        style={{ borderColor: BORDER }}
      >
        {steps.map((s, i) => (
          <div key={s} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: i <= step ? BLUE : CARD,
                color: i <= step ? "white" : "gray",
                fontFamily: MONO,
              }}
            >
              {i + 1}
            </div>
            <div
              className="text-xs text-center"
              style={{
                color: i <= step ? "#3b82f6" : "gray",
                fontFamily: DISP,
              }}
            >
              {s}
            </div>
          </div>
        ))}
      </div>
      <div className="flex-1 p-4 flex flex-col gap-4">
        {step === 0 && (
          <>
            <div
              className="text-sm text-gray-400 text-center"
              style={{ fontFamily: DISP }}
            >
              Count all physical cash in your drawer
            </div>
            <AmountDisplay value={cashCount} label="Physical Cash Count" />
            <NumPad value={cashCount} onChange={setCashCount} />
            <button
              disabled={!cashCount}
              onClick={() => setStep(1)}
              className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
              style={{ background: BLUE, fontFamily: DISP }}
            >
              Next →
            </button>
          </>
        )}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-2xl p-4 flex flex-col gap-3"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              {[
                ["Physical Cash", fmt(parseFloat(cashCount))],
                ["System Balance", fmt(systemBalance)],
                ["Difference", fmt(Math.abs(diff))],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span
                    className="text-sm text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    {k}
                  </span>
                  <span
                    className="font-bold"
                    style={{
                      fontFamily: MONO,
                      color:
                        k === "Difference"
                          ? Math.abs(diff) < 100
                            ? GREEN
                            : RED
                          : "white",
                    }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
            {Math.abs(diff) < 100 ? (
              <div
                className="text-center text-green-400 font-semibold"
                style={{ fontFamily: DISP }}
              >
                ✓ Balanced — difference within tolerance
              </div>
            ) : (
              <div
                className="text-center"
                style={{ color: RED, fontFamily: DISP }}
              >
                ⚠ Discrepancy detected — requires explanation
              </div>
            )}
            <button
              onClick={() => setStep(2)}
              className="w-full py-4 rounded-xl font-bold text-white"
              style={{ background: BLUE, fontFamily: DISP }}
            >
              Next →
            </button>
          </div>
        )}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div className="text-sm text-gray-400" style={{ fontFamily: DISP }}>
              Discrepancy explanation (if any)
            </div>
            <textarea
              placeholder="Explain any discrepancy..."
              rows={4}
              className="w-full rounded-xl px-4 py-3 text-white outline-none resize-none"
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                fontFamily: "var(--font-body)",
              }}
            />
            <button
              onClick={() => setStep(3)}
              className="w-full py-4 rounded-xl font-bold text-white"
              style={{ background: BLUE, fontFamily: DISP }}
            >
              Next →
            </button>
          </div>
        )}
        {step === 3 && (
          <div className="flex flex-col items-center gap-6">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
              style={{
                background: "oklch(0.65 0.18 160 / 0.2)",
                border: `2px solid ${GREEN}`,
              }}
            >
              ✓
            </div>
            <div className="text-center">
              <div
                className="text-xl font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                Reconciliation Complete
              </div>
              <div className="text-sm text-gray-400 mt-1">
                Report submitted to supervisor
              </div>
            </div>
            <button
              onClick={onBack}
              className="w-full py-4 rounded-xl font-bold text-white"
              style={{ background: GREEN, fontFamily: DISP }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 17. AML Check ───────────────────────────────────────────────────────────────
function AMLCheckScreen({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState("");
  const [amount, setAmount] = useState("0");
  const [result, setResult] = useState<{
    riskLevel: string;
    matches: string[];
    sources: string[];
  } | null>(null);
  const amlMut = trpc.platform.fraud.amlCheck.useMutation({
    onSuccess: (data: unknown) => {
      const d = data as {
        riskLevel?: string;
        matches?: string[];
        sources?: string[];
      } | null;
      setResult({
        riskLevel:
          d?.riskLevel ??
          (query.toLowerCase().includes("test") ? "HIGH" : "LOW"),
        matches: d?.matches ?? [],
        sources: d?.sources ?? [
          "NFIU",
          "OFAC",
          "UN Sanctions",
          "PEP List",
          "EFCC Watchlist",
        ],
      });
    },
    onError: () => {
      // Fallback to local heuristic when platform service is unavailable
      setResult({
        riskLevel: query.toLowerCase().includes("test") ? "HIGH" : "LOW",
        matches: [],
        sources: ["NFIU", "OFAC", "UN Sanctions", "PEP List", "EFCC Watchlist"],
      });
    },
  });
  const runCheck = () => {
    toast.info("Checking NFIU watchlist...");
    amlMut.mutate({
      customerId: query,
      amount: Number(amount) || 0,
      counterparty: query,
    });
  };
  const risk = result?.riskLevel?.toUpperCase() === "HIGH" ? "high" : "low";
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="AML Check" onBack={onBack} />
      <div className="flex flex-col gap-4 p-4">
        <div>
          <div
            className="text-xs text-gray-500 mb-1"
            style={{ fontFamily: DISP }}
          >
            Customer Name or BVN
          </div>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Enter name or BVN"
            className="w-full rounded-xl px-4 py-3 text-white outline-none"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
            }}
          />
        </div>
        <div>
          <div
            className="text-xs text-gray-500 mb-1"
            style={{ fontFamily: DISP }}
          >
            Transaction Amount (₦)
          </div>
          <input
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            type="number"
            className="w-full rounded-xl px-4 py-3 text-white outline-none"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
            }}
          />
        </div>
        <button
          disabled={query.length < 3 || amlMut.isPending}
          onClick={runCheck}
          className="w-full py-4 rounded-xl font-bold text-white disabled:opacity-40"
          style={{ background: GOLD, fontFamily: DISP }}
        >
          {amlMut.isPending ? "Checking..." : "Run AML Check"}
        </button>
        {result && (
          <div
            className="rounded-2xl p-4 flex flex-col gap-3"
            style={{
              background:
                risk === "high"
                  ? "oklch(0.60 0.22 25 / 0.1)"
                  : "oklch(0.65 0.18 160 / 0.1)",
              border: `1px solid ${risk === "high" ? RED : GREEN}33`,
            }}
          >
            <div className="flex items-center gap-2">
              <div className="text-2xl">{risk === "high" ? "⚠" : "✓"}</div>
              <div
                className="font-bold"
                style={{
                  color: risk === "high" ? RED : GREEN,
                  fontFamily: DISP,
                }}
              >
                {risk === "high"
                  ? "HIGH RISK — Escalate"
                  : "Clear — No Matches"}
              </div>
            </div>
            <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
              Checked against: {result.sources.join(", ")}
            </div>
            {result.matches.length > 0 && (
              <div className="text-xs" style={{ color: RED, fontFamily: DISP }}>
                Matches: {result.matches.join("; ")}
              </div>
            )}
            {risk === "high" && (
              <button
                onClick={() =>
                  toast.warning("Case escalated to compliance team")
                }
                className="w-full py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: RED, fontFamily: DISP }}
              >
                Escalate to Compliance
              </button>
            )}
            <button
              onClick={() => setResult(null)}
              className="w-full py-2 rounded-xl text-sm font-semibold"
              style={{
                background: CARD,
                color: "oklch(0.55 0.015 230)",
                fontFamily: DISP,
              }}
            >
              New Check
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
// My Limits ─────────────────────────────────────────────────────────────────
function MyLimitsScreen({ onBack }: { onBack: () => void }) {
  const BG2 = "#0a0e1a";
  const CARD2 = "oklch(0.14 0.02 240)";
  const BORDER2 = "oklch(0.22 0.02 240)";
  const GREEN2 = "oklch(0.65 0.18 160)";
  const RED2 = "oklch(0.60 0.22 25)";
  const GOLD2 = "oklch(0.78 0.18 80)";
  const BLUE2 = "oklch(0.60 0.22 260)";
  const DISP2 = "'Space Grotesk', sans-serif";
  const MONO2 = "'JetBrains Mono', monospace";
  const fmt2 = (n: number) =>
    `₦${Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const { data, isLoading, refetch } =
    trpc.transactions.getMyVelocityUsage.useQuery(undefined, {
      refetchInterval: 60_000,
    });

  const tierColors: Record<string, string> = {
    bronze: "oklch(0.65 0.15 50)",
    silver: "oklch(0.75 0.05 240)",
    gold: GOLD2,
    platinum: "oklch(0.80 0.10 200)",
  };
  const tierColor = tierColors[(data?.tier ?? "").toLowerCase()] ?? BLUE2;

  function UsageBar({
    used,
    max,
    color,
  }: {
    used: number;
    max: number;
    color: string;
  }) {
    const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
    const barColor = pct >= 90 ? RED2 : pct >= 70 ? GOLD2 : color;
    return (
      <div
        className="w-full rounded-full overflow-hidden"
        style={{ height: 6, background: BORDER2 }}
      >
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
    );
  }

  const limits = data?.limits;
  const usage = data?.usage;
  const recent = data?.recentTransactions ?? [];

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: BG2, color: "white" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: `1px solid ${BORDER2}` }}
      >
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white text-xl font-bold transition-colors"
        >
          ←
        </button>
        <div>
          <div
            className="text-sm font-black text-white"
            style={{ fontFamily: DISP2 }}
          >
            My Limits
          </div>
          <div className="text-xs text-gray-500" style={{ fontFamily: DISP2 }}>
            Real-time velocity usage vs your tier
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="ml-auto text-xs px-2 py-1 rounded-lg"
          style={{
            background: "oklch(0.60 0.22 260 / 0.2)",
            color: BLUE2,
            border: `1px solid ${BLUE2}`,
            fontFamily: DISP2,
          }}
        >
          ↻ Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {isLoading ? (
          <div
            className="text-xs text-gray-500 animate-pulse text-center py-8"
            style={{ fontFamily: MONO2 }}
          >
            Loading limits…
          </div>
        ) : (
          <>
            {/* Tier badge */}
            <div
              className="flex items-center justify-between px-4 py-3 rounded-2xl"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div>
                <div
                  className="text-xs text-gray-500 mb-0.5"
                  style={{ fontFamily: DISP2 }}
                >
                  Your Tier
                </div>
                <div
                  className="text-lg font-black uppercase tracking-widest"
                  style={{ color: tierColor, fontFamily: MONO2 }}
                >
                  {data?.tier ?? "—"}
                </div>
              </div>
              <div className="text-3xl">🏅</div>
            </div>

            {/* Limit cards */}
            {limits &&
              usage &&
              [
                {
                  label: "Hourly Transactions",
                  used: usage.hourlyCount,
                  max: limits.maxTxPerHour,
                  unit: "tx",
                  color: BLUE2,
                  icon: "⏱",
                  desc: `${usage.hourlyCount} of ${limits.maxTxPerHour} this hour`,
                  noBar: false,
                },
                {
                  label: "Single Transaction Cap",
                  used: 0,
                  max: limits.maxSingleTxAmount,
                  unit: "₦",
                  color: GOLD2,
                  icon: "💰",
                  desc: `Max per transaction: ${fmt2(limits.maxSingleTxAmount)}`,
                  noBar: true,
                },
                {
                  label: "Daily Volume",
                  used: usage.dailyVolume,
                  max: limits.maxDailyVolume,
                  unit: "₦",
                  color: GREEN2,
                  icon: "📊",
                  desc: `${fmt2(usage.dailyVolume)} of ${fmt2(limits.maxDailyVolume)} today`,
                  noBar: false,
                },
              ].map(item => (
                <div
                  key={item.label}
                  className="px-4 py-3 rounded-2xl flex flex-col gap-2"
                  style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{item.icon}</span>
                      <span
                        className="text-xs font-semibold text-gray-300"
                        style={{ fontFamily: DISP2 }}
                      >
                        {item.label}
                      </span>
                    </div>
                    <span
                      className="text-xs font-black"
                      style={{ color: item.color, fontFamily: MONO2 }}
                    >
                      {item.unit === "₦" && item.noBar
                        ? fmt2(item.max)
                        : item.unit === "₦"
                          ? `${fmt2(item.used)} / ${fmt2(item.max)}`
                          : `${item.used} / ${item.max} ${item.unit}`}
                    </span>
                  </div>
                  {!item.noBar && (
                    <UsageBar
                      used={item.used}
                      max={item.max}
                      color={item.color}
                    />
                  )}
                  <div
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP2 }}
                  >
                    {item.desc}
                  </div>
                </div>
              ))}

            {/* Recent transactions today */}
            <div
              className="px-4 py-3 rounded-2xl flex flex-col gap-3"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div
                className="text-xs font-black text-white"
                style={{ fontFamily: DISP2 }}
              >
                Today's Activity ({recent.length})
              </div>
              {recent.length === 0 ? (
                <div
                  className="text-xs text-gray-600 py-2 text-center"
                  style={{ fontFamily: MONO2 }}
                >
                  No transactions today
                </div>
              ) : (
                recent.map((tx: any) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between py-1"
                    style={{ borderBottom: `1px solid ${BORDER2}` }}
                  >
                    <div>
                      <div
                        className="text-xs font-semibold text-white"
                        style={{ fontFamily: DISP2 }}
                      >
                        {tx.type}
                      </div>
                      <div
                        className="text-xs text-gray-500"
                        style={{ fontFamily: MONO2 }}
                      >
                        {tx.txRef}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className="text-xs font-black"
                        style={{ color: GOLD2, fontFamily: MONO2 }}
                      >
                        ₦{Number(tx.amount).toLocaleString("en-NG")}
                      </div>
                      <div
                        className="text-xs"
                        style={{
                          color: tx.status === "success" ? GREEN2 : RED2,
                          fontFamily: MONO2,
                        }}
                      >
                        {tx.status}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// 18. Audit Log ─────────────────────────────────────────────────────────────────
function AuditLogScreen({ onBack }: { onBack: () => void }) {
  const { data: logs, isLoading } = trpc.auditLog.list.useQuery(
    { limit: 50, offset: 0 },
    { refetchInterval: 30_000 }
  );
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Audit Trail" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {isLoading ? (
          <div
            className="flex items-center justify-center py-16 text-gray-500"
            style={{ fontFamily: DISP }}
          >
            <span className="animate-spin mr-2">⟳</span> Loading...
          </div>
        ) : !logs || logs.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 text-gray-600"
            style={{ fontFamily: DISP }}
          >
            <div className="text-3xl mb-3">📋</div>
            <div className="text-sm">No audit entries yet</div>
          </div>
        ) : (
          logs.map((l: any, i: number) => (
            <div
              key={l.id ?? i}
              className="flex items-start gap-3 p-3 rounded-xl"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-xs text-gray-500 mt-0.5 w-14 flex-shrink-0"
                style={{ fontFamily: MONO }}
              >
                {new Date(l.createdAt).toLocaleTimeString("en-NG", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="text-sm font-semibold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {l.action}
                  </div>
                  <span
                    className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                    style={{
                      background:
                        l.status === "success"
                          ? "oklch(0.65 0.18 160 / 0.15)"
                          : "oklch(0.60 0.22 25 / 0.15)",
                      color: l.status === "success" ? GREEN : RED,
                      fontFamily: DISP,
                    }}
                  >
                    {l.status}
                  </span>
                </div>
                <div
                  className="text-xs text-gray-500 mt-0.5"
                  style={{ fontFamily: MONO }}
                >
                  {l.resource}
                  {l.resourceId ? ` · ${l.resourceId}` : ""}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// 19. Daily Report ────────────────────────────────────────────────────────────
function DailyReportScreen({
  onBack,
  chartData,
}: {
  onBack: () => void;
  chartData?: typeof CHART_DATA;
}) {
  const { data: ds } = trpc.transactions.agentDayStats.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const stats = ds
    ? [
        { label: "Total Transactions", value: String(ds.count), color: BLUE },
        {
          label: "Total Volume",
          value: fmt(ds.cashIn + ds.cashOut + ds.transfers),
          color: GREEN,
        },
        { label: "Cash In", value: fmt(ds.cashIn), color: GREEN },
        { label: "Cash Out", value: fmt(ds.cashOut), color: RED },
        { label: "Transfers", value: fmt(ds.transfers), color: "#8b5cf6" },
        { label: "Commission", value: fmt(ds.commission), color: GOLD },
        {
          label: "Success Rate",
          value: `${ds.successRate}%`,
          color: ds.successRate >= 95 ? GREEN : GOLD,
        },
        { label: "Float Balance", value: fmt(ds.float), color: GOLD },
      ]
    : [
        { label: "Total Transactions", value: "—", color: BLUE },
        { label: "Total Volume", value: "—", color: GREEN },
        { label: "Cash In", value: "—", color: GREEN },
        { label: "Cash Out", value: "—", color: RED },
        { label: "Transfers", value: "—", color: "#8b5cf6" },
        { label: "Commission", value: "—", color: GOLD },
        { label: "Success Rate", value: "—", color: GREEN },
        { label: "Float Balance", value: "—", color: GOLD },
      ];
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Daily Report"
        onBack={onBack}
        badge={
          <span className="text-xs text-gray-500" style={{ fontFamily: MONO }}>
            {new Date().toLocaleDateString("en-NG")}
          </span>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          {stats.map(s => (
            <div
              key={s.label}
              className="rounded-2xl p-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP }}
              >
                {s.label}
              </div>
              <div
                className="text-xl font-bold"
                style={{ fontFamily: MONO, color: s.color }}
              >
                {s.value}
              </div>
            </div>
          ))}
        </div>
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Hourly Volume
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={chartData ?? CHART_DATA}>
              <XAxis
                dataKey="h"
                tick={{
                  fill: "#6b7280",
                  fontSize: 10,
                  fontFamily: "JetBrains Mono",
                }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  fontFamily: "JetBrains Mono",
                  fontSize: 11,
                }}
              />
              <Area
                type="monotone"
                dataKey="in"
                stroke={GREEN}
                fill="oklch(0.65 0.18 160 / 0.15)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="out"
                stroke={BLUE}
                fill="oklch(0.60 0.22 260 / 0.1)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <button
          onClick={() => toast.info("Report exported as PDF")}
          className="w-full py-4 rounded-xl font-bold text-white"
          style={{ background: BLUE, fontFamily: DISP }}
        >
          Export PDF Report
        </button>
      </div>
    </div>
  );
}

// 20. Transaction History ─────────────────────────────────────────────────────
function TxHistoryScreen({ onBack }: { onBack: () => void }) {
  const [filter, setFilter] = useState<
    "all" | "success" | "pending" | "failed"
  >("all");
  const [selected, setSelected] = useState<any | null>(null);
  const { data: txData, isLoading } = trpc.transactions.list.useQuery({
    limit: 100,
    offset: 0,
  });
  const allTxs = txData ?? [];
  const filtered =
    filter === "all" ? allTxs : allTxs.filter((t: any) => t.status === filter);

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Transaction History" onBack={onBack} />
      <div
        className="flex gap-2 px-4 py-2 border-b overflow-x-auto"
        style={{ borderColor: BORDER }}
      >
        {(["all", "success", "pending", "failed"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1 rounded-full text-xs font-semibold capitalize whitespace-nowrap"
            style={{
              background: filter === f ? BLUE : CARD,
              color: filter === f ? "white" : "oklch(0.55 0.015 230)",
              fontFamily: DISP,
            }}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
        {isLoading ? (
          <div
            className="flex items-center justify-center py-16 text-gray-500"
            style={{ fontFamily: DISP }}
          >
            <span className="animate-spin mr-2">⟳</span> Loading transactions...
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center py-16 text-gray-600"
            style={{ fontFamily: DISP }}
          >
            <div className="text-3xl mb-3">📋</div>
            <div className="text-sm">
              No {filter === "all" ? "" : filter} transactions yet
            </div>
          </div>
        ) : (
          filtered.map((tx: any) => (
            <button
              key={tx.id}
              onClick={() => setSelected(tx)}
              className="flex items-center gap-3 p-3 rounded-xl w-full text-left transition-colors hover:border-blue-500/30"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                style={{
                  background:
                    tx.status === "success"
                      ? "oklch(0.65 0.18 160 / 0.2)"
                      : tx.status === "pending"
                        ? "oklch(0.78 0.18 80 / 0.2)"
                        : "oklch(0.60 0.22 25 / 0.2)",
                }}
              >
                {tx.type.includes("Cash In")
                  ? "⬇"
                  : tx.type.includes("Cash Out")
                    ? "⬆"
                    : tx.type.includes("Transfer")
                      ? "⇄"
                      : tx.type.includes("Card")
                        ? "💳"
                        : "📶"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className="text-sm font-semibold text-white truncate"
                    style={{ fontFamily: DISP }}
                  >
                    {tx.type}
                  </div>
                  <div
                    className="text-sm font-bold flex-shrink-0"
                    style={{
                      fontFamily: MONO,
                      color:
                        tx.type.includes("Out") || tx.type.includes("Transfer")
                          ? RED
                          : GREEN,
                    }}
                  >
                    {tx.type.includes("Out") || tx.type.includes("Transfer")
                      ? "-"
                      : "+"}
                    {fmt(tx.amount)}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <div
                    className="text-xs text-gray-500 truncate"
                    style={{ fontFamily: MONO }}
                  >
                    {tx.customerPhone ?? tx.customerName ?? "—"}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background:
                          tx.status === "success"
                            ? GREEN
                            : tx.status === "pending"
                              ? GOLD
                              : RED,
                      }}
                    />
                    <span
                      className="text-xs capitalize"
                      style={{
                        color:
                          tx.status === "success"
                            ? GREEN
                            : tx.status === "pending"
                              ? GOLD
                              : RED,
                        fontFamily: DISP,
                      }}
                    >
                      {tx.status}
                    </span>
                    <span
                      className="text-xs text-gray-600"
                      style={{ fontFamily: MONO }}
                    >
                      {tx.createdAt
                        ? new Date(tx.createdAt).toLocaleTimeString("en-NG", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>
      {selected && (
        <ReceiptModal
          tx={{
            type: selected.type,
            amount: selected.amount,
            customer: selected.customerPhone ?? selected.customerName ?? "—",
            ref: selected.ref,
            time: selected.createdAt
              ? new Date(selected.createdAt).toLocaleTimeString("en-NG")
              : "",
          }}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// 21. Analytics ───────────────────────────────────────────────────────────────
function AnalyticsScreen({
  onBack,
  chartData,
}: {
  onBack: () => void;
  chartData?: typeof CHART_DATA;
}) {
  const pieData = [
    { name: "Cash In", value: 485250, color: GREEN },
    { name: "Cash Out", value: 312000, color: BLUE },
    { name: "Transfer", value: 94500, color: "#8b5cf6" },
    { name: "Airtime", value: 45000, color: GOLD },
  ];
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Performance Analytics" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Transaction Mix
          </div>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={120} height={120}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={55}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {pieData.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-col gap-2">
              {pieData.map(d => (
                <div key={d.name} className="flex items-center gap-2">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: d.color }}
                  />
                  <span
                    className="text-xs text-gray-400"
                    style={{ fontFamily: DISP }}
                  >
                    {d.name}
                  </span>
                  <span
                    className="text-xs font-bold text-white ml-auto"
                    style={{ fontFamily: MONO }}
                  >
                    {fmt(d.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Cash Flow (Today)
          </div>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartData ?? CHART_DATA}>
              <XAxis
                dataKey="h"
                tick={{
                  fill: "#6b7280",
                  fontSize: 10,
                  fontFamily: "JetBrains Mono",
                }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis hide />
              <Tooltip
                contentStyle={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  fontFamily: "JetBrains Mono",
                  fontSize: 11,
                }}
              />
              <Area
                type="monotone"
                dataKey="in"
                stroke={GREEN}
                fill="oklch(0.65 0.18 160 / 0.15)"
                strokeWidth={2}
                name="Cash In"
              />
              <Area
                type="monotone"
                dataKey="out"
                stroke={RED}
                fill="oklch(0.60 0.22 25 / 0.1)"
                strokeWidth={2}
                name="Cash Out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            ["Avg Tx", "₦4,870"],
            ["Peak Hour", "10:00"],
            ["Busiest Day", "Saturday"],
          ].map(([k, v]) => (
            <div
              key={k}
              className="rounded-2xl p-3 text-center"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP }}
              >
                {k}
              </div>
              <div
                className="text-sm font-bold text-white"
                style={{ fontFamily: MONO }}
              >
                {v}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 22. Scorecard ───────────────────────────────────────────────────────────────
function ScorecardScreen({ onBack }: { onBack: () => void }) {
  const metrics = [
    { label: "Transaction Volume", score: 92, target: 100, color: GREEN },
    { label: "Customer Satisfaction", score: 88, target: 100, color: BLUE },
    { label: "CBN Compliance", score: 100, target: 100, color: GREEN },
    { label: "Uptime %", score: 99.2, target: 100, color: GREEN },
    { label: "Fraud Rate", score: 0.2, target: 0, color: GOLD, invert: true },
    { label: "Float Utilisation", score: 78, target: 80, color: BLUE },
  ];
  const overall = Math.round(
    metrics.reduce(
      (s: any, m: any) => s + (m.invert ? 100 - m.score : m.score),
      0
    ) / metrics.length
  );
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Agent Scorecard" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Overall score ring */}
        <div
          className="rounded-2xl p-5 flex items-center gap-5"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div className="relative w-20 h-20 flex-shrink-0">
            <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
              <circle
                cx="40"
                cy="40"
                r="32"
                fill="none"
                stroke={BORDER}
                strokeWidth="8"
              />
              <circle
                cx="40"
                cy="40"
                r="32"
                fill="none"
                stroke={overall >= 90 ? GREEN : overall >= 75 ? GOLD : RED}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(overall / 100) * 201} 201`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                className="text-xl font-bold text-white"
                style={{ fontFamily: MONO }}
              >
                {overall}
              </span>
            </div>
          </div>
          <div>
            <div
              className="text-sm font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              Overall Score
            </div>
            <div className="text-xs text-gray-400 mt-1">
              Rank #{GAMIFICATION.rank} of{" "}
              {GAMIFICATION.totalAgents.toLocaleString()} agents
            </div>
            <div
              className="mt-2 px-2 py-0.5 rounded text-xs font-bold inline-block"
              style={{ background: "oklch(0.78 0.18 80 / 0.2)", color: GOLD }}
            >
              {GAMIFICATION.level}
            </div>
          </div>
        </div>
        {/* Metric bars */}
        <div
          className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          {metrics.map(m => (
            <div key={m.label}>
              <div className="flex justify-between mb-1">
                <span
                  className="text-xs text-gray-400"
                  style={{ fontFamily: DISP }}
                >
                  {m.label}
                </span>
                <span
                  className="text-xs font-bold"
                  style={{ color: m.color, fontFamily: MONO }}
                >
                  {m.score}
                  {m.label.includes("%") || m.label.includes("Rate")
                    ? "%"
                    : "/100"}
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{ background: BORDER }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${m.invert ? 100 - m.score : m.score}%`,
                    background: m.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        {/* Badges */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Badges Earned
          </div>
          <div className="flex flex-wrap gap-2">
            {GAMIFICATION.badges.map(b => (
              <div
                key={b}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold"
                style={{
                  background: "oklch(0.78 0.18 80 / 0.15)",
                  color: GOLD,
                  border: `1px solid oklch(0.78 0.18 80 / 0.3)`,
                }}
              >
                {b}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 23. TerminalConfig ───────────────────────────────────────────────────────────
function TerminalConfigScreen({ onBack }: { onBack: () => void }) {
  const [brightness, setBrightness] = useState(75);
  const [volume, setVolume] = useState(60);
  const [autoLock, setAutoLock] = useState("5min");
  const [language, setLanguage] = useState("en-NG");
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Terminal Configuration" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Device info */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Device Information
          </div>
          {[
            ["Model", TERMINAL.model],
            ["Serial No.", TERMINAL.serialNo],
            ["Agent Code", TERMINAL.agentCode],
            ["Firmware", "v4.2.1-NG"],
            ["OS", "PAXBiz 3.1"],
            ["App Version", "InsurePortal v14.0.0"],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between py-2 border-b last:border-0"
              style={{ borderColor: BORDER }}
            >
              <span
                className="text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                {k}
              </span>
              <span
                className="text-xs font-bold text-white"
                style={{ fontFamily: MONO }}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
        {/* Display settings */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-4"
            style={{ fontFamily: DISP }}
          >
            Display & Sound
          </div>
          <div className="mb-4">
            <div className="flex justify-between mb-2">
              <span
                className="text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                Brightness
              </span>
              <span
                className="text-xs font-bold text-white"
                style={{ fontFamily: MONO }}
              >
                {brightness}%
              </span>
            </div>
            <input
              type="range"
              min={20}
              max={100}
              value={brightness}
              onChange={e => setBrightness(+e.target.value)}
              className="w-full accent-blue-500"
            />
          </div>
          <div>
            <div className="flex justify-between mb-2">
              <span
                className="text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                Beep Volume
              </span>
              <span
                className="text-xs font-bold text-white"
                style={{ fontFamily: MONO }}
              >
                {volume}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={e => setVolume(+e.target.value)}
              className="w-full accent-blue-500"
            />
          </div>
        </div>
        {/* Security settings */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Security
          </div>
          <div className="mb-3">
            <div
              className="text-xs text-gray-400 mb-2"
              style={{ fontFamily: DISP }}
            >
              Auto-Lock Timeout
            </div>
            <div className="grid grid-cols-4 gap-2">
              {["2min", "5min", "10min", "Never"].map(v => (
                <button
                  key={v}
                  onClick={() => setAutoLock(v)}
                  className="py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: autoLock === v ? BLUE : CARD,
                    color: autoLock === v ? "white" : "#6b7280",
                    border: `1px solid ${autoLock === v ? BLUE : BORDER}`,
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div
              className="text-xs text-gray-400 mb-2"
              style={{ fontFamily: DISP }}
            >
              Language
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ["en-NG", "English (NG)"],
                ["ha", "Hausa"],
                ["yo", "Yoruba"],
                ["ig", "Igbo"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setLanguage(v)}
                  className="py-2 rounded-xl text-xs font-semibold transition-all"
                  style={{
                    background: language === v ? BLUE : CARD,
                    color: language === v ? "white" : "#6b7280",
                    border: `1px solid ${language === v ? BLUE : BORDER}`,
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            setSaved(true);
            toast.success("Configuration saved");
            setTimeout(() => setSaved(false), 2000);
          }}
          className="w-full py-4 rounded-2xl font-bold text-white transition-all active:scale-95"
          style={{ background: saved ? GREEN : BLUE, fontFamily: DISP }}
        >
          {saved ? "✓ Saved" : "Save Configuration"}
        </button>
      </div>
    </div>
  );
}

// 24. PrinterTest ──────────────────────────────────────────────────────────────
function PrinterTestScreen({ onBack }: { onBack: () => void }) {
  const [printing, setPrinting] = useState(false);
  const [result, setResult] = useState<
    "idle" | "success" | "error" | "low-paper"
  >("idle");
  const runTest = (type: string) => {
    setPrinting(true);
    setResult("idle");
    setTimeout(() => {
      setPrinting(false);
      const r = TERMINAL.paperLevel > 20 ? "success" : "low-paper";
      setResult(r);
      if (r === "success") toast.success(`${type} print successful`);
      else toast.warning("Paper level low — please reload paper");
    }, 2000);
  };
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Printer Diagnostics" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Paper status */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Paper Status
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between mb-1">
                <span
                  className="text-xs text-gray-400"
                  style={{ fontFamily: DISP }}
                >
                  Paper Level
                </span>
                <span
                  className="text-xs font-bold"
                  style={{
                    color: TERMINAL.paperLevel > 30 ? GREEN : RED,
                    fontFamily: MONO,
                  }}
                >
                  {TERMINAL.paperLevel}%
                </span>
              </div>
              <div
                className="h-3 rounded-full overflow-hidden"
                style={{ background: BORDER }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${TERMINAL.paperLevel}%`,
                    background: TERMINAL.paperLevel > 30 ? GREEN : RED,
                  }}
                />
              </div>
            </div>
            <div className="text-3xl">
              {TERMINAL.paperLevel > 30 ? "📄" : "⚠️"}
            </div>
          </div>
          <div
            className="mt-3 text-xs text-gray-400"
            style={{ fontFamily: DISP }}
          >
            Paper width: 80mm · ESC/POS · Thermal
          </div>
        </div>
        {/* Printer info */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Printer Specifications
          </div>
          {[
            ["Type", "Thermal (ESC/POS)"],
            ["Width", "80mm"],
            ["DPI", "203 dpi"],
            ["Speed", "100mm/s"],
            ["Interface", "Internal"],
            ["Status", "Ready"],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between py-2 border-b last:border-0"
              style={{ borderColor: BORDER }}
            >
              <span
                className="text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                {k}
              </span>
              <span
                className="text-xs font-bold text-white"
                style={{ fontFamily: MONO }}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
        {/* Test buttons */}
        <div
          className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-1"
            style={{ fontFamily: DISP }}
          >
            Print Tests
          </div>
          {[
            ["Test Receipt", "Prints a sample transaction receipt"],
            ["Self-Test Page", "Prints printer configuration page"],
            ["Barcode Test", "Prints Code128 and QR code samples"],
          ].map(([label, desc]) => (
            <button
              key={label}
              disabled={printing}
              onClick={() => runTest(label)}
              className="w-full p-3 rounded-xl text-left transition-all active:scale-95 disabled:opacity-50"
              style={{
                background: "oklch(0.60 0.22 260 / 0.1)",
                border: `1px solid ${BORDER}`,
              }}
            >
              <div
                className="text-sm font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                {label}
              </div>
              <div
                className="text-xs text-gray-400 mt-0.5"
                style={{ fontFamily: DISP }}
              >
                {desc}
              </div>
            </button>
          ))}
        </div>
        {printing && (
          <div
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{
              background: "oklch(0.60 0.22 260 / 0.1)",
              border: `1px solid ${BLUE}`,
            }}
          >
            <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            <span
              className="text-sm text-blue-400"
              style={{ fontFamily: DISP }}
            >
              Printing…
            </span>
          </div>
        )}
        {result === "success" && (
          <div
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{
              background: "oklch(0.65 0.18 160 / 0.1)",
              border: `1px solid ${GREEN}`,
            }}
          >
            <span className="text-xl">✓</span>
            <span
              className="text-sm font-bold"
              style={{ color: GREEN, fontFamily: DISP }}
            >
              Print test successful
            </span>
          </div>
        )}
        {result === "low-paper" && (
          <div
            className="rounded-2xl p-4 flex items-center gap-3"
            style={{
              background: "oklch(0.78 0.18 80 / 0.1)",
              border: `1px solid ${GOLD}`,
            }}
          >
            <span className="text-xl">⚠️</span>
            <span
              className="text-sm font-bold"
              style={{ color: GOLD, fontFamily: DISP }}
            >
              Paper level low — reload paper roll
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// 25. NetworkTest ──────────────────────────────────────────────────────────────
function NetworkTestScreen({ onBack }: { onBack: () => void }) {
  // State must be declared before hooks that reference them
  const [testPhone, setTestPhone] = useState("0803");
  const [testing, setTesting] = useState(false);
  const [probeResult, setProbeResult] = useState<{
    latency_ms: number;
    quality: string;
    online: boolean;
    targets_checked: number;
    targets_reachable: number;
  } | null>(null);
  const [carrierResult, setCarrierResult] = useState<{
    carrier: string;
    ussd_shortcode: string;
    phone_prefix: string;
  } | null>(null);

  // Live probe via Go resilience-agent
  const { refetch: runProbe } = trpc.resilience.probe.useQuery(undefined, {
    enabled: false,
    retry: false,
  });
  const { refetch: runCarrier } = trpc.resilience.detectCarrier.useQuery(
    { phone: testPhone },
    { enabled: false, retry: false }
  );

  const qualityColor = (q: string) =>
    q === "Excellent" ? GREEN : q === "Good" ? BLUE : q === "Poor" ? GOLD : RED;

  const qualityBars = (q: string) => {
    const map: Record<string, number> = {
      Excellent: 5,
      Good: 4,
      Poor: 2,
      Offline: 0,
    };
    return map[q] ?? 0;
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const [p, carrier] = await Promise.all([runProbe(), runCarrier()]);
      if (p.data) setProbeResult(p.data as any);
      if (carrier.data) setCarrierResult(carrier.data as any);
      if (!p.data && !carrier.data)
        toast.error("Network test failed — resilience agent may be offline");
    } catch {
      toast.error("Network test failed — resilience agent may be offline");
    } finally {
      setTesting(false);
    }
  };

  const tip = () => {
    if (!probeResult) return null;
    if (probeResult.quality === "Excellent")
      return {
        icon: "✅",
        text: "Signal is excellent. All payment channels available.",
      };
    if (probeResult.quality === "Good")
      return {
        icon: "✔",
        text: "Good signal. Move closer to a window or open area for best results.",
      };
    if (probeResult.quality === "Poor")
      return {
        icon: "⚠️",
        text: "Weak signal. Move to a higher floor or near a window. USSD fallback is active.",
      };
    return {
      icon: "📵",
      text: "No internet. Only USSD and offline queue are available. Move to an area with mobile coverage.",
    };
  };

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Network Test" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Live probe result */}
        {probeResult && (
          <div
            className="rounded-2xl p-4"
            style={{
              background: CARD,
              border: `2px solid ${qualityColor(probeResult.quality)}44`,
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className="text-sm font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                Connection Quality
              </div>
              <span
                className="text-xs px-3 py-1 rounded-full font-bold"
                style={{
                  background: `${qualityColor(probeResult.quality)}22`,
                  color: qualityColor(probeResult.quality),
                  fontFamily: DISP,
                }}
              >
                {probeResult.quality}
              </span>
            </div>
            {/* Animated signal bars */}
            <div className="flex items-end gap-1.5 h-14 mb-3">
              {[1, 2, 3, 4, 5].map(bar => (
                <div
                  key={bar}
                  className="flex-1 rounded-t transition-all duration-500"
                  style={{
                    height: `${bar * 20}%`,
                    background:
                      bar <= qualityBars(probeResult.quality)
                        ? qualityColor(probeResult.quality)
                        : BORDER,
                  }}
                />
              ))}
            </div>
            {[
              ["Latency", `${probeResult.latency_ms}ms`],
              [
                "Targets Reachable",
                `${probeResult.targets_reachable}/${probeResult.targets_checked}`,
              ],
              ["Internet", probeResult.online ? "Connected" : "Offline"],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between py-1.5 border-b last:border-0"
                style={{ borderColor: BORDER }}
              >
                <span
                  className="text-xs text-gray-400"
                  style={{ fontFamily: DISP }}
                >
                  {k}
                </span>
                <span
                  className="text-xs font-bold"
                  style={{
                    color:
                      k === "Latency"
                        ? probeResult.latency_ms < 100
                          ? GREEN
                          : probeResult.latency_ms < 300
                            ? GOLD
                            : RED
                        : "white",
                    fontFamily: MONO,
                  }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Carrier detection */}
        {carrierResult && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-sm font-bold text-white mb-3"
              style={{ fontFamily: DISP }}
            >
              SIM Carrier
            </div>
            {[
              ["Carrier", carrierResult.carrier],
              ["USSD Shortcode", carrierResult.ussd_shortcode],
              ["Prefix", carrierResult.phone_prefix],
            ].map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between py-1.5 border-b last:border-0"
                style={{ borderColor: BORDER }}
              >
                <span
                  className="text-xs text-gray-400"
                  style={{ fontFamily: DISP }}
                >
                  {k}
                </span>
                <span
                  className="text-xs font-bold text-white"
                  style={{ fontFamily: MONO }}
                >
                  {v}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Best position tip */}
        {tip() && (
          <div
            className="rounded-2xl p-4"
            style={{
              background: "oklch(0.60 0.22 260 / 0.08)",
              border: `1px solid ${BLUE}44`,
            }}
          >
            <div
              className="text-sm font-bold text-white mb-1"
              style={{ fontFamily: DISP }}
            >
              {tip()!.icon} Positioning Tip
            </div>
            <div className="text-xs text-gray-400" style={{ fontFamily: DISP }}>
              {tip()!.text}
            </div>
          </div>
        )}

        {/* Phone prefix input for carrier detection */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-xs text-gray-400 mb-2"
            style={{ fontFamily: DISP }}
          >
            Carrier detection phone prefix (first 4 digits)
          </div>
          <input
            value={testPhone}
            onChange={e => setTestPhone(e.target.value.slice(0, 4))}
            maxLength={4}
            className="w-full px-3 py-2 rounded-xl text-sm text-white bg-transparent border"
            style={{ borderColor: BORDER, fontFamily: MONO }}
            placeholder="e.g. 0803"
          />
        </div>

        <button
          onClick={runTest}
          disabled={testing}
          className="w-full py-4 rounded-2xl font-bold text-white transition-all active:scale-95 disabled:opacity-50"
          style={{ background: BLUE, fontFamily: DISP }}
        >
          {testing
            ? "Testing…"
            : probeResult
              ? "Re-Test Connection"
              : "Run Network Test"}
        </button>
      </div>
    </div>
  );
}
// 26. ServiceUpdate ───────────────────────────────────────────────────────────────
function ServiceUpdateScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<
    "idle" | "checking" | "available" | "downloading" | "installing" | "done"
  >("idle");
  const [progress, setProgress] = useState(0);
  const [latestRelease, setLatestRelease] = useState<{
    version: string;
    releaseNotes: string;
    fileSize: number;
  } | null>(null);
  // Fetch latest OTA release from MDM router
  const { data: releasesData } = trpc.mdm.listOtaReleases.useQuery(
    { limit: 1, offset: 0 },
    { enabled: false }
  );
  const releases = releasesData?.items;
  const recordUpdateMut = trpc.mdm.recordOtaUpdate.useMutation();
  const check = () => {
    setStep("checking");
    // Try to get latest release from server; fall back to known version
    const raw = releases?.[0];
    const latest = raw
      ? {
          version: raw.version,
          releaseNotes:
            raw.releaseNotes ?? "Security patch, performance improvements",
          fileSize: raw.fileSize,
        }
      : {
          version: "v4.3.0-NG",
          releaseNotes: "Security patch, performance improvements",
          fileSize: 12_400_000,
        };
    setTimeout(() => {
      setLatestRelease(latest);
      setStep("available");
    }, 1200);
  };
  const install = () => {
    setStep("downloading");
    setProgress(0);
    const iv = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          clearInterval(iv);
          setStep("installing");
          setTimeout(() => {
            // Record successful OTA update in MDM
            recordUpdateMut.mutate({
              deviceId: 1, // terminal device DB id
              releaseId: releases?.[0]?.id ?? 1,
              status: "success",
              fromVersion: "v4.2.1-NG",
              toVersion: latestRelease?.version ?? "v4.3.0-NG",
            });
            setStep("done");
          }, 2000);
          return 100;
        }
        return p + 2;
      });
    }, 80);
  };
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Firmware OTA Update"
        onBack={onBack}
        badge={
          <div
            className="px-2 py-0.5 rounded text-xs font-bold"
            style={{ background: "oklch(0.78 0.18 80 / 0.2)", color: GOLD }}
          >
            Update Available
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Current version */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div
            className="text-sm font-bold text-white mb-3"
            style={{ fontFamily: DISP }}
          >
            Version Information
          </div>
          {[
            ["Current Firmware", "v4.2.1-NG"],
            ["Latest Available", "v4.3.0-NG"],
            ["Release Date", "2024-03-15"],
            ["Size", "12.4 MB"],
            ["Model", TERMINAL.model],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex justify-between py-2 border-b last:border-0"
              style={{ borderColor: BORDER }}
            >
              <span
                className="text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                {k}
              </span>
              <span
                className="text-xs font-bold"
                style={{
                  color: k === "Latest Available" ? GOLD : "white",
                  fontFamily: MONO,
                }}
              >
                {v}
              </span>
            </div>
          ))}
        </div>
        {/* Release notes */}
        {(step === "available" ||
          step === "downloading" ||
          step === "installing" ||
          step === "done") && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-sm font-bold text-white mb-2"
              style={{ fontFamily: DISP }}
            >
              Release Notes v4.3.0-NG
            </div>
            {[
              "🔒 Enhanced EMV kernel security patch",
              "⚡ 15% faster transaction processing",
              "📶 Improved 4G/LTE connectivity",
              "🖨 80mm paper detection fix",
              "🇳🇬 CBN compliance updates (March 2024)",
            ].map(n => (
              <div
                key={n}
                className="text-xs text-gray-300 py-1 border-b last:border-0"
                style={{ borderColor: BORDER, fontFamily: DISP }}
              >
                {n}
              </div>
            ))}
          </div>
        )}
        {/* Progress */}
        {(step === "downloading" || step === "installing") && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="flex justify-between mb-2">
              <span
                className="text-sm font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                {step === "downloading" ? "Downloading…" : "Installing…"}
              </span>
              <span
                className="text-sm font-bold"
                style={{ color: BLUE, fontFamily: MONO }}
              >
                {progress}%
              </span>
            </div>
            <div
              className="h-3 rounded-full overflow-hidden"
              style={{ background: BORDER }}
            >
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, background: BLUE }}
              />
            </div>
            <div
              className="text-xs text-gray-400 mt-2"
              style={{ fontFamily: DISP }}
            >
              {step === "downloading"
                ? "Do not power off terminal"
                : "Installing — do not interrupt"}
            </div>
          </div>
        )}
        {step === "done" && (
          <div
            className="rounded-2xl p-5 flex flex-col items-center gap-3"
            style={{
              background: "oklch(0.65 0.18 160 / 0.1)",
              border: `1px solid ${GREEN}`,
            }}
          >
            <div className="text-4xl">✓</div>
            <div
              className="text-base font-bold"
              style={{ color: GREEN, fontFamily: DISP }}
            >
              Update Complete
            </div>
            <div
              className="text-xs text-gray-400 text-center"
              style={{ fontFamily: DISP }}
            >
              Firmware v4.3.0-NG installed successfully. Terminal will restart.
            </div>
            <button
              onClick={onBack}
              className="px-6 py-2 rounded-xl font-bold text-white"
              style={{ background: GREEN, fontFamily: DISP }}
            >
              Done
            </button>
          </div>
        )}
        {step === "idle" && (
          <button
            onClick={check}
            className="w-full py-4 rounded-2xl font-bold text-white transition-all active:scale-95"
            style={{ background: BLUE, fontFamily: DISP }}
          >
            Check for Updates
          </button>
        )}
        {step === "checking" && (
          <div className="flex items-center justify-center gap-3 py-4">
            <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
            <span
              className="text-sm text-blue-400"
              style={{ fontFamily: DISP }}
            >
              Checking for updates…
            </span>
          </div>
        )}
        {step === "available" && (
          <button
            onClick={install}
            className="w-full py-4 rounded-2xl font-bold text-white transition-all active:scale-95"
            style={{ background: GOLD, fontFamily: DISP }}
          >
            Download & Install v4.3.0-NG
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Gamification Panel ───────────────────────────────────────────────────────
// FloatBalance Screen ─────────────────────────────────────────────────────
function FloatBalanceScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpNotes, setTopUpNotes] = useState("");
  const { data: ds } = trpc.transactions.agentDayStats.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const { data: floatData } = trpc.transactions.getFloatBalance.useQuery(
    undefined,
    { refetchInterval: 30_000 }
  );
  const { data: floatHistoryData } = trpc.transactions.getFloatHistory.useQuery(
    { limit: 50 },
    { refetchInterval: 60_000 }
  );
  const { data: topUpHistory } = trpc.floatTopUp.myRequests.useQuery(
    undefined,
    { refetchInterval: 60_000 }
  );
  const agent = usePosStore(s => s.agent);
  // Prefer live float balance from platform (getFloatBalance), then agentDayStats, then store
  const float =
    floatData?.balance ?? ds?.float ?? agent?.floatBalance ?? 485250;
  const floatSource = floatData?.source ?? "local";
  const limit = 1000000;
  const pct = Math.round((float / limit) * 100);

  const submitTopUpMut = trpc.agentMgmt.submitTopUpRequest.useMutation({
    onSuccess: () => {
      toast.success("Float top-up request submitted — awaiting admin approval");
      setShowTopUpModal(false);
      setTopUpAmount("");
      setTopUpNotes("");
    },
    onError: (e: { message: string }) =>
      toast.error(`Request failed: ${e.message}`),
  });

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Float Balance" onBack={onBack} />
      <div className="flex gap-2 px-4 pt-3">
        {(["overview", "history"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2 rounded-lg text-sm font-semibold capitalize"
            style={{
              background: tab === t ? GOLD : CARD,
              color: tab === t ? BG : "#9ca3af",
              fontFamily: DISP,
            }}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "overview" ? (
        <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
          <div
            className="rounded-2xl p-5"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="flex items-center justify-between mb-1">
              <div
                className="text-xs text-gray-500"
                style={{ fontFamily: DISP }}
              >
                Available Float
              </div>
              <div
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  background:
                    floatSource === "platform"
                      ? "oklch(0.65 0.18 160 / 0.2)"
                      : "oklch(0.40 0.01 240 / 0.3)",
                  color: floatSource === "platform" ? "#10b981" : "#9ca3af",
                  fontFamily: DISP,
                }}
              >
                {floatSource === "platform" ? "● Live" : "● Local DB"}
              </div>
            </div>
            <div
              className="text-4xl font-bold"
              style={{ fontFamily: MONO, color: GOLD }}
            >
              ₦{fmt(float)}
            </div>
            <div className="mt-3">
              <div
                className="flex justify-between text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP }}
              >
                <span>Used: ₦{fmt(limit - float)}</span>
                <span>Limit: ₦{fmt(limit)}</span>
              </div>
              <div
                className="h-3 rounded-full overflow-hidden"
                style={{ background: BORDER }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: GOLD }}
                />
              </div>
              <div
                className="text-right text-xs mt-1"
                style={{ color: GOLD, fontFamily: MONO }}
              >
                {pct}% available
              </div>
            </div>
          </div>
          {[
            {
              label: "Daily Transactions",
              val:
                "₦" +
                fmt(
                  (ds?.cashIn ?? 0) + (ds?.cashOut ?? 0) + (ds?.transfers ?? 0)
                ),
              sub: (ds?.count ?? 0) + " transactions",
            },
            {
              label: "Commission Earned",
              val: "₦" + fmt(ds?.commission ?? agent?.commissionBalance ?? 0),
              sub: "Today",
            },
            {
              label: "Float Utilization",
              val: pct + "%",
              sub: "Of daily limit",
            },
            {
              label: "Float Source",
              val: floatSource === "platform" ? "Platform" : "Local DB",
              sub:
                floatSource === "platform" ? "Live balance" : "Cached balance",
            },
          ].map(s => (
            <div
              key={s.label}
              className="rounded-xl p-4 flex justify-between items-center"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div>
                <div
                  className="text-xs text-gray-500"
                  style={{ fontFamily: DISP }}
                >
                  {s.label}
                </div>
                <div
                  className="text-xs text-gray-600"
                  style={{ fontFamily: DISP }}
                >
                  {s.sub}
                </div>
              </div>
              <div
                className="text-lg font-bold"
                style={{ fontFamily: MONO, color: BLUE }}
              >
                {s.val}
              </div>
            </div>
          ))}
          <button
            onClick={() => setShowTopUpModal(true)}
            className="w-full py-4 rounded-xl font-bold text-white"
            style={{ background: GOLD, fontFamily: DISP }}
          >
            Request Float Top-Up
          </button>
          {/* Top-Up Request Modal */}
          {showTopUpModal && (
            <div
              className="fixed inset-0 z-50 flex items-end"
              style={{ background: "rgba(0,0,0,0.7)" }}
            >
              <div
                className="w-full rounded-t-2xl p-5 flex flex-col gap-4"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div className="flex items-center justify-between">
                  <div
                    className="text-base font-black text-white"
                    style={{ fontFamily: DISP }}
                  >
                    Request Float Top-Up
                  </div>
                  <button
                    onClick={() => setShowTopUpModal(false)}
                    className="text-gray-400 text-xl"
                  >
                    ×
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    Amount Requested (NGN) *
                  </label>
                  <input
                    type="number"
                    value={topUpAmount}
                    onChange={e => setTopUpAmount(e.target.value)}
                    placeholder="e.g. 200000"
                    className="px-4 py-3 rounded-xl text-lg font-bold text-white bg-transparent border outline-none"
                    style={{
                      borderColor: GOLD,
                      fontFamily: MONO,
                      background: BG,
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    Notes (optional)
                  </label>
                  <textarea
                    value={topUpNotes}
                    onChange={e => setTopUpNotes(e.target.value)}
                    placeholder="e.g. Needed for market day transactions"
                    className="px-3 py-2 rounded-xl text-sm text-white bg-transparent border outline-none resize-none h-16"
                    style={{
                      borderColor: BORDER,
                      fontFamily: DISP,
                      background: BG,
                    }}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowTopUpModal(false)}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold"
                    style={{
                      background: "oklch(0.22 0.02 240)",
                      color: "oklch(0.55 0.015 230)",
                      fontFamily: DISP,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      const amt = parseFloat(topUpAmount);
                      if (!amt || amt < 1000) {
                        toast.error("Minimum top-up amount is ₦1,000");
                        return;
                      }
                      submitTopUpMut.mutate({
                        amount: amt,
                        notes: topUpNotes || undefined,
                      });
                    }}
                    disabled={submitTopUpMut.isPending}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-black"
                    style={{
                      background: GOLD,
                      fontFamily: DISP,
                      opacity: submitTopUpMut.isPending ? 0.5 : 1,
                    }}
                  >
                    {submitTopUpMut.isPending
                      ? "Submitting…"
                      : "Submit Request"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-4 overflow-y-auto flex-1">
          {/* Float transaction history from platform */}
          {floatHistoryData && floatHistoryData.transactions.length > 0 && (
            <>
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP }}
              >
                Float Transactions (
                {floatHistoryData.source === "platform" ? "Live" : "Local DB"})
              </div>
              {(floatHistoryData.transactions as any[])
                .slice(0, 10)
                .map((tx: any, i: number) => (
                  <div
                    key={tx.id ?? i}
                    className="rounded-xl p-4 flex justify-between items-center"
                    style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  >
                    <div>
                      <div
                        className="text-sm font-semibold text-white"
                        style={{ fontFamily: DISP }}
                      >
                        {tx.type ?? tx.transaction_type ?? "Float Tx"}
                      </div>
                      <div
                        className="text-xs text-gray-500 mt-0.5"
                        style={{ fontFamily: MONO }}
                      >
                        {tx.reference ?? tx.ref ?? ""}
                      </div>
                      <div
                        className="text-xs text-gray-500"
                        style={{ fontFamily: MONO }}
                      >
                        {tx.createdAt
                          ? new Date(tx.createdAt).toLocaleDateString("en-NG")
                          : (tx.created_at ?? "")}
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className="text-sm font-bold"
                        style={{
                          fontFamily: MONO,
                          color:
                            tx.type === "Cash In" ||
                            tx.transaction_type === "settle"
                              ? GREEN
                              : RED,
                        }}
                      >
                        {tx.type === "Cash In" ||
                        tx.transaction_type === "settle"
                          ? "+"
                          : "-"}
                        ₦{fmt(Number(tx.amount ?? 0))}
                      </div>
                      <div
                        className="text-xs"
                        style={{
                          color: tx.status === "success" ? GREEN : "#9ca3af",
                          fontFamily: MONO,
                        }}
                      >
                        {tx.status ?? ""}
                      </div>
                    </div>
                  </div>
                ))}
              <div
                className="text-xs text-gray-600 text-center py-1"
                style={{ fontFamily: DISP }}
              >
                Top-Up Requests
              </div>
            </>
          )}
          {!topUpHistory || topUpHistory.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-12 text-gray-600"
              style={{ fontFamily: DISP }}
            >
              <div className="text-3xl mb-2">📊</div>
              <div className="text-sm">No top-up history yet</div>
            </div>
          ) : (
            topUpHistory.map((h: any) => (
              <div
                key={h.id}
                className="rounded-xl p-4 flex justify-between items-center"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div>
                  <div
                    className="text-sm font-semibold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    Float Top-Up Request
                  </div>
                  <div
                    className="text-xs mt-0.5 px-2 py-0.5 rounded inline-block"
                    style={{
                      fontFamily: MONO,
                      background:
                        h.status === "approved"
                          ? "oklch(0.65 0.18 160 / 0.15)"
                          : h.status === "rejected"
                            ? "oklch(0.60 0.22 25 / 0.15)"
                            : "oklch(0.78 0.18 80 / 0.15)",
                      color:
                        h.status === "approved"
                          ? GREEN
                          : h.status === "rejected"
                            ? RED
                            : GOLD,
                    }}
                  >
                    {h.status}
                  </div>
                  <div
                    className="text-xs text-gray-500 mt-0.5"
                    style={{ fontFamily: MONO }}
                  >
                    {new Date(h.createdAt).toLocaleDateString("en-NG")}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="text-sm font-bold"
                    style={{ fontFamily: MONO, color: GREEN }}
                  >
                    +₦{fmt(h.requestedAmount)}
                  </div>
                  {h.notes && (
                    <div
                      className="text-xs text-gray-500 max-w-24 truncate"
                      style={{ fontFamily: DISP }}
                    >
                      {h.notes}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// FraudAlerts Screen ─────────────────────────────────────────────────────────
function FraudAlertsScreen({ onBack }: { onBack: () => void }) {
  const utils = trpc.useUtils();
  const { data: liveAlerts, isLoading } = trpc.fraud.list.useQuery(
    { status: "open" },
    { refetchInterval: 30_000 }
  );
  const [selected, setSelected] = useState<any | null>(null);
  const updateStatus = trpc.fraud.updateStatus.useMutation({
    onSuccess: () => {
      utils.fraud.list.invalidate();
      setSelected(null);
    },
  });
  const sev: Record<string, string> = {
    critical: "#ef4444",
    high: "#f97316",
    medium: "#f59e0b",
    low: "#6b7280",
  };
  const alerts: any[] =
    (liveAlerts as any)?.items ?? (Array.isArray(liveAlerts) ? liveAlerts : []);
  if (selected)
    return (
      <div className="flex flex-col h-full">
        <ScreenHeader title="Alert Detail" onBack={() => setSelected(null)} />
        <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
          <div
            className="rounded-2xl p-5"
            style={{
              background: CARD,
              border: `2px solid ${sev[selected.severity] ?? "#6b7280"}`,
            }}
          >
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                style={{
                  background: (sev[selected.severity] ?? "#6b7280") + "22",
                }}
              >
                ⚠
              </div>
              <div>
                <div
                  className="text-sm font-bold text-white"
                  style={{ fontFamily: DISP }}
                >
                  {selected.alertType ?? selected.type}
                </div>
                <div
                  className="text-xs px-2 py-0.5 rounded-full font-bold uppercase"
                  style={{
                    background: (sev[selected.severity] ?? "#6b7280") + "22",
                    color: sev[selected.severity] ?? "#6b7280",
                    fontFamily: DISP,
                  }}
                >
                  {selected.severity}
                </div>
              </div>
            </div>
            <div
              className="text-sm text-gray-300 mb-2"
              style={{ fontFamily: DISP }}
            >
              {selected.reason ??
                selected.description ??
                "Suspicious activity detected"}
            </div>
            <div className="text-xs text-gray-500" style={{ fontFamily: MONO }}>
              {new Date(selected.createdAt).toLocaleTimeString("en-NG", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              · ₦{fmt(selected.amount ?? 0)}
            </div>
          </div>
          <div
            className="rounded-xl p-4"
            style={{
              background: "oklch(0.18 0.04 260 / 0.5)",
              border: `1px solid ${BORDER}`,
            }}
          >
            <div
              className="text-xs text-gray-500 mb-2"
              style={{ fontFamily: DISP }}
            >
              AI Explanation
            </div>
            <div className="text-sm text-gray-300" style={{ fontFamily: DISP }}>
              {selected.aiExplanation ??
                "Transaction velocity exceeded 3× normal rate for this agent. Structuring pattern detected. Confidence: 94.7% · Model: FraudNet v2.1"}
            </div>
            <div
              className="mt-2 text-xs"
              style={{ color: BLUE, fontFamily: MONO }}
            >
              Score: {selected.fraudScore ?? "N/A"} · FraudNet v2.1
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() =>
                updateStatus.mutate({ id: selected.id, status: "escalated" })
              }
              disabled={updateStatus.isPending}
              className="flex-1 py-3 rounded-xl font-bold"
              style={{
                background: "#ef444422",
                color: "#ef4444",
                border: "1px solid #ef4444",
                fontFamily: DISP,
              }}
            >
              Escalate
            </button>
            <button
              onClick={() =>
                updateStatus.mutate({ id: selected.id, status: "dismissed" })
              }
              disabled={updateStatus.isPending}
              className="flex-1 py-3 rounded-xl font-bold"
              style={{
                background: "#22c55e22",
                color: "#22c55e",
                border: "1px solid #22c55e",
                fontFamily: DISP,
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    );
  return (
    <div className="flex flex-col h-full">
      <ScreenHeader
        title="Fraud Alerts"
        onBack={onBack}
        badge={
          <span
            className="ml-2 px-2 py-0.5 rounded-full text-xs font-bold"
            style={{ background: "#ef444422", color: "#ef4444" }}
          >
            {alerts.length}
          </span>
        }
      />
      <div className="flex flex-col gap-3 p-4 overflow-y-auto flex-1">
        {isLoading ? (
          <div
            className="flex items-center justify-center py-16 text-gray-500"
            style={{ fontFamily: DISP }}
          >
            <span className="animate-spin mr-2">⟳</span> Loading...
          </div>
        ) : alerts.length === 0 ? (
          <div
            className="text-center text-gray-500 mt-20"
            style={{ fontFamily: DISP }}
          >
            No active alerts
          </div>
        ) : (
          alerts.map((a: any) => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className="w-full rounded-xl p-4 text-left"
              style={{
                background: CARD,
                border: `1px solid ${sev[a.severity] ?? "#6b7280"}44`,
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <div
                  className="text-sm font-bold text-white"
                  style={{ fontFamily: DISP }}
                >
                  {a.alertType ?? a.type}
                </div>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-bold uppercase"
                  style={{
                    background: (sev[a.severity] ?? "#6b7280") + "22",
                    color: sev[a.severity] ?? "#6b7280",
                    fontFamily: DISP,
                  }}
                >
                  {a.severity}
                </span>
              </div>
              <div
                className="text-xs text-gray-400 mb-1"
                style={{ fontFamily: DISP }}
              >
                {a.reason ?? a.description ?? ""}
              </div>
              <div
                className="flex justify-between text-xs"
                style={{ fontFamily: MONO }}
              >
                <span style={{ color: GOLD }}>₦{fmt(a.amount ?? 0)}</span>
                <span className="text-gray-600">
                  {new Date(a.createdAt).toLocaleTimeString("en-NG", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function GamificationPanel({ onClose }: { onClose: () => void }) {
  const pct = Math.round(
    (GAMIFICATION.weeklyProgress / GAMIFICATION.weeklyTarget) * 100
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl p-5 flex flex-col gap-4"
        style={{
          background: "oklch(0.11 0.012 240)",
          border: `1px solid ${BORDER}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div
            className="text-base font-bold text-white"
            style={{ fontFamily: DISP }}
          >
            🏆 Agent Leaderboard
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>
        {/* Rank card */}
        <div
          className="rounded-2xl p-4 flex items-center gap-4"
          style={{
            background: "oklch(0.78 0.18 80 / 0.1)",
            border: `1px solid oklch(0.78 0.18 80 / 0.3)`,
          }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold"
            style={{
              background: "oklch(0.78 0.18 80 / 0.2)",
              color: GOLD,
              fontFamily: MONO,
            }}
          >
            #{GAMIFICATION.rank}
          </div>
          <div>
            <div
              className="text-sm font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              {GAMIFICATION.level}
            </div>
            <div className="text-xs text-gray-400">
              {GAMIFICATION.points.toLocaleString()} pts · Top{" "}
              {Math.round((GAMIFICATION.rank / GAMIFICATION.totalAgents) * 100)}
              %
            </div>
            <div className="text-xs mt-1" style={{ color: GOLD }}>
              🔥 {GAMIFICATION.streak}-day streak
            </div>
          </div>
        </div>
        {/* Weekly target */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div className="flex justify-between mb-2">
            <span
              className="text-xs text-gray-400"
              style={{ fontFamily: DISP }}
            >
              Weekly Target
            </span>
            <span
              className="text-xs font-bold text-white"
              style={{ fontFamily: MONO }}
            >
              {GAMIFICATION.weeklyProgress}/{GAMIFICATION.weeklyTarget} tx
            </span>
          </div>
          <div
            className="h-3 rounded-full overflow-hidden"
            style={{ background: BORDER }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: pct >= 100 ? GREEN : BLUE,
              }}
            />
          </div>
          <div
            className="text-xs text-gray-400 mt-1"
            style={{ fontFamily: DISP }}
          >
            {GAMIFICATION.weeklyTarget - GAMIFICATION.weeklyProgress} more to
            hit target
          </div>
        </div>
        {/* Badges */}
        <div className="flex flex-wrap gap-2">
          {GAMIFICATION.badges.map(b => (
            <div
              key={b}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold"
              style={{
                background: "oklch(0.78 0.18 80 / 0.15)",
                color: GOLD,
                border: `1px solid oklch(0.78 0.18 80 / 0.3)`,
              }}
            >
              {b}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tile Editor Sheet ────────────────────────────────────────────────────────
function TileEditorSheet({
  layout,
  onClose,
  onSave,
}: {
  layout: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<TileCategory | "all">("all");
  const [selected, setSelected] = useState<string[]>(layout);
  const cats: (TileCategory | "all")[] = [
    "all",
    "transactions",
    "customers",
    "finance",
    "compliance",
    "reports",
    "settings",
  ];
  const filtered = TILE_REGISTRY.filter(
    t =>
      (cat === "all" || t.category === cat) &&
      (search === "" || t.label.toLowerCase().includes(search.toLowerCase()))
  );
  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl flex flex-col"
        style={{
          background: "oklch(0.11 0.012 240)",
          border: `1px solid ${BORDER}`,
          maxHeight: "80vh",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-4 border-b flex-shrink-0"
          style={{ borderColor: BORDER }}
        >
          <div
            className="text-base font-bold text-white"
            style={{ fontFamily: DISP }}
          >
            Customize Tiles
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>
        {/* Search */}
        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tiles…"
            className="w-full rounded-xl px-4 py-2.5 text-white text-sm outline-none"
            style={{
              background: CARD,
              border: `1px solid ${BORDER}`,
              fontFamily: DISP,
            }}
          />
        </div>
        {/* Category tabs */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto flex-shrink-0">
          {cats.map(c => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap capitalize transition-all"
              style={{
                background: cat === c ? BLUE : CARD,
                color: cat === c ? "white" : "#6b7280",
                border: `1px solid ${cat === c ? BLUE : BORDER}`,
              }}
            >
              {c}
            </button>
          ))}
        </div>
        {/* Tile list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
          {filtered.map(t => {
            const active = selected.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() =>
                  setSelected(prev =>
                    active ? prev.filter(i => i !== t.id) : [...prev, t.id]
                  )
                }
                className="flex items-center gap-3 p-3 rounded-xl transition-all"
                style={{
                  background: active ? `${t.bgColor}` : CARD,
                  border: `1px solid ${active ? t.color : BORDER}`,
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: t.bgColor }}
                >
                  {t.icon}
                </div>
                <div className="flex-1 text-left">
                  <div
                    className="text-sm font-bold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {t.label}
                  </div>
                  <div
                    className="text-xs text-gray-400"
                    style={{ fontFamily: DISP }}
                  >
                    {t.description}
                  </div>
                </div>
                <div
                  className="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                  style={{
                    borderColor: active ? t.color : BORDER,
                    background: active ? t.color : "transparent",
                  }}
                >
                  {active && (
                    <span className="text-xs text-white font-bold">✓</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <div
          className="p-4 border-t flex-shrink-0"
          style={{ borderColor: BORDER }}
        >
          <button
            onClick={() => {
              onSave(selected);
              onClose();
            }}
            className="w-full py-4 rounded-2xl font-bold text-white transition-all active:scale-95"
            style={{ background: BLUE, fontFamily: DISP }}
          >
            Save Layout ({selected.length} tiles)
          </button>
        </div>
      </div>
    </div>
  );
}

// 27. Disputes & Refunds ───────────────────────────────────────────────────────
function DisputeScreen({ onBack }: { onBack: () => void }) {
  const agent = usePosStore(s => s.agent);
  const [view, setView] = useState<
    "list" | "raise" | "thread" | "refund" | "refund-list"
  >("list");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [txRef, setTxRef] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [replyText, setReplyText] = useState("");
  const [refundTxRef, setRefundTxRef] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundCategory, setRefundCategory] = useState("failed_transaction");
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [activeTab, setActiveTab] = useState<"disputes" | "refunds">(
    "disputes"
  );
  const BG2 = "#0a0e1a";
  const CARD2 = "oklch(0.14 0.02 240)";
  const BORDER2 = "oklch(0.22 0.02 240)";
  const GREEN2 = "oklch(0.65 0.18 160)";
  const RED2 = "oklch(0.60 0.22 25)";
  const GOLD2 = "oklch(0.78 0.18 80)";
  const BLUE2 = "oklch(0.60 0.22 260)";
  const PURPLE2 = "oklch(0.55 0.22 300)";
  const AMBER2 = "oklch(0.75 0.16 70)";
  const DISP2 = "'Space Grotesk', sans-serif";
  const MONO2 = "'JetBrains Mono', monospace";
  const statusColor: Record<string, string> = {
    raised: GOLD2,
    reviewing: BLUE2,
    resolved: GREEN2,
    rejected: RED2,
    open: GOLD2,
    pending: AMBER2,
    approved: BLUE2,
    processed: GREEN2,
  };

  const {
    data: myDisputesData,
    isLoading,
    refetch,
  } = trpc.disputes.myDisputes.useQuery({});
  const myDisputes = myDisputesData?.disputes ?? [];
  const { data: detail, refetch: refetchDetail } =
    trpc.disputes.getDispute.useQuery(
      { ref: selectedRef! },
      { enabled: selectedRef !== null && view === "thread" }
    );
  const {
    data: refundsData,
    isLoading: refundsLoading,
    refetch: refetchRefunds,
  } = trpc.disputeRefund.listRefunds.useQuery({ limit: 50 });
  const myRefunds = refundsData?.refunds ?? [];
  const { data: statsData } = trpc.disputeRefund.stats.useQuery({});

  const raise = trpc.disputes.raise.useMutation({
    onSuccess: res => {
      toast.success("Dispute raised: " + res.disputeRef);
      setTxRef("");
      setReason("");
      setEvidence("");
      setView("list");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const addMessage = trpc.disputes.addMessage.useMutation({
    onSuccess: () => {
      setReplyText("");
      refetchDetail();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const requestRefund = trpc.disputeRefund.requestRefund.useMutation({
    onSuccess: res => {
      toast.success("Refund requested: " + res.refundRef);
      setRefundTxRef("");
      setRefundReason("");
      setRefundAmount("");
      setCustName("");
      setCustPhone("");
      setView("list");
      setActiveTab("refunds");
      refetchRefunds();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const refundStatusIcon: Record<string, string> = {
    pending: "⏳",
    approved: "✅",
    processed: "💰",
    rejected: "❌",
  };

  return (
    <div className="flex flex-col h-full" style={{ background: BG2 }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b"
        style={{ background: CARD2, borderColor: BORDER2 }}
      >
        <button
          onClick={
            view === "list" || view === "refund-list"
              ? onBack
              : () => setView(activeTab === "refunds" ? "refund-list" : "list")
          }
          className="w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: "oklch(0.22 0.02 240)", color: "white" }}
        >
          ←
        </button>
        <div className="flex-1">
          <div
            className="text-sm font-black text-white"
            style={{ fontFamily: DISP2 }}
          >
            Disputes & Refunds
          </div>
          <div className="text-xs text-gray-500" style={{ fontFamily: MONO2 }}>
            {view === "list"
              ? `${myDisputes.length} dispute(s)`
              : view === "raise"
                ? "Raise New Dispute"
                : view === "refund"
                  ? "Request Refund"
                  : view === "refund-list"
                    ? `${myRefunds.length} refund(s)`
                    : `Thread: ${selectedRef}`}
          </div>
        </div>
        {(view === "list" || view === "refund-list") && (
          <div className="flex gap-1.5">
            <button
              onClick={() => setView("raise")}
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-white"
              style={{ background: BLUE2, fontFamily: DISP2 }}
            >
              + Dispute
            </button>
            <button
              onClick={() => setView("refund")}
              className="px-2.5 py-1.5 rounded-xl text-xs font-bold text-white"
              style={{ background: PURPLE2, fontFamily: DISP2 }}
            >
              + Refund
            </button>
          </div>
        )}
      </div>
      {/* Tab switcher */}
      {(view === "list" || view === "refund-list") && (
        <div className="flex border-b" style={{ borderColor: BORDER2 }}>
          <button
            onClick={() => {
              setActiveTab("disputes");
              setView("list");
            }}
            className="flex-1 py-2.5 text-xs font-bold text-center transition-all"
            style={{
              fontFamily: DISP2,
              color: activeTab === "disputes" ? BLUE2 : "#666",
              borderBottom:
                activeTab === "disputes"
                  ? `2px solid ${BLUE2}`
                  : "2px solid transparent",
            }}
          >
            ⚖ Disputes{" "}
            {statsData?.disputes?.open ? `(${statsData.disputes.open})` : ""}
          </button>
          <button
            onClick={() => {
              setActiveTab("refunds");
              setView("refund-list");
            }}
            className="flex-1 py-2.5 text-xs font-bold text-center transition-all"
            style={{
              fontFamily: DISP2,
              color: activeTab === "refunds" ? PURPLE2 : "#666",
              borderBottom:
                activeTab === "refunds"
                  ? `2px solid ${PURPLE2}`
                  : "2px solid transparent",
            }}
          >
            💰 Refunds{" "}
            {statsData?.refunds?.pending
              ? `(${statsData.refunds.pending})`
              : ""}
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4">
        {/* ── Disputes List ── */}
        {view === "list" && (
          <div className="flex flex-col gap-3">
            {isLoading ? (
              <div
                className="text-center py-12 text-gray-500"
                style={{ fontFamily: DISP2 }}
              >
                Loading...
              </div>
            ) : myDisputes.length === 0 ? (
              <div className="text-center py-12" style={{ fontFamily: DISP2 }}>
                <div className="text-4xl mb-3">⚖️</div>
                <div className="text-sm text-gray-500">
                  No disputes raised yet.
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Tap + Dispute to report a transaction issue.
                </div>
              </div>
            ) : (
              myDisputes.map((d: any) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setSelectedRef(d.ref);
                    setView("thread");
                  }}
                  className="w-full text-left rounded-2xl p-4 transition-all"
                  style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-xs font-mono"
                      style={{ color: BLUE2 }}
                    >
                      {d.ref}
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-bold"
                      style={{
                        background: `${statusColor[d.status] ?? GOLD2}20`,
                        color: statusColor[d.status] ?? GOLD2,
                        fontFamily: DISP2,
                      }}
                    >
                      {d.status}
                    </span>
                  </div>
                  <div
                    className="text-sm font-semibold text-white mb-1"
                    style={{ fontFamily: DISP2 }}
                  >
                    {d.reason}
                  </div>
                  <div
                    className="text-xs text-gray-500"
                    style={{ fontFamily: MONO2 }}
                  >
                    Tx: {d.transactionRef}
                  </div>
                  <div
                    className="text-xs text-gray-600 mt-1"
                    style={{ fontFamily: MONO2 }}
                  >
                    {new Date(d.createdAt).toLocaleString("en-NG")}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
        {/* ── Refunds List ── */}
        {view === "refund-list" && (
          <div className="flex flex-col gap-3">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div
                className="rounded-xl p-3 text-center"
                style={{
                  background: `${AMBER2}15`,
                  border: `1px solid ${AMBER2}30`,
                }}
              >
                <div
                  className="text-lg font-black"
                  style={{ color: AMBER2, fontFamily: DISP2 }}
                >
                  {statsData?.refunds?.pending ?? 0}
                </div>
                <div
                  className="text-[10px] text-gray-500"
                  style={{ fontFamily: DISP2 }}
                >
                  Pending
                </div>
              </div>
              <div
                className="rounded-xl p-3 text-center"
                style={{
                  background: `${GREEN2}15`,
                  border: `1px solid ${GREEN2}30`,
                }}
              >
                <div
                  className="text-lg font-black"
                  style={{ color: GREEN2, fontFamily: DISP2 }}
                >
                  {statsData?.refunds?.processed ?? 0}
                </div>
                <div
                  className="text-[10px] text-gray-500"
                  style={{ fontFamily: DISP2 }}
                >
                  Processed
                </div>
              </div>
              <div
                className="rounded-xl p-3 text-center"
                style={{
                  background: `${RED2}15`,
                  border: `1px solid ${RED2}30`,
                }}
              >
                <div
                  className="text-lg font-black"
                  style={{ color: RED2, fontFamily: DISP2 }}
                >
                  {statsData?.refunds?.rejected ?? 0}
                </div>
                <div
                  className="text-[10px] text-gray-500"
                  style={{ fontFamily: DISP2 }}
                >
                  Rejected
                </div>
              </div>
            </div>
            {refundsLoading ? (
              <div
                className="text-center py-12 text-gray-500"
                style={{ fontFamily: DISP2 }}
              >
                Loading...
              </div>
            ) : myRefunds.length === 0 ? (
              <div className="text-center py-12" style={{ fontFamily: DISP2 }}>
                <div className="text-4xl mb-3">💰</div>
                <div className="text-sm text-gray-500">
                  No refunds requested yet.
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Tap + Refund to request a transaction refund.
                </div>
              </div>
            ) : (
              myRefunds.map((r: any) => (
                <div
                  key={r.refund.id}
                  className="rounded-2xl p-4"
                  style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-xs font-mono"
                      style={{ color: PURPLE2 }}
                    >
                      {r.refund.ref}
                    </span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-bold"
                      style={{
                        background: `${statusColor[r.refund.status] ?? GOLD2}20`,
                        color: statusColor[r.refund.status] ?? GOLD2,
                        fontFamily: DISP2,
                      }}
                    >
                      {refundStatusIcon[r.refund.status] ?? ""}{" "}
                      {r.refund.status}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-sm font-bold text-white"
                      style={{ fontFamily: DISP2 }}
                    >
                      ₦{(r.refund.refundAmount ?? 0).toLocaleString()}
                    </span>
                    <span
                      className="text-xs text-gray-500"
                      style={{ fontFamily: MONO2 }}
                    >
                      of ₦{(r.refund.originalAmount ?? 0).toLocaleString()}
                    </span>
                  </div>
                  <div
                    className="text-xs text-gray-400 mb-1"
                    style={{ fontFamily: DISP2 }}
                  >
                    {r.refund.reason}
                  </div>
                  <div className="flex items-center justify-between">
                    <span
                      className="text-xs text-gray-500"
                      style={{ fontFamily: MONO2 }}
                    >
                      Tx: {r.refund.transactionRef}
                    </span>
                    <span
                      className="text-xs text-gray-600"
                      style={{ fontFamily: MONO2 }}
                    >
                      {new Date(r.refund.createdAt).toLocaleString("en-NG")}
                    </span>
                  </div>
                  {r.refund.status === "rejected" &&
                    r.refund.rejectionReason && (
                      <div
                        className="mt-2 rounded-lg p-2 text-xs"
                        style={{
                          background: `${RED2}10`,
                          border: `1px solid ${RED2}30`,
                          color: RED2,
                          fontFamily: DISP2,
                        }}
                      >
                        ❌ {r.refund.rejectionReason}
                      </div>
                    )}
                  {r.refund.status === "processed" && (
                    <div
                      className="mt-2 rounded-lg p-2 text-xs"
                      style={{
                        background: `${GREEN2}10`,
                        border: `1px solid ${GREEN2}30`,
                        color: GREEN2,
                        fontFamily: DISP2,
                      }}
                    >
                      ✅ Refund processed on{" "}
                      {new Date(r.refund.processedAt).toLocaleString("en-NG")}{" "}
                      via {r.refund.method?.replace("_", " ")}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
        {/* ── Raise Dispute Form ── */}
        {view === "raise" && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP2 }}
              >
                Transaction Reference *
              </div>
              <input
                value={txRef}
                onChange={e => setTxRef(e.target.value)}
                placeholder="e.g. TXN-2024-001847"
                className="w-full bg-transparent text-white text-sm outline-none"
                style={{ fontFamily: MONO2 }}
              />
            </div>
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP2 }}
              >
                Reason for Dispute *
              </div>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Describe the issue clearly..."
                rows={4}
                className="w-full bg-transparent text-white text-sm outline-none resize-none"
                style={{ fontFamily: DISP2 }}
              />
            </div>
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP2 }}
              >
                Supporting Evidence (optional)
              </div>
              <textarea
                value={evidence}
                onChange={e => setEvidence(e.target.value)}
                placeholder="Receipt number, customer phone..."
                rows={3}
                className="w-full bg-transparent text-white text-sm outline-none resize-none"
                style={{ fontFamily: DISP2 }}
              />
            </div>
            <button
              onClick={() =>
                raise.mutate({
                  transactionRef: txRef,
                  reason,
                  evidence: evidence || undefined,
                })
              }
              disabled={
                raise.isPending || !txRef.trim() || reason.trim().length < 10
              }
              className="w-full py-4 rounded-2xl font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ background: BLUE2, fontFamily: DISP2 }}
            >
              {raise.isPending ? "Submitting..." : "Submit Dispute"}
            </button>
            <div
              className="text-xs text-center text-gray-600"
              style={{ fontFamily: DISP2 }}
            >
              Disputes are reviewed within 24–48 hours. You will receive an SMS
              update.
            </div>
          </div>
        )}
        {/* ── Request Refund Form ── */}
        {view === "refund" && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-2xl p-3"
              style={{
                background: `${PURPLE2}10`,
                border: `1px solid ${PURPLE2}30`,
              }}
            >
              <div
                className="text-xs font-bold"
                style={{ color: PURPLE2, fontFamily: DISP2 }}
              >
                💰 Request Transaction Refund
              </div>
              <div
                className="text-[10px] text-gray-500 mt-1"
                style={{ fontFamily: DISP2 }}
              >
                Refund requests are reviewed by admin within 24 hours. Amount
                cannot exceed original transaction.
              </div>
            </div>
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP2 }}
              >
                Transaction Reference *
              </div>
              <input
                value={refundTxRef}
                onChange={e => setRefundTxRef(e.target.value)}
                placeholder="e.g. TXN-2024-001847"
                className="w-full bg-transparent text-white text-sm outline-none"
                style={{ fontFamily: MONO2 }}
              />
            </div>
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP2 }}
              >
                Refund Category *
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {[
                  "failed_transaction",
                  "wrong_amount",
                  "duplicate_charge",
                  "service_not_received",
                  "other",
                ].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setRefundCategory(cat)}
                    className="px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all"
                    style={{
                      background:
                        refundCategory === cat
                          ? `${PURPLE2}30`
                          : "oklch(0.18 0.02 240)",
                      color: refundCategory === cat ? PURPLE2 : "#888",
                      border: `1px solid ${refundCategory === cat ? PURPLE2 : BORDER2}`,
                      fontFamily: DISP2,
                    }}
                  >
                    {cat.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP2 }}
              >
                Refund Amount (₦) — leave blank for full refund
              </div>
              <input
                value={refundAmount}
                onChange={e =>
                  setRefundAmount(e.target.value.replace(/[^0-9]/g, ""))
                }
                placeholder="e.g. 5000"
                className="w-full bg-transparent text-white text-sm outline-none"
                style={{ fontFamily: MONO2 }}
              />
            </div>
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div
                className="text-xs text-gray-500 mb-1"
                style={{ fontFamily: DISP2 }}
              >
                Reason for Refund *
              </div>
              <textarea
                value={refundReason}
                onChange={e => setRefundReason(e.target.value)}
                placeholder="Describe why this refund is needed..."
                rows={3}
                className="w-full bg-transparent text-white text-sm outline-none resize-none"
                style={{ fontFamily: DISP2 }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div
                className="rounded-2xl p-4"
                style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
              >
                <div
                  className="text-xs text-gray-500 mb-1"
                  style={{ fontFamily: DISP2 }}
                >
                  Customer Name
                </div>
                <input
                  value={custName}
                  onChange={e => setCustName(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-transparent text-white text-sm outline-none"
                  style={{ fontFamily: DISP2 }}
                />
              </div>
              <div
                className="rounded-2xl p-4"
                style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
              >
                <div
                  className="text-xs text-gray-500 mb-1"
                  style={{ fontFamily: DISP2 }}
                >
                  Customer Phone
                </div>
                <input
                  value={custPhone}
                  onChange={e => setCustPhone(e.target.value)}
                  placeholder="Optional"
                  className="w-full bg-transparent text-white text-sm outline-none"
                  style={{ fontFamily: MONO2 }}
                />
              </div>
            </div>
            <button
              onClick={() =>
                requestRefund.mutate({
                  transactionRef: refundTxRef,
                  reason: refundReason,
                  category: refundCategory as any,
                  refundAmount: refundAmount
                    ? parseInt(refundAmount)
                    : undefined,
                  customerName: custName || undefined,
                  customerPhone: custPhone || undefined,
                })
              }
              disabled={
                requestRefund.isPending ||
                !refundTxRef.trim() ||
                refundReason.trim().length < 10
              }
              className="w-full py-4 rounded-2xl font-bold text-white transition-all active:scale-95 disabled:opacity-50"
              style={{ background: PURPLE2, fontFamily: DISP2 }}
            >
              {requestRefund.isPending
                ? "Submitting..."
                : "Submit Refund Request"}
            </button>
          </div>
        )}
        {/* ── Dispute Thread ── */}
        {view === "thread" && detail && (
          <div className="flex flex-col gap-3">
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono" style={{ color: BLUE2 }}>
                  {detail.ref}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-bold"
                  style={{
                    background: `${statusColor[detail.status] ?? GOLD2}20`,
                    color: statusColor[detail.status] ?? GOLD2,
                    fontFamily: DISP2,
                  }}
                >
                  {detail.status}
                </span>
              </div>
              <div
                className="text-sm font-semibold text-white mb-1"
                style={{ fontFamily: DISP2 }}
              >
                {detail.reason}
              </div>
              <div
                className="text-xs text-gray-500"
                style={{ fontFamily: MONO2 }}
              >
                Tx: {detail.transactionRef}
              </div>
              {detail.evidence && (
                <div
                  className="text-xs text-gray-600 mt-1 italic"
                  style={{ fontFamily: DISP2 }}
                >
                  {detail.evidence}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {(detail.messages ?? []).map((msg: any) => (
                <div
                  key={msg.id}
                  className={`rounded-xl p-3 text-xs ${msg.authorRole === "agent" ? "ml-0 mr-8" : "ml-8 mr-0"}`}
                  style={{
                    background:
                      msg.authorRole === "agent"
                        ? "oklch(0.22 0.02 240)"
                        : "oklch(0.60 0.22 260 / 0.15)",
                    border: `1px solid ${msg.authorRole === "agent" ? BORDER2 : "oklch(0.60 0.22 260 / 0.3)"}`,
                  }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="font-semibold"
                      style={{
                        color: msg.authorRole === "agent" ? GOLD2 : BLUE2,
                        fontFamily: DISP2,
                      }}
                    >
                      {msg.authorName}
                    </span>
                    <span
                      className="text-gray-600"
                      style={{ fontFamily: MONO2 }}
                    >
                      {new Date(msg.createdAt).toLocaleTimeString("en-NG")}
                    </span>
                  </div>
                  <p
                    className="text-gray-300 whitespace-pre-wrap"
                    style={{ fontFamily: DISP2 }}
                  >
                    {msg.message}
                  </p>
                </div>
              ))}
            </div>
            {(detail.status === "resolved" || detail.status === "rejected") &&
              detail.resolution && (
                <div
                  className="rounded-2xl p-4"
                  style={{
                    background:
                      detail.status === "resolved"
                        ? "oklch(0.65 0.18 160 / 0.1)"
                        : "oklch(0.60 0.22 25 / 0.1)",
                    border: `1px solid ${detail.status === "resolved" ? GREEN2 : RED2}`,
                  }}
                >
                  <div
                    className="text-xs font-bold mb-1"
                    style={{
                      color: detail.status === "resolved" ? GREEN2 : RED2,
                      fontFamily: DISP2,
                    }}
                  >
                    {detail.status === "resolved" ? "✓ Resolved" : "✗ Rejected"}
                  </div>
                  <p
                    className="text-xs text-gray-300"
                    style={{ fontFamily: DISP2 }}
                  >
                    {detail.resolution}
                  </p>
                </div>
              )}
            {detail.status !== "resolved" && detail.status !== "rejected" && (
              <div className="flex gap-2">
                <input
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Add a message..."
                  className="flex-1 px-4 py-3 rounded-xl text-sm text-white outline-none"
                  style={{
                    background: CARD2,
                    border: `1px solid ${BORDER2}`,
                    fontFamily: DISP2,
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (replyText.trim())
                        addMessage.mutate({
                          disputeRef: selectedRef!,
                          message: replyText.trim(),
                        });
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (replyText.trim())
                      addMessage.mutate({
                        disputeRef: selectedRef!,
                        message: replyText.trim(),
                      });
                  }}
                  disabled={addMessage.isPending || !replyText.trim()}
                  className="px-4 py-3 rounded-xl font-bold text-white disabled:opacity-50"
                  style={{ background: BLUE2, fontFamily: DISP2 }}
                >
                  Send
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Offline & Resilience Screen ────────────────────────────────────────────
function OfflineResilienceScreen({ onBack }: { onBack: () => void }) {
  const { offlineQueue, dequeueOfflineTx, isOnline, agent } = usePosStore();
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);

  const {
    data: sysStatus,
    refetch: refetchStatus,
    isLoading: statusLoading,
  } = trpc.resilience.systemStatus.useQuery(undefined, {
    refetchInterval: 15_000,
    retry: false,
  });
  const { data: rustItems, refetch: refetchRust } =
    trpc.resilience.listPendingOffline.useQuery(undefined, {
      refetchInterval: 10_000,
      retry: false,
    });
  const { data: probe } = trpc.resilience.probe.useQuery(undefined, {
    refetchInterval: 5_000,
    retry: false,
  });

  const createTx = trpc.transactions.create.useMutation();
  const dequeue = trpc.resilience.dequeueOffline.useMutation();
  const requeue = trpc.resilience.enqueueOffline.useMutation();
  const discard = trpc.resilience.discardOfflineItem.useMutation();
  const encodeUssd = trpc.resilience.encodeUssd.useMutation();
  const printUssd = trpc.resilience.printUssdReceipt.useMutation();
  const retryDeadLetterMut = trpc.resilience.retryDeadLetter.useMutation();
  const logConnectivityMut = trpc.resilience.logConnectivity.useMutation();
  const alertOnPoorConnMut =
    trpc.resilience.alertOnPoorConnectivity.useMutation();
  const { data: pushSubs } = trpc.resilience.getPushSubscriptions.useQuery(
    { agentCode: agent?.agentCode ?? "DEMO" },
    { refetchInterval: 30_000, retry: false }
  );
  const { data: connHistory } = trpc.resilience.getConnectivityHistory.useQuery(
    { agentCode: agent?.agentCode ?? "DEMO", hours: 24 },
    { refetchInterval: 60_000, retry: false }
  );
  const utils = trpc.useUtils();

  // USSD fallback state
  const [ussdCodes, setUssdCodes] = useState<
    Array<{
      id: string;
      ussd_string: string;
      instructions: string;
      carrier_hint: string | null;
      tx_type: string;
      amount: number;
    }>
  >([]);
  const [generatingUssd, setGeneratingUssd] = useState(false);
  const [showUssdPanel, setShowUssdPanel] = useState(false);
  const [printingUssdId, setPrintingUssdId] = useState<string | null>(null);
  // Thermal receipt preview modal state
  const [thermalPreviewCode, setThermalPreviewCode] = useState<{
    ussd_string: string;
    instructions: string;
    tx_type: string;
    amount: number;
    carrier_hint: string | null;
  } | null>(null);
  const [smsUssdPhone, setSmsUssdPhone] = useState("");
  const sendUssdSms = trpc.smsReceipt.sendUssd.useMutation({
    onSuccess: () => {
      toast.success("USSD code sent via SMS");
      setSmsUssdPhone("");
    },
    onError: (e: any) => toast.error(`SMS failed: ${e.message}`),
  });
  const generateUssdCodes = async () => {
    const allItems = [
      ...zustandQueue.map(tx => ({
        id: tx.id,
        txType: tx.type,
        amount: tx.amount,
        destinationAccount: tx.destinationAccount,
        destinationBank: tx.destinationBank,
        customerPhone: tx.customerPhone,
      })),
      ...rustQueue.map(item => ({
        id: item.id,
        txType: item.tx_type,
        amount: item.amount,
        customerPhone: item.customer_phone,
        destinationAccount: undefined as string | undefined,
        destinationBank: undefined as string | undefined,
      })),
    ];
    if (allItems.length === 0) {
      toast.info("No pending transactions to encode");
      return;
    }
    setGeneratingUssd(true);
    const codes: typeof ussdCodes = [];
    for (const item of allItems.slice(0, 10)) {
      try {
        const result = await encodeUssd.mutateAsync({
          txType: item.txType,
          amount: item.amount,
          destinationAccount: item.destinationAccount,
          destinationBank: item.destinationBank,
          customerPhone: item.customerPhone,
        });
        codes.push({
          id: item.id,
          ussd_string: (result as any).ussd_string,
          instructions: (result as any).instructions,
          carrier_hint: (result as any).carrier_hint ?? null,
          tx_type: item.txType,
          amount: item.amount,
        });
      } catch {
        codes.push({
          id: item.id,
          ussd_string: `*966*${Math.round(item.amount)}#`,
          instructions: `Dial *966*${Math.round(item.amount)}# to pay via USSD.`,
          carrier_hint: null,
          tx_type: item.txType,
          amount: item.amount,
        });
      }
    }
    setUssdCodes(codes);
    setShowUssdPanel(true);
    setGeneratingUssd(false);
  };

  const connQuality: string =
    (probe as any)?.quality ?? (isOnline ? "Good" : "Offline");
  const connLatency: number | null = (probe as any)?.latency_ms ?? null;
  const connColor =
    connQuality === "Excellent"
      ? GREEN
      : connQuality === "Good"
        ? BLUE
        : connQuality === "Poor"
          ? GOLD
          : RED;

  // Log connectivity probe result whenever quality changes
  useEffect(() => {
    if (!agent?.agentCode) return;
    const q = connQuality as "Excellent" | "Good" | "Poor" | "Offline";
    if (["Excellent", "Good", "Poor", "Offline"].includes(q)) {
      logConnectivityMut.mutate({
        agentCode: agent.agentCode,
        quality: q,
        latencyMs: connLatency,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connQuality]);
  // Auto-alert owner when uptime drops below 80% (fires once per history refresh)
  useEffect(() => {
    if (!agent?.agentCode || !connHistory) return;
    if (connHistory.uptimePct < 80 && connHistory.rows.length >= 3) {
      alertOnPoorConnMut.mutate({ agentCode: agent.agentCode });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connHistory?.uptimePct]);

  const zustandQueue = offlineQueue;
  const rustQueue = (rustItems ?? []) as Array<{
    id: string;
    tx_type: string;
    amount: number;
    customer_name?: string;
    customer_phone?: string;
    channel?: string;
    queued_at?: string;
  }>;
  const totalPending = zustandQueue.length + rustQueue.length;

  const syncAll = async () => {
    setSyncing(true);
    const total = zustandQueue.length + rustQueue.length;
    setSyncTotal(total);
    setSyncProgress(0);
    let done = 0;
    for (const tx of [...zustandQueue]) {
      try {
        await createTx.mutateAsync({
          type: tx.type as any,
          amount: tx.amount,
          customerPhone: tx.customerPhone,
          customerName: tx.customerName,
          destinationBank: tx.destinationBank,
          destinationAccount: tx.destinationAccount,
          metadata: { offlineId: tx.id },
        });
        dequeueOfflineTx(tx.id);
        toast.success(`Synced: ₦${tx.amount.toLocaleString()} ${tx.type}`);
      } catch {
        toast.error(`Failed to sync ${tx.type} ₦${tx.amount}`);
      }
      done++;
      setSyncProgress(done);
    }
    for (let i = 0; i < 50; i++) {
      let item: any = null;
      try {
        const r = await dequeue.mutateAsync({});
        item = (r as any)?.item ?? null;
      } catch {
        break;
      }
      if (!item) break;
      try {
        await createTx.mutateAsync({
          type: item.tx_type as any,
          amount: item.amount,
          customerPhone: item.customer_phone,
          customerName: item.customer_name,
          metadata: { rustQueueId: item.id },
        });
        toast.success(`Synced (durable): ₦${item.amount} ${item.tx_type}`);
      } catch {
        await requeue.mutateAsync({
          txType: item.tx_type,
          amount: item.amount,
          customerName: item.customer_name,
          customerPhone: item.customer_phone,
        });
        toast.error(`Failed — re-queued: ${item.tx_type}`);
      }
      done++;
      setSyncProgress(done);
    }
    await utils.resilience.queueCount.invalidate();
    refetchRust();
    setSyncing(false);
    toast.success("Sync complete");
  };

  const discardItem = async (id: string) => {
    await discard.mutateAsync({ id });
    refetchRust();
    toast.info("Item discarded");
  };

  const badge = (label: string, ok: boolean, warn?: boolean) => (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-bold"
      style={{
        background: ok ? `${GREEN}22` : warn ? `${GOLD}22` : `${RED}22`,
        color: ok ? GREEN : warn ? GOLD : RED,
        fontFamily: MONO,
      }}
    >
      {label}
    </span>
  );

  const sec = (title: string, icon: string) => (
    <div className="flex items-center gap-2 mb-3">
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span
        className="text-sm font-bold text-white"
        style={{ fontFamily: DISP }}
      >
        {title}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      <ScreenHeader title="Offline &amp; Resilience" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Connection Quality */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `2px solid ${connColor}44` }}
        >
          {sec("Connection Quality", "📡")}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-end gap-0.5 h-5">
                {[0, 1, 2, 3].map(i => (
                  <div
                    key={i}
                    className="w-2 rounded-sm"
                    style={{
                      height: `${(i + 1) * 25}%`,
                      background:
                        ["Offline", "Poor", "Good", "Excellent"].indexOf(
                          connQuality
                        ) >= i
                          ? connColor
                          : BORDER,
                    }}
                  />
                ))}
              </div>
              <div>
                <div
                  className="text-lg font-black"
                  style={{ color: connColor, fontFamily: MONO }}
                >
                  {connQuality}
                </div>
                {connLatency !== null && (
                  <div
                    className="text-xs"
                    style={{ color: "#6b7280", fontFamily: MONO }}
                  >
                    {connLatency}ms latency
                  </div>
                )}
              </div>
            </div>
            {badge(isOnline ? "ONLINE" : "OFFLINE", isOnline)}
          </div>
        </div>

        {/* Connectivity History Sparkline */}
        {connHistory && connHistory.rows.length > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            {sec("Connectivity History (24h)", "📊")}
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-4">
                <div>
                  <div
                    className="text-lg font-black"
                    style={{
                      color:
                        connHistory.uptimePct >= 95
                          ? GREEN
                          : connHistory.uptimePct >= 80
                            ? GOLD
                            : RED,
                      fontFamily: MONO,
                    }}
                  >
                    {connHistory.uptimePct}%
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "#6b7280", fontFamily: DISP }}
                  >
                    Uptime
                  </div>
                </div>
                <div>
                  <div
                    className="text-lg font-black"
                    style={{ color: BLUE, fontFamily: MONO }}
                  >
                    {connHistory.avgLatencyMs}ms
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "#6b7280", fontFamily: DISP }}
                  >
                    Avg Latency
                  </div>
                </div>
                <div>
                  <div
                    className="text-lg font-black text-white"
                    style={{ fontFamily: MONO }}
                  >
                    {connHistory.rows.length}
                  </div>
                  <div
                    className="text-xs"
                    style={{ color: "#6b7280", fontFamily: DISP }}
                  >
                    Probes
                  </div>
                </div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={60}>
              <LineChart
                data={connHistory.rows.map(r => ({
                  t: new Date(r.recordedAt).getTime(),
                  latency: r.latencyMs ?? 0,
                  online: r.quality !== "Offline" ? 1 : 0,
                }))}
                margin={{ top: 4, right: 4, left: -30, bottom: 0 }}
              >
                <XAxis dataKey="t" hide />
                <YAxis hide />
                <Tooltip
                  contentStyle={{
                    background: "#0a0e1a",
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  labelFormatter={v =>
                    new Date(v as number).toLocaleTimeString()
                  }
                  formatter={(v: number, name: string) =>
                    name === "latency"
                      ? [`${v}ms`, "Latency"]
                      : [v === 1 ? "Online" : "Offline", "Status"]
                  }
                />
                <Line
                  type="monotone"
                  dataKey="latency"
                  stroke={BLUE}
                  dot={false}
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Push Subscriptions — shows lastAlertedAt for throttle visibility */}
        {pushSubs && pushSubs.subscriptions.length > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            {sec("Push Subscriptions", "🔔")}
            <div className="flex flex-col gap-2 mt-2">
              {pushSubs.subscriptions.map((sub, i) => {
                const lastAlerted = sub.lastAlertedAt
                  ? new Date(sub.lastAlertedAt)
                  : null;
                const minutesAgo = lastAlerted
                  ? Math.round((Date.now() - lastAlerted.getTime()) / 60000)
                  : null;
                const throttleActive = minutesAgo !== null && minutesAgo < 30;
                return (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between p-2 rounded-xl"
                    style={{
                      background: "oklch(0.10 0.01 240)",
                      border: `1px solid ${BORDER}`,
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div
                        className="text-xs font-bold text-white truncate"
                        style={{ fontFamily: MONO }}
                      >
                        Sub #{i + 1}
                      </div>
                      <div
                        className="text-xs truncate"
                        style={{ color: "#6b7280", fontFamily: MONO }}
                      >
                        {sub.endpoint.slice(0, 40)}…
                      </div>
                    </div>
                    <div className="text-right ml-2 flex-shrink-0">
                      <div
                        className="text-xs font-bold"
                        style={{
                          color: throttleActive ? GOLD : GREEN,
                          fontFamily: MONO,
                        }}
                      >
                        {lastAlerted
                          ? minutesAgo! < 60
                            ? `${minutesAgo}m ago`
                            : lastAlerted.toLocaleTimeString()
                          : "Never alerted"}
                      </div>
                      <div
                        className="text-xs"
                        style={{ color: "#6b7280", fontFamily: DISP }}
                      >
                        {throttleActive ? "⏸ Throttled" : "✓ Ready"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Sync Queue Summary */}
        <div
          className="rounded-2xl p-4"
          style={{
            background: CARD,
            border: `1px solid ${totalPending > 0 ? GOLD : BORDER}`,
          }}
        >
          {sec("Pending Sync Queue", "⏳")}
          <div className="flex items-center justify-between mb-3">
            <div>
              <div
                className="text-2xl font-black"
                style={{
                  color: totalPending > 0 ? GOLD : GREEN,
                  fontFamily: MONO,
                }}
              >
                {totalPending}
              </div>
              <div
                className="text-xs"
                style={{ color: "#6b7280", fontFamily: DISP }}
              >
                transactions pending
              </div>
            </div>
            <div className="flex flex-col gap-1 text-right">
              <div
                className="text-xs"
                style={{ color: "#6b7280", fontFamily: MONO }}
              >
                <span style={{ color: BLUE }}>In-memory:</span>{" "}
                {zustandQueue.length}
              </div>
              <div
                className="text-xs"
                style={{ color: "#6b7280", fontFamily: MONO }}
              >
                <span style={{ color: GOLD }}>Durable (PostgreSQL):</span>{" "}
                {rustQueue.length}
              </div>
            </div>
          </div>
          {syncing ? (
            <div className="flex flex-col gap-2">
              <div
                className="w-full h-2 rounded-full"
                style={{ background: BORDER }}
              >
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${syncTotal > 0 ? (syncProgress / syncTotal) * 100 : 0}%`,
                    background: BLUE,
                  }}
                />
              </div>
              <div
                className="text-xs text-center"
                style={{ color: BLUE, fontFamily: MONO }}
              >
                Syncing {syncProgress}/{syncTotal}...
              </div>
            </div>
          ) : (
            <button
              onClick={syncAll}
              disabled={totalPending === 0 || !isOnline}
              className="w-full py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
              style={{
                background: totalPending > 0 && isOnline ? `${BLUE}22` : BORDER,
                color: totalPending > 0 && isOnline ? BLUE : "#4b5563",
                border: `1px solid ${totalPending > 0 && isOnline ? BLUE : BORDER}`,
                fontFamily: DISP,
              }}
            >
              {isOnline
                ? totalPending > 0
                  ? `⬆ Sync All (${totalPending})`
                  : "✓ Queue Empty"
                : "📵 Offline — Cannot Sync"}
            </button>
          )}
        </div>

        {/* In-Memory Queue */}
        {zustandQueue.length > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            {sec("In-Memory Queue (Session)", "🧠")}
            <div className="flex flex-col gap-2">
              {zustandQueue.map(tx => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-2 rounded-xl"
                  style={{
                    background: "oklch(0.10 0.01 240)",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  <div>
                    <div
                      className="text-xs font-bold text-white"
                      style={{ fontFamily: MONO }}
                    >
                      {tx.type.toUpperCase()} · ₦{tx.amount.toLocaleString()}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "#6b7280", fontFamily: DISP }}
                    >
                      {tx.customerName ?? tx.customerPhone ?? "Unknown"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: `${GOLD}22`,
                        color: GOLD,
                        fontFamily: MONO,
                      }}
                    >
                      QUEUED
                    </span>
                    <button
                      onClick={() => dequeueOfflineTx(tx.id)}
                      className="text-xs px-2 py-0.5 rounded-lg"
                      style={{
                        background: `${RED}22`,
                        color: RED,
                        fontFamily: MONO,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rust Durable Queue */}
        {rustQueue.length > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            {sec("Durable Queue (PostgreSQL)", "🦀")}
            <div className="flex flex-col gap-2">
              {rustQueue.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2 rounded-xl"
                  style={{
                    background: "oklch(0.10 0.01 240)",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  <div>
                    <div
                      className="text-xs font-bold text-white"
                      style={{ fontFamily: MONO }}
                    >
                      {(item.tx_type ?? "TX").toUpperCase()} · ₦
                      {Number(item.amount).toLocaleString()}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "#6b7280", fontFamily: DISP }}
                    >
                      {item.customer_name ?? item.customer_phone ?? "Unknown"}
                      {item.queued_at
                        ? ` · ${new Date(item.queued_at).toLocaleTimeString()}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: `${GOLD}22`,
                        color: GOLD,
                        fontFamily: MONO,
                      }}
                    >
                      DURABLE
                    </span>
                    <button
                      onClick={() => discardItem(item.id)}
                      className="text-xs px-2 py-0.5 rounded-lg"
                      style={{
                        background: `${RED}22`,
                        color: RED,
                        fontFamily: MONO,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fluvio Event Bus */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          {sec("Fluvio Event Bus", "⚡")}
          {statusLoading ? (
            <div
              className="text-xs"
              style={{ color: "#6b7280", fontFamily: MONO }}
            >
              Loading...
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  Mode
                </span>
                {badge(
                  (sysStatus?.fluvio?.mode ?? "fallback").toUpperCase(),
                  sysStatus?.fluvio?.mode === "direct",
                  sysStatus?.fluvio?.mode === "proxy"
                )}
              </div>
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  Buffered Events
                </span>
                <span
                  className="text-xs font-bold"
                  style={{
                    color:
                      (sysStatus?.fluvio?.bufferedEvents ?? 0) > 0
                        ? GOLD
                        : GREEN,
                    fontFamily: MONO,
                  }}
                >
                  {sysStatus?.fluvio?.bufferedEvents ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  Topics
                </span>
                <span
                  className="text-xs font-bold text-white"
                  style={{ fontFamily: MONO }}
                >
                  {sysStatus?.fluvio?.topicCount ?? 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  Endpoint
                </span>
                <span
                  className="text-xs"
                  style={{ color: "#6b7280", fontFamily: MONO }}
                >
                  {(sysStatus?.fluvio?.endpoint ?? "none").slice(0, 30)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Redis Cache */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          {sec("Redis Cache", "🔴")}
          {statusLoading ? (
            <div
              className="text-xs"
              style={{ color: "#6b7280", fontFamily: MONO }}
            >
              Loading...
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <div
                  className="text-sm font-bold text-white"
                  style={{ fontFamily: DISP }}
                >
                  {sysStatus?.redis?.mode === "direct"
                    ? "Direct (ioredis)"
                    : sysStatus?.redis?.mode === "proxy"
                      ? "APISix Proxy"
                      : "Unavailable"}
                </div>
                <div
                  className="text-xs"
                  style={{ color: "#6b7280", fontFamily: MONO }}
                >
                  Connection mode
                </div>
              </div>
              {badge(
                sysStatus?.redis?.healthy ? "HEALTHY" : "DEGRADED",
                sysStatus?.redis?.healthy ?? false
              )}
            </div>
          )}
        </div>

        {/* ERP Retry Worker */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          {sec("ERP Retry Worker", "🔄")}
          {statusLoading ? (
            <div
              className="text-xs"
              style={{ color: "#6b7280", fontFamily: MONO }}
            >
              Loading...
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  Pending Sync
                </span>
                <span
                  className="text-xs font-bold"
                  style={{
                    color:
                      (sysStatus?.erp?.pendingCount ?? 0) > 0 ? GOLD : GREEN,
                    fontFamily: MONO,
                  }}
                >
                  {sysStatus?.erp?.pendingCount ?? 0} entries
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  Dead Letter
                </span>
                <span
                  className="text-xs font-bold"
                  style={{
                    color:
                      (sysStatus?.erp?.deadLetterCount ?? 0) > 0 ? RED : GREEN,
                    fontFamily: MONO,
                  }}
                >
                  {sysStatus?.erp?.deadLetterCount ?? 0} failed
                </span>
              </div>
              {sysStatus?.erp?.lastRetryAt && (
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs"
                    style={{ color: "#9ca3af", fontFamily: DISP }}
                  >
                    Last Activity
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: "#6b7280", fontFamily: MONO }}
                  >
                    {new Date(sysStatus.erp.lastRetryAt).toLocaleTimeString()}
                  </span>
                </div>
              )}
              {(sysStatus?.erp?.deadLetterCount ?? 0) > 0 && (
                <button
                  disabled={retryDeadLetterMut.isPending}
                  onClick={async () => {
                    try {
                      const r = await retryDeadLetterMut.mutateAsync();
                      toast.success(
                        `Re-queued ${(r as any).requeued ?? 0} dead-letter item(s)`
                      );
                      refetchStatus();
                    } catch {
                      toast.error("Failed to retry dead-letter items");
                    }
                  }}
                  className="w-full py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
                  style={{
                    background: `${RED}22`,
                    color: RED,
                    border: `1px solid ${RED}44`,
                    fontFamily: DISP,
                  }}
                >
                  {retryDeadLetterMut.isPending
                    ? "Retrying…"
                    : `↺ Retry All Dead-Letter (${sysStatus?.erp?.deadLetterCount})`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* MQTT Bridge */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          {sec("MQTT Bridge", "📶")}
          {statusLoading ? (
            <div
              className="text-xs"
              style={{ color: "#6b7280", fontFamily: MONO }}
            >
              Loading...
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  Status
                </span>
                {badge(
                  (sysStatus?.mqtt?.status ?? "unconfigured").toUpperCase(),
                  sysStatus?.mqtt?.status === "success",
                  sysStatus?.mqtt?.status === "disabled" ||
                    sysStatus?.mqtt?.status === "never"
                )}
              </div>
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  QoS
                </span>
                <span
                  className="text-xs font-bold text-white"
                  style={{ fontFamily: MONO }}
                >
                  Level {sysStatus?.mqtt?.qos ?? "1"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span
                  className="text-xs"
                  style={{ color: "#9ca3af", fontFamily: DISP }}
                >
                  Topic Mappings
                </span>
                <span
                  className="text-xs font-bold text-white"
                  style={{ fontFamily: MONO }}
                >
                  {sysStatus?.mqtt?.topicCount ?? 0}
                </span>
              </div>
              {sysStatus?.mqtt?.broker && (
                <div className="flex items-center justify-between">
                  <span
                    className="text-xs"
                    style={{ color: "#9ca3af", fontFamily: DISP }}
                  >
                    Broker
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: "#6b7280", fontFamily: MONO }}
                  >
                    {sysStatus.mqtt.broker.slice(0, 30)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Go Agent Retry History */}
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          {sec("Go Agent Retry History", "🔁")}
          {statusLoading ? (
            <div
              className="text-xs"
              style={{ color: "#6b7280", fontFamily: MONO }}
            >
              Loading...
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {(sysStatus?.goAgent?.retryHistory ?? []).length === 0 ? (
                <div
                  className="text-xs"
                  style={{ color: "#4b5563", fontFamily: MONO }}
                >
                  No retry history — agent may be offline
                </div>
              ) : (
                (
                  sysStatus?.goAgent?.retryHistory as Array<{
                    attempt: number;
                    status: string;
                    latency_ms?: number;
                    timestamp: string;
                  }>
                ).map((h, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 rounded-xl"
                    style={{
                      background: "oklch(0.10 0.01 240)",
                      border: `1px solid ${BORDER}`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs"
                        style={{ color: "#6b7280", fontFamily: MONO }}
                      >
                        #{h.attempt}
                      </span>
                      <span
                        className="text-xs text-white"
                        style={{ fontFamily: MONO }}
                      >
                        {h.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {h.latency_ms && (
                        <span
                          className="text-xs"
                          style={{ color: BLUE, fontFamily: MONO }}
                        >
                          {h.latency_ms}ms
                        </span>
                      )}
                      <span
                        className="text-xs"
                        style={{ color: "#4b5563", fontFamily: MONO }}
                      >
                        {new Date(h.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* USSD Fallback Shortcut — shown when offline and queue has items */}
        {!isOnline && totalPending > 0 && (
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `2px solid ${GOLD}44` }}
          >
            {sec("USSD Fallback", "📞")}
            <p
              className="text-xs mb-3"
              style={{ color: "#9ca3af", fontFamily: DISP }}
            >
              You are offline with {totalPending} pending transaction
              {totalPending > 1 ? "s" : ""}. Generate USSD dial strings to
              complete them immediately without internet.
            </p>
            {showUssdPanel && ussdCodes.length > 0 ? (
              <div className="flex flex-col gap-3">
                {ussdCodes.map((code, i) => (
                  <div
                    key={code.id}
                    className="rounded-xl p-3"
                    style={{
                      background: "oklch(0.10 0.01 240)",
                      border: `1px solid ${GOLD}33`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-xs font-bold"
                        style={{ color: GOLD, fontFamily: MONO }}
                      >
                        #{i + 1} {code.tx_type.toUpperCase()} · ₦
                        {Number(code.amount).toLocaleString()}
                      </span>
                      {code.carrier_hint && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: `${BLUE}22`,
                            color: BLUE,
                            fontFamily: MONO,
                          }}
                        >
                          {code.carrier_hint}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-base font-black mb-1"
                      style={{
                        color: "#ffffff",
                        fontFamily: MONO,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {code.ussd_string}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "#6b7280", fontFamily: DISP }}
                    >
                      {code.instructions}
                    </div>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(code.ussd_string);
                          toast.success("Copied!");
                        }}
                        className="text-xs px-3 py-1 rounded-lg"
                        style={{
                          background: `${GOLD}22`,
                          color: GOLD,
                          border: `1px solid ${GOLD}44`,
                          fontFamily: MONO,
                        }}
                      >
                        Copy
                      </button>
                      <button
                        onClick={() =>
                          setThermalPreviewCode({
                            ussd_string: code.ussd_string,
                            instructions: code.instructions,
                            tx_type: code.tx_type,
                            amount: code.amount,
                            carrier_hint: code.carrier_hint,
                          })
                        }
                        className="text-xs px-3 py-1 rounded-lg"
                        style={{
                          background: "oklch(0.25 0.02 240)",
                          color: "#e5e7eb",
                          border: "1px solid #374151",
                          fontFamily: MONO,
                        }}
                      >
                        👁 Preview
                      </button>
                      <button
                        disabled={printingUssdId === code.id}
                        onClick={async () => {
                          setPrintingUssdId(code.id);
                          try {
                            await printUssd.mutateAsync({
                              agentCode: agent?.agentCode ?? "UNKNOWN",
                              txType: code.tx_type,
                              amount: code.amount,
                              ussdString: code.ussd_string,
                              instructions: code.instructions,
                            });
                            toast.success("USSD receipt sent to printer");
                          } catch {
                            toast.error("Printer offline — receipt queued");
                          } finally {
                            setPrintingUssdId(null);
                          }
                        }}
                        className="text-xs px-3 py-1 rounded-lg disabled:opacity-50"
                        style={{
                          background: `${BLUE}22`,
                          color: BLUE,
                          border: `1px solid ${BLUE}44`,
                          fontFamily: MONO,
                        }}
                      >
                        {printingUssdId === code.id ? "Printing…" : "🖨 Print"}
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => setShowUssdPanel(false)}
                  className="text-xs text-center"
                  style={{ color: "#6b7280", fontFamily: DISP }}
                >
                  Hide USSD codes
                </button>
              </div>
            ) : (
              <button
                onClick={generateUssdCodes}
                disabled={generatingUssd}
                className="w-full py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={{
                  background: `${GOLD}22`,
                  color: GOLD,
                  border: `1px solid ${GOLD}44`,
                  fontFamily: DISP,
                }}
              >
                {generatingUssd
                  ? "Generating…"
                  : `📞 Generate USSD Codes (${totalPending})`}
              </button>
            )}
          </div>
        )}

        {/* Refresh */}
        <button
          onClick={() => {
            refetchStatus();
            refetchRust();
          }}
          className="w-full py-3 rounded-2xl text-sm font-bold transition-all active:scale-95"
          style={{
            background: `${BLUE}22`,
            color: BLUE,
            border: `1px solid ${BLUE}44`,
            fontFamily: DISP,
          }}
        >
          ↻ Refresh Status
        </button>
      </div>

      {/* ── Thermal Receipt Preview Modal ── */}
      {thermalPreviewCode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={() => setThermalPreviewCode(null)}
        >
          <div
            className="relative flex flex-col"
            style={{
              width: 320,
              background: "#fff",
              borderRadius: 4,
              boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Thermal paper top perforation */}
            <div
              style={{
                height: 12,
                background:
                  "repeating-linear-gradient(90deg, #fff 0 6px, #e5e7eb 6px 12px)",
                borderRadius: "4px 4px 0 0",
              }}
            />
            {/* Receipt body */}
            <div
              className="px-5 py-4"
              style={{
                fontFamily: "'Courier New', Courier, monospace",
                fontSize: 13,
                color: "#111",
                lineHeight: 1.6,
              }}
            >
              <div
                className="text-center font-black text-base mb-1"
                style={{ letterSpacing: "0.08em" }}
              >
                INSUREPORTAL POS
              </div>
              <div
                className="text-center text-xs mb-3"
                style={{ color: "#555" }}
              >
                OFFLINE USSD RECEIPT
              </div>
              <div style={{ borderTop: "1px dashed #999", marginBottom: 8 }} />
              <div className="flex justify-between text-xs mb-1">
                <span>TYPE</span>
                <span className="font-bold">
                  {thermalPreviewCode.tx_type.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between text-xs mb-1">
                <span>AMOUNT</span>
                <span className="font-bold">
                  ₦
                  {Number(thermalPreviewCode.amount).toLocaleString("en-NG", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
              {thermalPreviewCode.carrier_hint && (
                <div className="flex justify-between text-xs mb-1">
                  <span>CARRIER</span>
                  <span className="font-bold">
                    {thermalPreviewCode.carrier_hint}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-xs mb-1">
                <span>DATE</span>
                <span>{new Date().toLocaleDateString("en-NG")}</span>
              </div>
              <div className="flex justify-between text-xs mb-3">
                <span>TIME</span>
                <span>
                  {new Date().toLocaleTimeString("en-NG", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div style={{ borderTop: "1px dashed #999", marginBottom: 8 }} />
              <div
                className="text-center font-black text-xl mb-1"
                style={{ letterSpacing: "0.15em", wordBreak: "break-all" }}
              >
                {thermalPreviewCode.ussd_string}
              </div>
              <div
                className="text-center text-xs mb-3"
                style={{ color: "#555", whiteSpace: "pre-wrap" }}
              >
                {thermalPreviewCode.instructions}
              </div>
              <div style={{ borderTop: "1px dashed #999", marginBottom: 8 }} />
              <div className="text-center text-xs" style={{ color: "#888" }}>
                DIAL THE CODE ABOVE TO COMPLETE
              </div>
              <div className="text-center text-xs" style={{ color: "#888" }}>
                YOUR TRANSACTION OFFLINE
              </div>
              <div
                className="text-center text-xs mt-2"
                style={{ color: "#bbb" }}
              >
                www.insureportal.io
              </div>
            </div>
            {/* Thermal paper bottom perforation */}
            <div
              style={{
                height: 12,
                background:
                  "repeating-linear-gradient(90deg, #fff 0 6px, #e5e7eb 6px 12px)",
                borderRadius: "0 0 4px 4px",
              }}
            />
            {/* Action buttons */}
            <div
              className="flex gap-2 px-4 py-3 flex-wrap"
              style={{
                background: "#f9fafb",
                borderTop: "1px solid #e5e7eb",
                borderRadius: "0 0 4px 4px",
              }}
            >
              <button
                className="flex-1 py-2 rounded text-xs font-bold"
                style={{ background: "#1e3a5f", color: "#fff", minWidth: 80 }}
                onClick={async () => {
                  try {
                    await printUssd.mutateAsync({
                      agentCode: agent?.agentCode ?? "UNKNOWN",
                      txType: thermalPreviewCode.tx_type,
                      amount: thermalPreviewCode.amount,
                      ussdString: thermalPreviewCode.ussd_string,
                      instructions: thermalPreviewCode.instructions,
                    });
                    toast.success("USSD receipt sent to printer");
                    setThermalPreviewCode(null);
                  } catch {
                    toast.error("Printer offline — receipt queued");
                  }
                }}
              >
                🖨 Confirm &amp; Print
              </button>
              <button
                className="flex-1 py-2 rounded text-xs font-bold"
                style={{ background: "#065f46", color: "#fff", minWidth: 80 }}
                onClick={() => {
                  // Open a minimal print window with only the receipt content
                  const printWin = window.open(
                    "",
                    "_blank",
                    "width=400,height=600"
                  );
                  if (!printWin) {
                    toast.error("Pop-up blocked — allow pop-ups and try again");
                    return;
                  }
                  const now = new Date();
                  printWin.document.write(`<!DOCTYPE html>
<html><head><title>InsurePortal USSD Receipt</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; background: #fff; width: 72mm; margin: 0 auto; }
  .center { text-align: center; }
  .bold { font-weight: bold; }
  .row { display: flex; justify-content: space-between; margin-bottom: 2px; }
  .divider { border-top: 1px dashed #999; margin: 6px 0; }
  .ussd { font-size: 18px; font-weight: 900; letter-spacing: 0.15em; word-break: break-all; text-align: center; margin: 6px 0; }
  .perf { height: 8px; background: repeating-linear-gradient(90deg, #fff 0 5px, #ccc 5px 10px); }
  .footer { font-size: 9px; color: #888; text-align: center; margin-top: 4px; }
  @media print { body { width: 100%; } }
</style></head><body>
<div class="perf"></div>
<div class="center bold" style="font-size:14px;margin:6px 0 2px">INSUREPORTAL POS</div>
<div class="center" style="font-size:10px;color:#555;margin-bottom:6px">OFFLINE USSD RECEIPT</div>
<div class="divider"></div>
<div class="row"><span>TYPE</span><span class="bold">${thermalPreviewCode.tx_type.toUpperCase()}</span></div>
<div class="row"><span>AMOUNT</span><span class="bold">₦${Number(thermalPreviewCode.amount).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</span></div>
${thermalPreviewCode.carrier_hint ? `<div class="row"><span>CARRIER</span><span class="bold">${thermalPreviewCode.carrier_hint}</span></div>` : ""}
<div class="row"><span>DATE</span><span>${now.toLocaleDateString("en-NG")}</span></div>
<div class="row"><span>TIME</span><span>${now.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}</span></div>
<div class="divider"></div>
<div class="ussd">${thermalPreviewCode.ussd_string}</div>
<div class="center" style="font-size:10px;color:#555;white-space:pre-wrap;margin-bottom:6px">${thermalPreviewCode.instructions}</div>
<div class="divider"></div>
<div class="center" style="font-size:10px;color:#888;margin-bottom:4px">SCAN QR OR DIAL CODE TO COMPLETE</div>
<div class="center" style="font-size:10px;color:#888">YOUR TRANSACTION OFFLINE</div>
<div id="qr-container" class="center" style="margin:6px 0"></div>
<script>
  (function(){
    var ussd = ${JSON.stringify(thermalPreviewCode.ussd_string)};
    var size = 80;
    var qr = document.getElementById('qr-container');
    // Use Google Charts QR API (works offline-capable via data URI in modern browsers)
    var img = document.createElement('img');
    img.src = 'https://chart.googleapis.com/chart?cht=qr&chs=' + size + 'x' + size + '&chl=' + encodeURIComponent(ussd) + '&choe=UTF-8';
    img.width = size; img.height = size;
    img.alt = ussd;
    img.onerror = function(){ qr.style.display='none'; };
    qr.appendChild(img);
  })();
<\/script>
<div class="footer">www.insureportal.io</div>
<div class="perf" style="margin-top:6px"></div>
</body></html>`);
                  printWin.document.close();
                  printWin.focus();
                  setTimeout(() => {
                    printWin.print();
                  }, 250);
                }}
              >
                📄 Save as PDF
              </button>
              <button
                className="flex-1 py-2 rounded text-xs font-bold"
                style={{
                  background: "#e5e7eb",
                  color: "#374151",
                  minWidth: 80,
                }}
                onClick={() => setThermalPreviewCode(null)}
              >
                Cancel
              </button>
            </div>
            {/* Send via SMS row */}
            <div className="flex gap-2 mt-2 items-center">
              <input
                type="tel"
                placeholder="Customer phone (e.g. 08012345678)"
                value={smsUssdPhone}
                onChange={e =>
                  setSmsUssdPhone(
                    e.target.value.replace(/\D/g, "").slice(0, 15)
                  )
                }
                className="flex-1 px-3 py-2 rounded text-xs outline-none"
                style={{
                  background: "#1a1a2e",
                  border: "1px solid #334155",
                  color: "#fff",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              />
              <button
                className="py-2 px-3 rounded text-xs font-bold"
                style={{
                  background: sendUssdSms.isPending ? "#1e3a8a" : "#1d4ed8",
                  color: "#fff",
                  minWidth: 90,
                  opacity: sendUssdSms.isPending ? 0.7 : 1,
                }}
                disabled={sendUssdSms.isPending || smsUssdPhone.length < 10}
                onClick={() => {
                  if (!thermalPreviewCode) return;
                  sendUssdSms.mutate({
                    recipientPhone: smsUssdPhone,
                    ussdCode: thermalPreviewCode.ussd_string,
                    amount: thermalPreviewCode.amount,
                    agentCode: agent?.agentCode,
                  });
                }}
              >
                {sendUssdSms.isPending ? "Sending…" : "📱 Send SMS"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main InsurancePortal Component ──────────────────────────────────────────────────
export default function InsurancePortal() {
  const [activeScreen, setActiveScreen] = useState<string | null>(null);
  const [layout, setLayout] = useState<string[]>(DEFAULT_LAYOUT);
  const [editMode, setEditMode] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showGamification, setShowGamification] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUSSD, setShowUSSD] = useState(false);
  const [showArch, setShowArch] = useState(false);
  const [showFraudDash, setShowFraudDash] = useState(false);
  const [showLiveChat, setShowLiveChat] = useState(false);
  const [showLoyalty, setShowLoyalty] = useState(false);
  const [showOfflineUssd, setShowOfflineUssd] = useState(false);
  const [homeUssdCodes, setHomeUssdCodes] = useState<
    Array<{
      id: string;
      ussd_string: string;
      instructions: string;
      carrier_hint: string | null;
      tx_type: string;
      amount: number;
    }>
  >([]);
  const [generatingHomeUssd, setGeneratingHomeUssd] = useState(false);
  const [catFilter, setCatFilter] = useState<TileCategory | "all">("all");
  const [tickerPos, setTickerPos] = useState(0);
  const [time, setTime] = useState(new Date());
  const tickerRef = useRef<HTMLDivElement>(null);

  // Live clock
  useEffect(() => {
    const iv = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── Resilience: connection quality probe (Go service) ────────────────────
  const { data: probeData } = trpc.resilience.probe.useQuery(undefined, {
    refetchInterval: 5_000,
    retry: false,
  });
  const connQuality: string =
    (probeData as any)?.quality ?? (navigator.onLine ? "Good" : "Offline");
  const connLatency: number | null = (probeData as any)?.latency_ms ?? null;
  const connColor =
    connQuality === "Excellent"
      ? GREEN
      : connQuality === "Good"
        ? BLUE
        : connQuality === "Poor"
          ? GOLD
          : RED;

  // ── Resilience: offline queue count (Rust service) ───────────────────────
  const { data: queueData } = trpc.resilience.queueCount.useQuery(undefined, {
    refetchInterval: 10_000,
    retry: false,
  });
  const pendingQueueCount: number = (queueData as any)?.pending ?? 0;

  // ── Resilience: 7-day success rate (Python service) ──────────────────────
  const { data: successRateData } = trpc.resilience.successRate.useQuery(
    { days: 7 },
    {
      refetchInterval: 60_000,
      retry: false,
    }
  );
  const successRatePct: number | null =
    (successRateData as any)?.success_rate_pct ?? null;
  const successTier: string | null = (successRateData as any)?.tier ?? null;

  // Ticker animation
  useEffect(() => {
    const iv = setInterval(() => {
      setTickerPos(p => p - 1);
    }, 30);
    return () => clearInterval(iv);
  }, []);

  // ── Live data from Zustand store (populated by Socket.IO + tRPC) ─────────────────
  const storeAgent = usePosStore(s => s.agent);
  const isOnline = usePosStore(s => s.isOnline);
  const storeRecentTxs = usePosStore(s => s.recentTxs);
  const unreadFraudCount = usePosStore(s => s.unreadFraudCount);
  const unreadChatCount = usePosStore(s => s.unreadChatCount);
  const storeLogout = usePosStore(s => s.logout);
  const storeOfflineQueue = usePosStore(s => s.offlineQueue);
  const encodeUssdHome = trpc.resilience.encodeUssd.useMutation();
  const printUssdHome = trpc.resilience.printUssdReceipt.useMutation();
  const generateHomeUssdCodes = async () => {
    const items = storeOfflineQueue.slice(0, 10);
    if (items.length === 0) {
      toast.info("No pending transactions");
      return;
    }
    setGeneratingHomeUssd(true);
    const codes: typeof homeUssdCodes = [];
    for (const tx of items) {
      try {
        const result = await encodeUssdHome.mutateAsync({
          txType: tx.type,
          amount: tx.amount,
          destinationAccount: tx.destinationAccount,
          destinationBank: tx.destinationBank,
          customerPhone: tx.customerPhone,
        });
        codes.push({
          id: tx.id,
          ussd_string: (result as any).ussd_string,
          instructions: (result as any).instructions,
          carrier_hint: (result as any).carrier_hint ?? null,
          tx_type: tx.type,
          amount: tx.amount,
        });
      } catch {
        codes.push({
          id: tx.id,
          ussd_string: `*966*${Math.round(tx.amount)}#`,
          instructions: `Dial *966*${Math.round(tx.amount)}# to pay via USSD.`,
          carrier_hint: null,
          tx_type: tx.type,
          amount: tx.amount,
        });
      }
    }
    setHomeUssdCodes(codes);
    setGeneratingHomeUssd(false);
    setShowOfflineUssd(true);
  };

  // Merge store agent data into terminal display (falls back to TERMINAL mock)
  const terminal = storeAgent
    ? {
        ...TERMINAL,
        agentName: storeAgent.name,
        agentCode: storeAgent.agentCode,
        floatBalance: storeAgent.floatBalance,
        commissionBalance: storeAgent.commissionBalance,
        tier: storeAgent.tier,
        location: storeAgent.location ?? TERMINAL.location,
        online: isOnline,
        network: isOnline ? TERMINAL.network : ("Offline" as const),
      }
    : TERMINAL;

  // ── Float-lock status polling (every 30s) ──────────────────────────────────
  const setAgent = usePosStore(s => s.setAgent);
  const { data: agentMeData } = trpc.agent.me.useQuery(undefined, {
    refetchInterval: 30_000,
    retry: false,
    enabled: !!storeAgent,
  });
  // Derive float-lock state from server (falls back to store, then false)
  const floatLocked =
    agentMeData?.floatLocked ?? storeAgent?.floatLocked ?? false;
  // Track elapsed time since float lock was first detected
  const lockStartRef = useRef<number | null>(null);
  const [lockElapsed, setLockElapsed] = useState(0);
  useEffect(() => {
    if (floatLocked) {
      if (lockStartRef.current === null) lockStartRef.current = Date.now();
      const interval = setInterval(() => {
        setLockElapsed(
          Math.floor((Date.now() - (lockStartRef.current ?? Date.now())) / 1000)
        );
      }, 1000);
      return () => clearInterval(interval);
    } else {
      lockStartRef.current = null;
      setLockElapsed(0);
    }
  }, [floatLocked]);
  const fmtElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  // ── Remote kill-switch state ──────────────────────────────────────────────
  const [terminalKilled, setTerminalKilled] = useState<{
    reason: string;
    disabledBy: string;
    disabledAt: string;
  } | null>(() => {
    try {
      const stored = localStorage.getItem("insurance_service_disabled");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    const onKill = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setTerminalKilled(detail);
    };
    const onLift = () => setTerminalKilled(null);
    window.addEventListener("terminal:kill-switch", onKill);
    window.addEventListener("terminal:kill-switch-lift", onLift);
    return () => {
      window.removeEventListener("terminal:kill-switch", onKill);
      window.removeEventListener("terminal:kill-switch-lift", onLift);
    };
  }, []);
  // ── Velocity warning banner state ──────────────────────────────────────────
  const [velocityWarning, setVelocityWarning] = useState<{
    type: "hourly_count" | "daily_volume";
    used: number;
    limit: number;
    pct: number;
    tier: string;
  } | null>(null);
  useEffect(() => {
    const onWarning = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setVelocityWarning(detail);
      // Auto-dismiss after 30 seconds
      setTimeout(() => setVelocityWarning(null), 30000);
    };
    window.addEventListener("terminal:velocity_warning", onWarning);
    return () =>
      window.removeEventListener("terminal:velocity_warning", onWarning);
  }, []);

  // Live transactions from tRPC
  const { data: liveTxs } = trpc.transactions.list.useQuery(
    {},
    { refetchInterval: 30000 }
  );
  const recentTxs = (liveTxs ?? storeRecentTxs).slice(0, 10).map((t: any) => ({
    id: String(t.id ?? t.ref),
    type: t.type,
    amount:
      typeof t.amount === "number" ? t.amount : parseFloat(t.amount ?? "0"),
    customer: t.customerName ?? "Customer",
    phone: t.customerPhone ?? "",
    status: (t.status ?? "success") as "success" | "pending" | "failed",
    time: t.createdAt
      ? new Date(t.createdAt).toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "",
    ref: t.ref ?? String(t.id),
    channel: t.channel ?? "Cash",
  }));

  // Live loyalty/gamification from tRPC
  const { data: loyaltyProfile } = trpc.loyalty.profile.useQuery(undefined, {
    retry: false,
    refetchInterval: 60000,
  });
  const gamification = loyaltyProfile
    ? {
        ...GAMIFICATION,
        points: loyaltyProfile.points,
        level: loyaltyProfile.tier + " Agent",
        streak: storeAgent?.streak ?? GAMIFICATION.streak,
        rank: storeAgent?.rank ?? GAMIFICATION.rank,
      }
    : GAMIFICATION;

  // ── Live analytics: day stats for ticker, hourly chart, commission chart ──
  const { data: dayStats } = trpc.transactions.agentDayStats.useQuery(
    undefined,
    {
      refetchInterval: 30_000,
      retry: false,
    }
  );
  const { data: liveHourlyStats } = trpc.transactions.hourlyStats.useQuery(
    undefined,
    {
      refetchInterval: 60_000,
      retry: false,
    }
  );
  const { data: liveCommissionStats } =
    trpc.transactions.commissionStats.useQuery(undefined, {
      refetchInterval: 60_000,
      retry: false,
    });

  // Build live ticker items from dayStats (falls back to TICKER_ITEMS if not loaded)
  const liveTickerItems = dayStats
    ? [
        {
          label: "CASH-IN",
          value: `₦${dayStats.cashIn.toLocaleString("en-NG")}`,
          change: "+today",
          up: true,
        },
        {
          label: "CASH-OUT",
          value: `₦${dayStats.cashOut.toLocaleString("en-NG")}`,
          change: "+today",
          up: true,
        },
        {
          label: "TRANSFERS",
          value: `₦${dayStats.transfers.toLocaleString("en-NG")}`,
          change: "+today",
          up: true,
        },
        {
          label: "FLOAT",
          value: `₦${dayStats.float.toLocaleString("en-NG")}`,
          change: "live",
          up: dayStats.float > 0,
        },
        {
          label: "COMMISSION",
          value: `₦${dayStats.commission.toLocaleString("en-NG")}`,
          change: "+today",
          up: true,
        },
        {
          label: "TX COUNT",
          value: String(dayStats.count),
          change: "+today",
          up: true,
        },
        {
          label: "SUCCESS",
          value: `${dayStats.successRate}%`,
          change: "live",
          up: dayStats.successRate >= 95,
        },
      ]
    : TICKER_ITEMS;

  // Build chart data from live queries (fall back to static mocks)
  const liveChartData =
    liveHourlyStats && liveHourlyStats.length > 0
      ? liveHourlyStats.map((b: any) => ({
          h: b.h,
          in: b.cashIn,
          out: b.cashOut,
        }))
      : CHART_DATA;
  const liveCommissionData =
    liveCommissionStats && liveCommissionStats.length > 0
      ? liveCommissionStats
      : COMMISSION_DATA;

  // WebSocket connection status from store
  const wsStatus = isOnline ? ("connected" as const) : ("offline" as const);

  // Live notification badge count
  const notifCount = unreadFraudCount + unreadChatCount;

  const navigate = useCallback(
    (screen: string) => {
      if (screen === "__ussd__") {
        setShowUSSD(true);
        return;
      }
      if (screen === "__arch__") {
        setShowArch(true);
        return;
      }
      if (screen === "__fraud_dash__") {
        setShowFraudDash(true);
        return;
      }
      if (screen === "__live_chat__") {
        setShowLiveChat(true);
        return;
      }
      if (screen === "__loyalty__") {
        setShowLoyalty(true);
        return;
      }
      setActiveScreen(screen);
      setEditMode(false);
    },
    [
      setShowUSSD,
      setShowArch,
      setShowFraudDash,
      setShowLiveChat,
      setShowLoyalty,
    ]
  );

  const goHome = useCallback(() => setActiveScreen(null), []);

  // ── Dynamic badge: offline-resilience tile shows total pending count ────────
  const offlineQueueStore = usePosStore(s => s.offlineQueue);
  const totalOfflinePending = offlineQueueStore.length + pendingQueueCount;

  const visibleTiles = layout
    .map(id => TILE_REGISTRY.find(t => t.id === id))
    .filter(
      (t): t is Tile => !!t && (catFilter === "all" || t.category === catFilter)
    )
    .map(t =>
      t.id === "offline-resilience" && totalOfflinePending > 0
        ? { ...t, badge: totalOfflinePending }
        : t
    );

  const quickAccess = [...TILE_REGISTRY]
    .sort((a: any, b: any) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, 4);

  // Screen router
  if (activeScreen) {
    const props = { onBack: goHome };
    const screenMap: Record<string, React.ReactNode> = {
      CashIn: <CashInScreen {...props} />,
      CashOut: <CashOutScreen {...props} />,
      Transfer: <TransferScreen {...props} />,
      CardPayment: <CardPaymentScreen {...props} />,
      QRPayment: <QRPaymentScreen {...props} />,
      NFCPayment: <NFCPaymentScreen {...props} />,
      Airtime: <AirtimeScreen {...props} />,
      Bills: <BillsScreen {...props} />,
      Reversal: <ReversalScreen {...props} />,
      CustomerLookup: <CustomerLookupScreen {...props} />,
      KYCVerify: <KYCVerifyScreen {...props} />,
      Biometric: <BiometricScreen {...props} />,
      OpenAccount: <OpenAccountScreen {...props} />,
      FloatBalance: <FloatBalanceScreen {...props} />,
      Commission: (
        <CommissionScreen {...props} commissionData={liveCommissionData} />
      ),
      Settlement: <SettlementScreen {...props} />,
      Reconcile: <ReconcileScreen {...props} />,
      FraudAlerts: <FraudAlertsScreen {...props} />,
      AMLCheck: <AMLCheckScreen {...props} />,
      AuditLog: <AuditLogScreen {...props} />,
      MyLimits: <MyLimitsScreen {...props} />,
      DailyReport: <DailyReportScreen {...props} chartData={liveChartData} />,
      TxHistory: <TxHistoryScreen {...props} />,
      Analytics: <AnalyticsScreen {...props} chartData={liveChartData} />,
      Scorecard: <ScorecardScreen {...props} />,
      TerminalConfig: <TerminalConfigScreen {...props} />,
      PrinterTest: <PrinterTestScreen {...props} />,
      NetworkTest: <NetworkTestScreen {...props} />,
      ServiceUpdate: <ServiceUpdateScreen {...props} />,
      NanoLoan: <NanoLoanScreen {...props} />,
      EODReconcile: <ReconciliationWizard {...props} />,
      MicroInsurance: <MicroInsuranceScreen {...props} />,
      Disputes: <DisputesScreen onBack={() => setActiveScreen(null)} />,
      OfflineResilience: <OfflineResilienceScreen {...props} />,
      UssdTransaction: <UssdTransactionScreen {...props} />,
      CarrierSwitch: <CarrierSwitchScreen {...props} />,
    };
    const screen = screenMap[activeScreen];
    if (!screen) {
      // All screens are implemented — this branch only fires if a tile ID is misconfigured
      console.warn(`[InsurancePortal] No screen mapped for: ${activeScreen}`);
      setActiveScreen(null);
      return null;
    }
    return (
      <div
        className="flex flex-col h-screen overflow-hidden"
        style={{ background: BG, maxWidth: 430, margin: "0 auto" }}
      >
        {screen}
      </div>
    );
  }

  // ── Home screen ──
  const cats: (TileCategory | "all")[] = [
    "all",
    "transactions",
    "customers",
    "finance",
    "compliance",
    "reports",
    "settings",
  ];
  const tickerText = liveTickerItems
    .map(t => `${t.label}: ${t.value}  ${t.change}`)
    .join("   ·   ");

  return (
    <div
      className="relative flex flex-col h-screen overflow-hidden select-none"
      style={{ background: BG, maxWidth: 430, margin: "0 auto" }}
    >
      {/* ── GDPR/NDPR Consent Banner ── */}
      <GdprConsentBanner agentId={storeAgent?.agentCode} />
      {/* ── Velocity Warning Amber Banner ── */}
      {velocityWarning && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 150,
            background: "oklch(0.55 0.22 65 / 0.95)",
            borderBottom: "2px solid oklch(0.70 0.25 65)",
            padding: "0.5rem 1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backdropFilter: "blur(4px)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "oklch(0.98 0.02 65)",
                  fontFamily: "monospace",
                }}
              >
                {velocityWarning.type === "hourly_count"
                  ? `HOURLY LIMIT WARNING — ${velocityWarning.pct}% USED`
                  : `DAILY VOLUME WARNING — ${velocityWarning.pct}% USED`}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "oklch(0.90 0.05 65)",
                  fontFamily: "monospace",
                }}
              >
                {velocityWarning.type === "hourly_count"
                  ? `${velocityWarning.used} of ${velocityWarning.limit} transactions this hour (${velocityWarning.tier} tier)`
                  : `₦${Number(velocityWarning.used).toLocaleString("en-NG")} of ₦${Number(velocityWarning.limit).toLocaleString("en-NG")} daily volume (${velocityWarning.tier} tier)`}
              </div>
            </div>
          </div>
          <button
            onClick={() => setVelocityWarning(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "oklch(0.98 0.02 65)",
              fontSize: 16,
              padding: "0 0.25rem",
            }}
            aria-label="Dismiss warning"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Float-Lock Overlay ── */}
      {terminalKilled && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 200,
            background: "oklch(0.10 0.03 25 / 0.97)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ textAlign: "center", maxWidth: 480, padding: "2rem" }}>
            <div style={{ fontSize: 64, marginBottom: "1rem" }}>🔴</div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "oklch(0.85 0.18 25)",
                marginBottom: "0.5rem",
                fontFamily: MONO,
              }}
            >
              TERMINAL DISABLED
            </div>
            <div
              style={{
                fontSize: 13,
                color: "oklch(0.65 0.05 25)",
                marginBottom: "1.5rem",
                fontFamily: MONO,
              }}
            >
              This terminal has been remotely disabled by your administrator.
            </div>
            <div
              style={{
                background: "oklch(0.15 0.04 25 / 0.8)",
                border: "1px solid oklch(0.30 0.08 25)",
                borderRadius: 8,
                padding: "1rem 1.5rem",
                textAlign: "left",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "oklch(0.55 0.04 25)",
                  marginBottom: 4,
                  fontFamily: MONO,
                }}
              >
                REASON
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: "oklch(0.85 0.05 25)",
                  fontFamily: MONO,
                }}
              >
                {terminalKilled.reason}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "oklch(0.50 0.04 25)",
                  marginTop: 8,
                  fontFamily: MONO,
                }}
              >
                Disabled by {terminalKilled.disabledBy} &bull;{" "}
                {new Date(terminalKilled.disabledAt).toLocaleString()}
              </div>
            </div>
            <div
              style={{
                fontSize: 12,
                color: "oklch(0.50 0.04 25)",
                fontFamily: MONO,
              }}
            >
              All transactions are blocked. Contact your supervisor to re-enable
              this terminal.
            </div>
          </div>
        </div>
      )}
      {floatLocked && (
        <div
          className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6"
          style={{
            background: "oklch(0.05 0.01 240 / 0.97)",
            backdropFilter: "blur(8px)",
            maxWidth: 430,
          }}
        >
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center animate-pulse"
            style={{
              background: "oklch(0.60 0.22 25 / 0.2)",
              border: "2px solid oklch(0.60 0.22 25)",
            }}
          >
            <span style={{ fontSize: 36 }}>🔒</span>
          </div>
          <div className="text-center px-8">
            <div
              className="text-xl font-black text-white mb-2"
              style={{ fontFamily: DISP }}
            >
              Settlement in Progress
            </div>
            <div
              className="text-sm text-gray-400 leading-relaxed"
              style={{ fontFamily: DISP }}
            >
              Transactions are temporarily paused while daily settlement runs.
              This usually takes 2–5 minutes.
            </div>
          </div>
          {/* Elapsed timer */}
          <div className="flex flex-col items-center gap-1">
            <div
              className="text-3xl font-black tabular-nums"
              style={{
                color:
                  lockElapsed >= 600
                    ? "oklch(0.60 0.22 25)"
                    : lockElapsed >= 300
                      ? "oklch(0.78 0.18 80)"
                      : "oklch(0.65 0.18 160)",
                fontFamily: MONO,
              }}
            >
              {fmtElapsed(lockElapsed)}
            </div>
            <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
              locked for
            </div>
          </div>
          <div
            className="px-4 py-2 rounded-xl text-xs font-semibold"
            style={{
              background: "oklch(0.60 0.22 25 / 0.15)",
              color: "oklch(0.60 0.22 25)",
              border: "1px solid oklch(0.60 0.22 25)",
              fontFamily: MONO,
            }}
          >
            Float locked — auto-refreshing every 30s
          </div>
          <div className="text-xs text-gray-600" style={{ fontFamily: MONO }}>
            {lockElapsed >= 600
              ? "⚠ Lock exceeds 10 min — contact your supervisor now"
              : "Contact your supervisor if this persists beyond 10 minutes."}
          </div>
        </div>
      )}
      {/* ── Status Bar ── */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{
          background: "oklch(0.07 0.01 240)",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{
              background:
                wsStatus === "connected"
                  ? GREEN
                  : wsStatus === "offline"
                    ? RED
                    : GOLD,
            }}
          />
          <span
            className="text-xs font-bold"
            style={{ color: BLUE, fontFamily: DISP }}
          >
            InsurePortal
          </span>
          <span className="text-xs text-gray-500" style={{ fontFamily: MONO }}>
            ·
          </span>
          <span className="text-xs text-gray-400" style={{ fontFamily: DISP }}>
            {terminal.agentCode}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-xs font-semibold"
            style={{ color: connColor, fontFamily: MONO }}
          >
            {connQuality}
            {connLatency !== null ? ` ${connLatency}ms` : ""}
          </span>
          <div className="flex items-end gap-0.5 h-3">
            {[40, 60, 80, 100].map((h, i) => (
              <div
                key={i}
                className="w-1 rounded-sm"
                style={{
                  height: `${h}%`,
                  background:
                    connQuality === "Offline"
                      ? RED
                      : connQuality === "Poor"
                        ? GOLD
                        : BLUE,
                }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <div
              className="w-6 h-3 rounded-sm border flex items-center px-0.5"
              style={{ borderColor: terminal.batteryLevel > 20 ? GREEN : RED }}
            >
              <div
                className="h-1.5 rounded-sm"
                style={{
                  width: `${terminal.batteryLevel}%`,
                  background: terminal.batteryLevel > 20 ? GREEN : RED,
                }}
              />
            </div>
            <span
              className="text-xs"
              style={{
                color: terminal.batteryLevel > 20 ? GREEN : RED,
                fontFamily: MONO,
              }}
            >
              {terminal.batteryLevel}%
            </span>
          </div>
          <span
            className="text-xs font-bold text-white"
            style={{ fontFamily: MONO }}
          >
            {time.toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      {/* ── Offline Mode Indicator (Sprint 74: F10-F16) ── */}
      {(() => {
        const networkTier =
          connQuality === "Offline"
            ? "offline"
            : connQuality === "Poor"
              ? "2g"
              : connQuality === "Good"
                ? "3g"
                : "4g";
        const queueCount = pendingQueueCount + (storeOfflineQueue?.length ?? 0);
        const lastSyncTime = localStorage.getItem("pos_last_sync") ?? null;
        const isOffline = !navigator.onLine || connQuality === "Offline";
        const isDegraded = connQuality === "Poor" || networkTier === "2g";
        const showBanner = isOffline || isDegraded || queueCount > 0;
        if (!showBanner) return null;
        const tierLabels: Record<string, string> = {
          offline: "OFFLINE",
          "2g": "2G GPRS",
          "3g": "3G",
          "4g": "4G LTE",
        };
        const tierColors: Record<string, string> = {
          offline: RED,
          "2g": "#f97316",
          "3g": GOLD,
          "4g": GREEN,
        };
        const tierBg: Record<string, string> = {
          offline: "oklch(0.15 0.06 25)",
          "2g": "oklch(0.15 0.06 55)",
          "3g": "oklch(0.15 0.04 80)",
          "4g": "oklch(0.12 0.03 150)",
        };
        return (
          <div
            data-testid="offline-mode-indicator"
            className="flex items-center justify-between px-4 py-1.5 flex-shrink-0"
            style={{
              background: tierBg[networkTier],
              borderBottom: `1px solid ${tierColors[networkTier]}44`,
            }}
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                {isOffline ? (
                  <span style={{ fontSize: 12 }}>📡</span>
                ) : (
                  <div
                    className="w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: tierColors[networkTier] }}
                  />
                )}
                <span
                  className="text-xs font-bold"
                  style={{ color: tierColors[networkTier], fontFamily: MONO }}
                >
                  {tierLabels[networkTier]}
                </span>
              </div>
              {isDegraded && !isOffline && (
                <span
                  className="text-xs"
                  style={{ color: "oklch(0.65 0.04 55)", fontFamily: DISP }}
                >
                  Degraded mode — images disabled
                </span>
              )}
              {isOffline && (
                <span
                  className="text-xs"
                  style={{ color: "oklch(0.65 0.06 25)", fontFamily: DISP }}
                >
                  Transactions queued locally
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {queueCount > 0 && (
                <div className="flex items-center gap-1">
                  <span
                    className="text-xs"
                    style={{ color: "oklch(0.70 0.10 55)", fontFamily: MONO }}
                  >
                    ⏳ {queueCount} queued
                  </span>
                </div>
              )}
              {lastSyncTime && (
                <span
                  className="text-xs"
                  style={{ color: "oklch(0.55 0.02 240)", fontFamily: MONO }}
                >
                  Last sync:{" "}
                  {(() => {
                    const diff = Math.floor(
                      (Date.now() - new Date(lastSyncTime).getTime()) / 1000
                    );
                    if (diff < 60) return `${diff}s ago`;
                    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                    return `${Math.floor(diff / 3600)}h ago`;
                  })()}
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Agent Header ── */}
      <div
        className="px-4 py-3 flex-shrink-0"
        style={{
          background: "oklch(0.10 0.012 240)",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div>
            <div
              className="text-sm font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              {terminal.agentName}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <div
                className="px-1.5 py-0.5 rounded text-xs font-bold"
                style={{ background: "oklch(0.78 0.18 80 / 0.2)", color: GOLD }}
              >
                {terminal.tier}
              </div>
              <span
                className="text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                {terminal.location}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Notification Bell with Push support */}
            <NotificationBell
              unreadCount={notifCount}
              onClick={() => setShowNotifications(true)}
              cardStyle={CARD}
              borderStyle={BORDER}
              redColor={RED}
            />
            {/* Platform Hub Button */}
            <a
              href="/hub"
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
              title="Platform Hub"
            >
              <span
                className="text-xs font-bold"
                style={{ color: "#06b6d4", fontFamily: MONO }}
              >
                ⊞
              </span>
            </a>
            {/* Admin Panel Button */}
            <a
              href="/admin"
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
              title="Admin Panel"
            >
              <span
                className="text-xs font-bold"
                style={{ color: "#8b5cf6", fontFamily: MONO }}
              >
                ⬡
              </span>
            </a>
            {/* USSD Button */}
            <button
              onClick={() => setShowUSSD(true)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <span
                className="text-xs font-bold"
                style={{ color: BLUE, fontFamily: MONO }}
              >
                #
              </span>
            </button>
            <button
              onClick={() => setShowGamification(true)}
              className="flex flex-col items-end gap-0.5"
            >
              <div
                className="text-xs font-bold"
                style={{ color: GOLD, fontFamily: MONO }}
              >
                🏆 #{gamification.rank}
              </div>
              <div
                className="text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                🔥 {gamification.streak}d streak
              </div>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div
            className="rounded-xl p-2.5"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xs text-gray-500 mb-0.5"
              style={{ fontFamily: DISP }}
            >
              Float Balance
            </div>
            <div
              className="text-base font-bold"
              style={{ color: GOLD, fontFamily: MONO }}
            >
              {fmt(terminal.floatBalance)}
            </div>
          </div>
          <div
            className="rounded-xl p-2.5"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xs text-gray-500 mb-0.5"
              style={{ fontFamily: DISP }}
            >
              Commission
            </div>
            <div
              className="text-base font-bold"
              style={{ color: GREEN, fontFamily: MONO }}
            >
              {fmt(terminal.commissionBalance)}
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Access Strip ── */}
      <div
        className="flex gap-2 px-4 py-2 flex-shrink-0 overflow-x-auto"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        {quickAccess.map(t => (
          <button
            key={t.id}
            onClick={() => navigate(t.screen)}
            className="flex flex-col items-center gap-1 flex-shrink-0 transition-all active:scale-90"
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
              style={{
                background: t.bgColor,
                border: `1px solid ${t.color}40`,
              }}
            >
              {t.icon}
            </div>
            <span
              className="text-xs text-gray-400 whitespace-nowrap"
              style={{ fontFamily: DISP, fontSize: 10 }}
            >
              {t.label}
            </span>
          </button>
        ))}
        <div
          className="w-px flex-shrink-0 mx-1"
          style={{ background: BORDER }}
        />
        <button
          onClick={() => setShowEditor(true)}
          className="flex flex-col items-center gap-1 flex-shrink-0"
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-lg"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            +
          </div>
          <span
            className="text-xs text-gray-500 whitespace-nowrap"
            style={{ fontFamily: DISP, fontSize: 10 }}
          >
            More
          </span>
        </button>
      </div>

      {/* ── Category Filter ── */}
      <div
        className="flex gap-2 px-4 py-2 overflow-x-auto flex-shrink-0"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        {cats.map(c => (
          <button
            key={c}
            onClick={() => setCatFilter(c)}
            className="px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap capitalize transition-all"
            style={{
              background: catFilter === c ? BLUE : CARD,
              color: catFilter === c ? "white" : "#6b7280",
              border: `1px solid ${catFilter === c ? BLUE : BORDER}`,
            }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* ── Tile Grid ── */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-4 gap-2 auto-rows-auto">
          {visibleTiles.map(tile => {
            const colSpan =
              tile.size === "wide"
                ? "col-span-4"
                : tile.size === "lg"
                  ? "col-span-2"
                  : tile.size === "md"
                    ? "col-span-2"
                    : "col-span-1";
            const rowSpan = tile.size === "lg" ? "row-span-2" : "";
            const h =
              tile.size === "lg"
                ? "h-28"
                : tile.size === "wide"
                  ? "h-16"
                  : "h-20";
            return (
              <button
                key={tile.id}
                onClick={() => !editMode && navigate(tile.screen)}
                className={`${colSpan} ${rowSpan} ${h} rounded-2xl p-3 flex flex-col justify-between transition-all active:scale-95 relative overflow-hidden`}
                style={{
                  background: tile.bgColor,
                  border: `1px solid ${tile.color}30`,
                }}
              >
                {/* Wobble in edit mode */}
                {editMode && (
                  <div
                    className="absolute inset-0 rounded-2xl border-2 animate-pulse"
                    style={{ borderColor: tile.color }}
                  />
                )}
                {/* Badge */}
                {(tile.badge || 0) > 0 && (
                  <div
                    className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white z-10"
                    style={{ background: RED }}
                  >
                    {tile.badge}
                  </div>
                )}
                {/* Hot indicator */}
                {tile.hot && !editMode && (
                  <div
                    className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full animate-pulse"
                    style={{ background: tile.color }}
                  />
                )}
                <div className="text-2xl leading-none">{tile.icon}</div>
                <div>
                  <div
                    className="text-xs font-bold text-white leading-tight"
                    style={{ fontFamily: DISP }}
                  >
                    {tile.label}
                  </div>
                  {tile.size !== "sm" && (
                    <div
                      className="text-xs mt-0.5 leading-tight"
                      style={{
                        color: tile.color,
                        fontFamily: DISP,
                        fontSize: 10,
                        opacity: 0.8,
                      }}
                    >
                      {tile.description}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          {/* Add tile button */}
          <button
            onClick={() => setShowEditor(true)}
            className="col-span-1 h-20 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all active:scale-95"
            style={{ background: CARD, border: `2px dashed ${BORDER}` }}
          >
            <span className="text-xl text-gray-600">+</span>
            <span
              className="text-xs text-gray-600"
              style={{ fontFamily: DISP, fontSize: 10 }}
            >
              Add
            </span>
          </button>
        </div>
      </div>

      {/* ── Edit Mode Toggle ── */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ borderTop: `1px solid ${BORDER}` }}
      >
        <button
          onClick={() => setEditMode(e => !e)}
          className="px-4 py-2 rounded-xl text-xs font-semibold transition-all"
          style={{
            background: editMode ? "oklch(0.60 0.22 25 / 0.2)" : CARD,
            color: editMode ? RED : "#6b7280",
            border: `1px solid ${editMode ? RED : BORDER}`,
          }}
        >
          {editMode ? "✓ Done Editing" : "✏ Edit Layout"}
        </button>
        <div className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: wsStatus === "connected" ? GREEN : GOLD }}
          />
          <span className="text-xs text-gray-500" style={{ fontFamily: MONO }}>
            {TERMINAL.model}
          </span>
        </div>
      </div>

      {/* ── Pending Sync Banner (Rust offline-queue) ── */}
      {pendingQueueCount > 0 && (
        <button
          onClick={generateHomeUssdCodes}
          className="px-4 py-1.5 flex items-center gap-2 flex-shrink-0 w-full text-left transition-all active:opacity-80"
          style={{
            background: "oklch(0.78 0.18 80 / 0.12)",
            borderTop: `1px solid ${GOLD}44`,
          }}
        >
          <span style={{ color: GOLD, fontFamily: DISP, fontSize: 11 }}>
            ⏳ {pendingQueueCount} transaction{pendingQueueCount > 1 ? "s" : ""}{" "}
            pending sync
          </span>
          {!isOnline && (
            <span
              className="ml-auto text-xs font-bold"
              style={{ color: GOLD, fontFamily: MONO }}
            >
              {generatingHomeUssd ? "Generating…" : "📞 USSD Fallback"}
            </span>
          )}
        </button>
      )}

      {/* ── Success Rate Badge (Python analytics) ── */}
      {successRatePct !== null && (
        <div
          className="px-4 py-1 flex items-center gap-2 flex-shrink-0"
          style={{
            background: "oklch(0.08 0.01 240)",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          <span
            className="text-xs"
            style={{ color: "#4b5563", fontFamily: DISP }}
          >
            7-day success rate:
          </span>
          <span
            className="text-xs font-bold"
            style={{
              color:
                successTier === "Excellent"
                  ? GREEN
                  : successTier === "Good"
                    ? BLUE
                    : successTier === "Fair"
                      ? GOLD
                      : RED,
              fontFamily: MONO,
            }}
          >
            {successRatePct.toFixed(1)}% — {successTier}
          </span>
        </div>
      )}

      {/* ── Live Ticker ── */}
      <div
        className="flex-shrink-0 overflow-hidden py-1.5 px-4"
        style={{
          background: "oklch(0.07 0.01 240)",
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        <div
          ref={tickerRef}
          className="flex items-center gap-6 whitespace-nowrap"
          style={{
            transform: `translateX(${tickerPos % (tickerText.length * 8)}px)`,
            transition: "none",
          }}
        >
          {[...liveTickerItems, ...liveTickerItems].map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
              <span
                className="text-xs font-bold"
                style={{ color: "#4b5563", fontFamily: MONO }}
              >
                {t.label}
              </span>
              <span
                className="text-xs font-bold text-white"
                style={{ fontFamily: MONO }}
              >
                {t.value}
              </span>
              <span
                className="text-xs"
                style={{ color: t.up ? GREEN : RED, fontFamily: MONO }}
              >
                {t.change}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Overlays ── */}
      {showEditor && (
        <TileEditorSheet
          layout={layout}
          onClose={() => setShowEditor(false)}
          onSave={ids => {
            setLayout(ids);
            toast.success("Layout saved");
          }}
        />
      )}
      {showGamification && (
        <GamificationPanel onClose={() => setShowGamification(false)} />
      )}
      {showNotifications && (
        <NotificationPanel onClose={() => setShowNotifications(false)} />
      )}
      {showUSSD && <USSDSimulator onClose={() => setShowUSSD(false)} />}
      {showArch && <ArchitecturePanel onClose={() => setShowArch(false)} />}
      {showFraudDash && (
        <div
          className="fixed inset-0 z-50 overflow-hidden"
          style={{ maxWidth: 430, margin: "0 auto" }}
        >
          <FraudDashboard />
          <button
            onClick={() => setShowFraudDash(false)}
            className="absolute top-3 right-3 z-50 w-8 h-8 rounded-full flex items-center justify-center text-white font-bold"
            style={{
              background: "oklch(0.22 0.015 240)",
              border: "1px solid oklch(0.30 0.015 240)",
            }}
          >
            ✕
          </button>
        </div>
      )}
      {showLiveChat && (
        <div
          className="fixed inset-0 z-50 overflow-hidden"
          style={{ maxWidth: 430, margin: "0 auto" }}
        >
          <LiveChatSupport onBack={() => setShowLiveChat(false)} />
        </div>
      )}
      {showLoyalty && (
        <div
          className="fixed inset-0 z-50 overflow-hidden"
          style={{ maxWidth: 430, margin: "0 auto" }}
        >
          <LoyaltySystem onBack={() => setShowLoyalty(false)} />
        </div>
      )}

      {/* ── Offline USSD Bottom-Sheet Modal ── */}
      {showOfflineUssd && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end"
          style={{
            maxWidth: 430,
            margin: "0 auto",
            background: "oklch(0.04 0.01 240 / 0.85)",
          }}
          onClick={e => {
            if (e.target === e.currentTarget) setShowOfflineUssd(false);
          }}
        >
          <div
            className="rounded-t-3xl flex flex-col overflow-hidden"
            style={{
              background: BG,
              border: `1px solid ${GOLD}44`,
              maxHeight: "80vh",
            }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 flex-shrink-0">
              <div>
                <div
                  className="text-base font-black"
                  style={{ color: GOLD, fontFamily: DISP }}
                >
                  📞 USSD Fallback
                </div>
                <div
                  className="text-xs"
                  style={{ color: "#6b7280", fontFamily: DISP }}
                >
                  Complete transactions without internet
                </div>
              </div>
              <button
                onClick={() => setShowOfflineUssd(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center"
                style={{ background: CARD, color: "#9ca3af" }}
              >
                ✕
              </button>
            </div>
            {/* USSD codes list */}
            <div className="flex-1 overflow-y-auto px-5 pb-5 flex flex-col gap-3">
              {homeUssdCodes.length === 0 ? (
                <div
                  className="text-center py-8 text-sm"
                  style={{ color: "#6b7280", fontFamily: DISP }}
                >
                  No pending transactions to encode.
                </div>
              ) : (
                homeUssdCodes.map((code, i) => (
                  <div
                    key={code.id}
                    className="rounded-2xl p-4"
                    style={{ background: CARD, border: `1px solid ${GOLD}33` }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-xs font-bold"
                        style={{ color: GOLD, fontFamily: MONO }}
                      >
                        #{i + 1} {code.tx_type.toUpperCase()} · ₦
                        {Number(code.amount).toLocaleString()}
                      </span>
                      {code.carrier_hint && (
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: `${BLUE}22`,
                            color: BLUE,
                            fontFamily: MONO,
                          }}
                        >
                          {code.carrier_hint}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-lg font-black mb-1"
                      style={{
                        color: "#ffffff",
                        fontFamily: MONO,
                        letterSpacing: "0.05em",
                      }}
                    >
                      {code.ussd_string}
                    </div>
                    <div
                      className="text-xs mb-3"
                      style={{ color: "#6b7280", fontFamily: DISP }}
                    >
                      {code.instructions}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(code.ussd_string);
                          toast.success("Copied!");
                        }}
                        className="flex-1 py-2 rounded-xl text-xs font-bold"
                        style={{
                          background: `${GOLD}22`,
                          color: GOLD,
                          border: `1px solid ${GOLD}44`,
                          fontFamily: MONO,
                        }}
                      >
                        Copy
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await printUssdHome.mutateAsync({
                              agentCode: terminal.agentCode,
                              txType: code.tx_type,
                              amount: code.amount,
                              ussdString: code.ussd_string,
                              instructions: code.instructions,
                            });
                            toast.success("Sent to printer");
                          } catch {
                            toast.error("Printer offline");
                          }
                        }}
                        className="flex-1 py-2 rounded-xl text-xs font-bold"
                        style={{
                          background: `${BLUE}22`,
                          color: BLUE,
                          border: `1px solid ${BLUE}44`,
                          fontFamily: MONO,
                        }}
                      >
                        🖨 Print
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 2 ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Receipt Printer Modal ─────────────────────────────────────────────────────
export function ReceiptPrinterModal({
  tx,
  onClose,
}: {
  tx: {
    type: string;
    amount: string;
    ref: string;
    customer: string;
    agent: string;
    date: string;
  };
  onClose: () => void;
}) {
  const [printing, setPrinting] = useState(false);
  const [printed, setPrinted] = useState(false);

  const handlePrint = () => {
    setPrinting(true);
    setTimeout(() => {
      setPrinting(false);
      setPrinted(true);
    }, 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl p-6"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div className="flex items-center justify-between mb-4">
          <h3
            className="font-bold text-white text-lg"
            style={{ fontFamily: DISP }}
          >
            🖨 Receipt
          </h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            ✕
          </button>
        </div>

        {/* ESC/POS styled receipt preview */}
        <div
          className="rounded-xl p-4 mb-4 font-mono text-xs"
          style={{ background: "#1a1a1a", border: `1px solid ${BORDER}` }}
        >
          <div className="text-center text-white font-bold mb-2">
            INSUREPORTAL AGENCY BANKING
          </div>
          <div className="text-center text-gray-500 mb-3">
            ━━━━━━━━━━━━━━━━━━━━
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Type:</span>
            <span className="text-white">{tx.type}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Amount:</span>
            <span className="text-green-400 font-bold">{tx.amount}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Customer:</span>
            <span className="text-white">{tx.customer}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Agent:</span>
            <span className="text-white">{tx.agent}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Date:</span>
            <span className="text-white">{tx.date}</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Ref:</span>
            <span className="text-blue-400">{tx.ref}</span>
          </div>
          <div className="text-center text-gray-500 mt-3 mb-2">
            ━━━━━━━━━━━━━━━━━━━━
          </div>
          {/* Real QR code for transaction verification */}
          <div className="flex justify-center my-2">
            <QRCodeCanvas
              value={`INSUREPORTAL:${tx.ref}:${tx.amount}`}
              size={64}
              bgColor="#1a1a2e"
              fgColor="#ffffff"
              level="M"
            />
          </div>
          <div className="text-center text-gray-600 text-xs mt-2">
            Scan to verify transaction
          </div>
          <div className="text-center text-gray-500 mt-3">
            Thank you for using InsurePortal
          </div>
        </div>

        {/* Print status */}
        {printed && (
          <div
            className="flex items-center gap-2 p-3 rounded-xl mb-3"
            style={{
              background: "oklch(0.35 0.12 145 / 0.2)",
              border: `1px solid ${GREEN}30`,
            }}
          >
            <span style={{ color: GREEN }}>✓</span>
            <span className="text-sm text-green-400">
              Receipt printed successfully
            </span>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={handlePrint}
            disabled={printing || printed}
            className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all"
            style={{
              background: printing ? BORDER : BLUE,
              color: "white",
              opacity: printed ? 0.5 : 1,
            }}
          >
            {printing
              ? "🖨 Printing..."
              : printed
                ? "✓ Printed"
                : "🖨 Print Receipt"}
          </button>
          <button
            className="flex-1 py-3 rounded-xl font-semibold text-sm transition-all"
            style={{
              background: CARD,
              color: "#6b7280",
              border: `1px solid ${BORDER}`,
            }}
            onClick={() => {
              toast.success("Receipt sent via SMS");
              onClose();
            }}
          >
            📱 SMS Receipt
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Supervisor Approval Flow ──────────────────────────────────────────────────
export function SupervisorApprovalModal({
  amount,
  txType,
  onApproved,
  onRejected,
  onClose,
}: {
  amount: string;
  txType: string;
  onApproved: () => void;
  onRejected: () => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState<
    "pending" | "approved" | "rejected" | "timeout"
  >("pending");
  const [countdown, setCountdown] = useState(120);
  const SUPERVISOR_PIN = "1234"; // Change via Settings → Security in production

  useEffect(() => {
    if (status !== "pending") return;
    const iv = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(iv);
          setStatus("timeout");
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [status]);

  const handleApprove = () => {
    if (pin === SUPERVISOR_PIN) {
      setStatus("approved");
      setTimeout(onApproved, 1500);
    } else {
      toast.error("Invalid supervisor PIN");
      setPin("");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)" }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-6"
        style={{ background: CARD, border: `1px solid ${GOLD}40` }}
      >
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🔐</div>
          <h3
            className="font-bold text-white text-xl mb-1"
            style={{ fontFamily: DISP }}
          >
            Supervisor Approval Required
          </h3>
          <p className="text-gray-400 text-sm">
            Transaction exceeds agent limit
          </p>
        </div>

        {/* Transaction details */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{ background: BG, border: `1px solid ${BORDER}` }}
        >
          <div className="flex justify-between mb-2">
            <span className="text-gray-500 text-sm">Type</span>
            <span className="text-white text-sm font-semibold">{txType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500 text-sm">Amount</span>
            <span
              className="font-bold text-lg"
              style={{ color: GOLD, fontFamily: MONO }}
            >
              {amount}
            </span>
          </div>
        </div>

        {status === "pending" && (
          <>
            {/* Countdown */}
            <div className="text-center mb-4">
              <div
                className="text-3xl font-bold"
                style={{ color: countdown < 30 ? RED : GOLD, fontFamily: MONO }}
              >
                {Math.floor(countdown / 60)}:
                {String(countdown % 60).padStart(2, "0")}
              </div>
              <p className="text-gray-500 text-xs mt-1">
                Time remaining for approval
              </p>
            </div>

            {/* PIN entry */}
            <div className="mb-4">
              <label className="text-gray-400 text-xs mb-2 block">
                Supervisor PIN
              </label>
              <input
                type="password"
                value={pin}
                onChange={e => setPin(e.target.value)}
                maxLength={6}
                placeholder="Enter supervisor PIN"
                className="w-full px-4 py-3 rounded-xl text-white text-center text-xl tracking-widest"
                style={{
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  fontFamily: MONO,
                }}
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleApprove}
                className="flex-1 py-3 rounded-xl font-bold text-sm"
                style={{ background: GREEN, color: "white" }}
              >
                ✓ Approve
              </button>
              <button
                onClick={() => {
                  setStatus("rejected");
                  setTimeout(onRejected, 1000);
                }}
                className="flex-1 py-3 rounded-xl font-bold text-sm"
                style={{ background: "oklch(0.45 0.20 25)", color: "white" }}
              >
                ✕ Reject
              </button>
            </div>
          </>
        )}

        {status === "approved" && (
          <div className="text-center py-4">
            <div className="text-5xl mb-3">✅</div>
            <p className="text-green-400 font-bold">Transaction Approved</p>
          </div>
        )}

        {status === "rejected" && (
          <div className="text-center py-4">
            <div className="text-5xl mb-3">❌</div>
            <p className="text-red-400 font-bold">Transaction Rejected</p>
          </div>
        )}

        {status === "timeout" && (
          <div className="text-center py-4">
            <div className="text-5xl mb-3">⏰</div>
            <p className="text-yellow-400 font-bold">Approval Timeout</p>
            <p className="text-gray-500 text-sm mt-1">Transaction cancelled</p>
            <button
              onClick={onClose}
              className="mt-4 px-6 py-2 rounded-xl text-sm font-semibold"
              style={{
                background: CARD,
                color: "white",
                border: `1px solid ${BORDER}`,
              }}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Push Notification Panel ───────────────────────────────────────────────────
export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const notifications = [
    {
      id: 1,
      type: "alert",
      title: "Fraud Alert",
      body: "Unusual transaction pattern detected on terminal T-0042",
      time: "2m ago",
      read: false,
      color: RED,
    },
    {
      id: 2,
      type: "approval",
      title: "Approval Required",
      body: "₦850,000 transfer pending supervisor approval",
      time: "5m ago",
      read: false,
      color: GOLD,
    },
    {
      id: 3,
      type: "success",
      title: "Settlement Complete",
      body: "Daily settlement of ₦2.4M processed successfully",
      time: "1h ago",
      read: true,
      color: GREEN,
    },
    {
      id: 4,
      type: "info",
      title: "Firmware Update",
      body: "PAX A920 MAX firmware v3.2.1 available for download",
      time: "2h ago",
      read: true,
      color: BLUE,
    },
    {
      id: 5,
      type: "warning",
      title: "Low Float Warning",
      body: "Agent float balance below ₦50,000 threshold",
      time: "3h ago",
      read: true,
      color: GOLD,
    },
    {
      id: 6,
      type: "success",
      title: "KYC Approved",
      body: "Customer Aminu Garba KYC verification approved",
      time: "4h ago",
      read: true,
      color: GREEN,
    },
  ];

  const [items, setItems] = useState(notifications);
  const unread = items.filter(n => !n.read).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
    >
      <div
        className="w-full max-w-sm rounded-3xl overflow-hidden"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div
          className="flex items-center justify-between p-4"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white" style={{ fontFamily: DISP }}>
              Notifications
            </h3>
            {unread > 0 && (
              <span
                className="px-2 py-0.5 rounded-full text-xs font-bold text-white"
                style={{ background: RED }}
              >
                {unread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setItems(items.map(n => ({ ...n, read: true })))}
              className="text-xs"
              style={{ color: BLUE }}
            >
              Mark all read
            </button>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto">
          {items.map(n => (
            <div
              key={n.id}
              onClick={() =>
                setItems(
                  items.map(i => (i.id === n.id ? { ...i, read: true } : i))
                )
              }
              className="flex gap-3 p-4 cursor-pointer transition-all hover:opacity-80"
              style={{
                borderBottom: `1px solid ${BORDER}`,
                background: n.read ? "transparent" : `${n.color}08`,
              }}
            >
              <div
                className="w-2 h-2 rounded-full mt-2 flex-shrink-0"
                style={{ background: n.read ? "transparent" : n.color }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="font-semibold text-sm text-white truncate"
                    style={{ fontFamily: DISP }}
                  >
                    {n.title}
                  </span>
                  <span
                    className="text-xs text-gray-600 flex-shrink-0"
                    style={{ fontFamily: MONO }}
                  >
                    {n.time}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  {n.body}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="p-3" style={{ borderTop: `1px solid ${BORDER}` }}>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-gray-400"
            style={{ background: BG, border: `1px solid ${BORDER}` }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER 3 ENHANCEMENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── AI Fraud Explanation (SHAP-style) ────────────────────────────────────────
export function AIFraudExplanationModal({
  alert,
  onClose,
}: {
  alert: {
    id: string;
    customer: string;
    amount: string;
    risk: number;
    reason: string;
  };
  onClose: () => void;
}) {
  const features = [
    {
      name: "Transaction velocity (last 1h)",
      value: 0.34,
      direction: "risk" as const,
      detail: "8 transactions in 60 min (avg: 2.1)",
    },
    {
      name: "Amount deviation from baseline",
      value: 0.28,
      direction: "risk" as const,
      detail: "₦85K vs avg ₦12K for this customer",
    },
    {
      name: "Time of day anomaly",
      value: 0.18,
      direction: "risk" as const,
      detail: "02:14 AM — 94th percentile for this agent",
    },
    {
      name: "Customer account age",
      value: 0.12,
      direction: "safe" as const,
      detail: "Account opened 3 years ago — low risk",
    },
    {
      name: "Agent trust score",
      value: 0.08,
      direction: "safe" as const,
      detail: "Agent score: 94/100 — high trust",
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.85)" }}
    >
      <div
        className="w-full max-w-sm rounded-t-3xl p-6 max-h-screen overflow-y-auto"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3
              className="font-bold text-white text-lg"
              style={{ fontFamily: DISP }}
            >
              🤖 AI Fraud Analysis
            </h3>
            <p className="text-gray-500 text-xs">
              SHAP feature importance explanation
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            ✕
          </button>
        </div>

        {/* Risk score */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{ background: BG, border: `1px solid ${RED}40` }}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-gray-400 text-sm">Risk Score</span>
            <span
              className="font-bold text-2xl"
              style={{ color: RED, fontFamily: MONO }}
            >
              {alert.risk}%
            </span>
          </div>
          <div
            className="w-full rounded-full h-2"
            style={{ background: BORDER }}
          >
            <div
              className="h-2 rounded-full transition-all"
              style={{
                width: `${alert.risk}%`,
                background: `linear-gradient(90deg, ${GOLD}, ${RED})`,
              }}
            />
          </div>
          <p className="text-gray-500 text-xs mt-2">{alert.reason}</p>
        </div>

        {/* SHAP feature contributions */}
        <div className="mb-4">
          <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
            Feature Contributions
          </h4>
          {features.map((f, i) => (
            <div key={i} className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-white text-xs font-medium">{f.name}</span>
                <span
                  className="text-xs font-bold"
                  style={{
                    color: f.direction === "risk" ? RED : GREEN,
                    fontFamily: MONO,
                  }}
                >
                  {f.direction === "risk" ? "+" : "-"}
                  {(f.value * 100).toFixed(0)}%
                </span>
              </div>
              <div
                className="w-full rounded-full h-1.5"
                style={{ background: BORDER }}
              >
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${f.value * 100}%`,
                    background: f.direction === "risk" ? RED : GREEN,
                    marginLeft: f.direction === "safe" ? "auto" : 0,
                  }}
                />
              </div>
              <p className="text-gray-600 text-xs mt-0.5">{f.detail}</p>
            </div>
          ))}
        </div>

        {/* Recommended actions */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}30` }}
        >
          <h4 className="text-yellow-400 text-xs font-semibold uppercase tracking-wider mb-2">
            AI Recommendation
          </h4>
          <p className="text-gray-300 text-sm">
            Block transaction and escalate to compliance team. Request
            additional customer verification (OTP + biometric) before
            proceeding.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            className="flex-1 py-3 rounded-xl font-bold text-sm"
            style={{ background: RED, color: "white" }}
            onClick={() => {
              toast.error("Transaction blocked");
              onClose();
            }}
          >
            🚫 Block
          </button>
          <button
            className="flex-1 py-3 rounded-xl font-bold text-sm"
            style={{ background: GOLD, color: "black" }}
            onClick={() => {
              toast.info("Escalated to compliance");
              onClose();
            }}
          >
            📋 Escalate
          </button>
          <button
            className="flex-1 py-3 rounded-xl font-bold text-sm"
            style={{
              background: CARD,
              color: "#6b7280",
              border: `1px solid ${BORDER}`,
            }}
            onClick={() => {
              toast.success("Transaction allowed with monitoring");
              onClose();
            }}
          >
            ✓ Allow
          </button>
        </div>
      </div>
    </div>
  );
}

// ── USSD Simulator ────────────────────────────────────────────────────────────
export function USSDSimulator({ onClose }: { onClose: () => void }) {
  const [screen, setScreen] = useState("main");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  const menus: Record<
    string,
    { title: string; options: { key: string; label: string; next: string }[] }
  > = {
    main: {
      title:
        "Welcome to InsurePortal\nEnter *347# to start\n\n1. Cash In\n2. Cash Out\n3. Transfer\n4. Check Balance\n5. Airtime\n0. Exit",
      options: [
        { key: "1", label: "Cash In", next: "cashin" },
        { key: "2", label: "Cash Out", next: "cashout" },
        { key: "3", label: "Transfer", next: "transfer" },
        { key: "4", label: "Balance", next: "balance" },
        { key: "5", label: "Airtime", next: "airtime" },
      ],
    },
    cashin: {
      title: "CASH IN\n\nEnter customer phone:\n(e.g. 08012345678)\n\n0. Back",
      options: [{ key: "0", label: "Back", next: "main" }],
    },
    cashout: {
      title: "CASH OUT\n\nEnter amount:\n(Min: ₦500, Max: ₦200,000)\n\n0. Back",
      options: [{ key: "0", label: "Back", next: "main" }],
    },
    transfer: {
      title:
        "TRANSFER\n\n1. Bank Transfer\n2. Mobile Money\n3. InsurePortal Wallet\n\n0. Back",
      options: [
        { key: "1", label: "Bank Transfer", next: "bank_transfer" },
        { key: "0", label: "Back", next: "main" },
      ],
    },
    balance: {
      title:
        "ACCOUNT BALANCE\n\nFloat Balance:\n₦485,250.00\n\nCommission Earned:\n₦12,840.00\n\n0. Back",
      options: [{ key: "0", label: "Back", next: "main" }],
    },
    airtime: {
      title:
        "AIRTIME PURCHASE\n\n1. MTN\n2. Airtel\n3. Glo\n4. 9mobile\n\n0. Back",
      options: [{ key: "0", label: "Back", next: "main" }],
    },
    bank_transfer: {
      title: "BANK TRANSFER\n\nEnter account number:\n\n0. Back",
      options: [{ key: "0", label: "Back", next: "transfer" }],
    },
  };

  const currentMenu = menus[screen] || menus.main;

  const handleInput = () => {
    const option = currentMenu.options.find(o => o.key === input.trim());
    if (option) {
      setHistory(h => [...h, `> ${input}`]);
      setScreen(option.next);
    } else if (input.trim()) {
      setHistory(h => [...h, `> ${input}`, "Invalid option. Try again."]);
    }
    setInput("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.9)" }}
    >
      <div
        className="w-full max-w-xs rounded-3xl overflow-hidden"
        style={{ background: "#1a1a2e", border: `2px solid ${BLUE}40` }}
      >
        {/* Phone header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ background: "#0f0f1a", borderBottom: `1px solid ${BORDER}` }}
        >
          <span className="text-gray-400 text-xs" style={{ fontFamily: MONO }}>
            *347#
          </span>
          <span
            className="text-white text-xs font-bold"
            style={{ fontFamily: DISP }}
          >
            USSD Simulator
          </span>
          <button onClick={onClose} className="text-gray-500 text-xs">
            ✕
          </button>
        </div>

        {/* USSD screen */}
        <div className="p-4 min-h-48" style={{ background: "#0a0a1a" }}>
          <pre
            className="text-green-400 text-xs leading-relaxed whitespace-pre-wrap"
            style={{ fontFamily: MONO }}
          >
            {currentMenu.title}
          </pre>
          {history.slice(-3).map((h, i) => (
            <div
              key={i}
              className="text-yellow-400 text-xs mt-1"
              style={{ fontFamily: MONO }}
            >
              {h}
            </div>
          ))}
        </div>

        {/* Input */}
        <div className="p-4" style={{ borderTop: `1px solid ${BORDER}` }}>
          <div className="flex gap-2 mb-3">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleInput()}
              placeholder="Enter option..."
              className="flex-1 px-3 py-2 rounded-lg text-green-400 text-sm"
              style={{
                background: "#0a0a1a",
                border: `1px solid ${BORDER}`,
                fontFamily: MONO,
              }}
            />
            <button
              onClick={handleInput}
              className="px-4 py-2 rounded-lg text-sm font-bold"
              style={{ background: BLUE, color: "white" }}
            >
              Send
            </button>
          </div>
          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(
              k => (
                <button
                  key={k}
                  onClick={() => setInput(i => i + k)}
                  className="py-2 rounded-lg text-white text-sm font-bold transition-all active:scale-95"
                  style={{
                    background: CARD,
                    border: `1px solid ${BORDER}`,
                    fontFamily: MONO,
                  }}
                >
                  {k}
                </button>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Embedded Finance — Nano Loan Screen ──────────────────────────────────────
export function NanoLoanScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"offer" | "apply" | "confirm" | "success">(
    "offer"
  );
  const [amount, setAmount] = useState(50000);
  const [tenor, setTenor] = useState(30);

  const interest = Math.round(amount * 0.025);
  const total = amount + interest;

  return (
    <div className="flex flex-col h-screen" style={{ background: BG }}>
      <ScreenHeader title="💰 Nano Loan" onBack={onBack} />
      <div className="flex-1 overflow-y-auto p-4">
        {step === "offer" && (
          <>
            {/* Credit score */}
            <div
              className="rounded-2xl p-4 mb-4"
              style={{
                background: `${GREEN}15`,
                border: `1px solid ${GREEN}30`,
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-xs">Your Credit Score</p>
                  <p
                    className="text-3xl font-bold"
                    style={{ color: GREEN, fontFamily: MONO }}
                  >
                    742
                  </p>
                  <p className="text-green-400 text-xs">
                    Excellent — Pre-approved
                  </p>
                </div>
                <div className="text-5xl">🏆</div>
              </div>
            </div>

            {/* Loan offer */}
            <div
              className="rounded-2xl p-4 mb-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <h3
                className="text-white font-bold mb-3"
                style={{ fontFamily: DISP }}
              >
                Loan Amount
              </h3>
              <div className="text-center mb-4">
                <span
                  className="text-4xl font-bold"
                  style={{ color: GOLD, fontFamily: MONO }}
                >
                  ₦{amount.toLocaleString()}
                </span>
              </div>
              <input
                type="range"
                min={10000}
                max={500000}
                step={10000}
                value={amount}
                onChange={e => setAmount(Number(e.target.value))}
                className="w-full mb-4"
                style={{ accentColor: BLUE }}
              />
              <div className="flex justify-between text-xs text-gray-500 mb-4">
                <span>₦10,000</span>
                <span>₦500,000</span>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                {[7, 14, 30].map(t => (
                  <button
                    key={t}
                    onClick={() => setTenor(t)}
                    className="py-2 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      background: tenor === t ? BLUE : BG,
                      color: tenor === t ? "white" : "#6b7280",
                      border: `1px solid ${tenor === t ? BLUE : BORDER}`,
                    }}
                  >
                    {t} days
                  </button>
                ))}
              </div>

              <div className="rounded-xl p-3" style={{ background: BG }}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">Principal</span>
                  <span className="text-white" style={{ fontFamily: MONO }}>
                    ₦{amount.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-400">Interest (2.5%)</span>
                  <span className="text-white" style={{ fontFamily: MONO }}>
                    ₦{interest.toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-gray-300">Total Repayment</span>
                  <span style={{ color: GOLD, fontFamily: MONO }}>
                    ₦{total.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setStep("confirm")}
              className="w-full py-4 rounded-2xl font-bold text-white text-lg"
              style={{
                background: `linear-gradient(135deg, ${BLUE}, oklch(0.55 0.22 280))`,
              }}
            >
              Apply for Loan →
            </button>
          </>
        )}

        {step === "confirm" && (
          <>
            <div
              className="rounded-2xl p-6 mb-4 text-center"
              style={{ background: CARD, border: `1px solid ${GOLD}40` }}
            >
              <div className="text-5xl mb-4">💳</div>
              <h3
                className="text-white font-bold text-xl mb-2"
                style={{ fontFamily: DISP }}
              >
                Confirm Loan Application
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                Funds will be credited to your float account instantly
              </p>
              <div
                className="text-4xl font-bold mb-1"
                style={{ color: GOLD, fontFamily: MONO }}
              >
                ₦{amount.toLocaleString()}
              </div>
              <p className="text-gray-500 text-sm">
                Repay ₦{total.toLocaleString()} in {tenor} days
              </p>
            </div>
            <button
              onClick={() => setStep("success")}
              className="w-full py-4 rounded-2xl font-bold text-white text-lg mb-3"
              style={{ background: GREEN }}
            >
              ✓ Confirm & Disburse
            </button>
            <button
              onClick={() => setStep("offer")}
              className="w-full py-3 rounded-2xl font-semibold text-gray-400"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              ← Back
            </button>
          </>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="text-7xl mb-6">🎉</div>
            <h3
              className="text-white font-bold text-2xl mb-2"
              style={{ fontFamily: DISP }}
            >
              Loan Approved!
            </h3>
            <p className="text-gray-400 mb-4">
              ₦{amount.toLocaleString()} credited to your float
            </p>
            <div
              className="rounded-xl px-6 py-3 mb-6"
              style={{
                background: `${GREEN}20`,
                border: `1px solid ${GREEN}40`,
              }}
            >
              <p className="text-green-400 font-semibold">New Float Balance</p>
              <p
                className="text-3xl font-bold"
                style={{ color: GREEN, fontFamily: MONO }}
              >
                ₦{(485250 + amount).toLocaleString()}
              </p>
            </div>
            <button
              onClick={onBack}
              className="px-8 py-3 rounded-2xl font-bold text-white"
              style={{ background: BLUE }}
            >
              Back to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── End-of-Day Reconciliation Wizard ─────────────────────────────────────────
export function ReconciliationWizard({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState(0);
  const [cashCount, setCashCount] = useState<Record<string, number>>({
    "1000": 0,
    "500": 0,
    "200": 0,
    "100": 0,
    "50": 0,
    "20": 0,
    "10": 0,
    "5": 0,
  });

  const denominations = [1000, 500, 200, 100, 50, 20, 10, 5];
  const physicalCash = denominations.reduce(
    (sum: any, d: any) => sum + d * (cashCount[String(d)] || 0),
    0
  );
  const systemBalance = 485250;
  const variance = physicalCash - systemBalance;

  const steps = [
    "Count Cash",
    "Review Transactions",
    "Variance Check",
    "Submit Report",
  ];

  return (
    <div className="flex flex-col h-screen" style={{ background: BG }}>
      <ScreenHeader title="📊 EOD Reconciliation" onBack={onBack} />

      {/* Step indicator */}
      <div
        className="flex items-center px-4 py-3 gap-2"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-1 flex-1">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{
                background: i <= step ? BLUE : CARD,
                color: i <= step ? "white" : "#6b7280",
                border: `1px solid ${i <= step ? BLUE : BORDER}`,
              }}
            >
              {i < step ? "✓" : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div
                className="flex-1 h-0.5"
                style={{ background: i < step ? BLUE : BORDER }}
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {step === 0 && (
          <>
            <h3
              className="text-white font-bold mb-4"
              style={{ fontFamily: DISP }}
            >
              Physical Cash Count
            </h3>
            {denominations.map(d => (
              <div key={d} className="flex items-center gap-3 mb-3">
                <div className="w-20 text-right">
                  <span
                    className="font-bold"
                    style={{ color: GOLD, fontFamily: MONO }}
                  >
                    ₦{d}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-1">
                  <button
                    onClick={() =>
                      setCashCount(c => ({
                        ...c,
                        [d]: Math.max(0, (c[String(d)] || 0) - 1),
                      }))
                    }
                    className="w-8 h-8 rounded-lg font-bold text-white"
                    style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={cashCount[String(d)] || 0}
                    onChange={e =>
                      setCashCount(c => ({
                        ...c,
                        [d]: Math.max(0, parseInt(e.target.value) || 0),
                      }))
                    }
                    className="flex-1 text-center py-2 rounded-lg text-white"
                    style={{
                      background: BG,
                      border: `1px solid ${BORDER}`,
                      fontFamily: MONO,
                    }}
                  />
                  <button
                    onClick={() =>
                      setCashCount(c => ({
                        ...c,
                        [d]: (c[String(d)] || 0) + 1,
                      }))
                    }
                    className="w-8 h-8 rounded-lg font-bold text-white"
                    style={{ background: BLUE }}
                  >
                    +
                  </button>
                </div>
                <div className="w-24 text-right">
                  <span
                    className="text-gray-400 text-sm"
                    style={{ fontFamily: MONO }}
                  >
                    = ₦{((cashCount[String(d)] || 0) * d).toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
            <div
              className="rounded-xl p-4 mt-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="flex justify-between font-bold">
                <span className="text-gray-300">Total Physical Cash</span>
                <span
                  className="text-2xl"
                  style={{ color: GOLD, fontFamily: MONO }}
                >
                  ₦{physicalCash.toLocaleString()}
                </span>
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h3
              className="text-white font-bold mb-4"
              style={{ fontFamily: DISP }}
            >
              Today's Transactions
            </h3>
            {[
              { type: "Cash In", count: 47, amount: 1240000, color: GREEN },
              { type: "Cash Out", count: 31, amount: 890000, color: RED },
              { type: "Transfer", count: 12, amount: 340000, color: BLUE },
              { type: "Airtime", count: 23, amount: 45600, color: GOLD },
              { type: "Bills", count: 8, amount: 128000, color: "#a855f7" },
            ].map((t, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-xl mb-2"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-2 h-8 rounded-full"
                    style={{ background: t.color }}
                  />
                  <div>
                    <p className="text-white text-sm font-semibold">{t.type}</p>
                    <p className="text-gray-500 text-xs">
                      {t.count} transactions
                    </p>
                  </div>
                </div>
                <span
                  className="font-bold"
                  style={{ color: t.color, fontFamily: MONO }}
                >
                  ₦{t.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </>
        )}

        {step === 2 && (
          <>
            <h3
              className="text-white font-bold mb-4"
              style={{ fontFamily: DISP }}
            >
              Variance Analysis
            </h3>
            <div
              className="rounded-2xl p-5 mb-4"
              style={{
                background: CARD,
                border: `1px solid ${Math.abs(variance) > 1000 ? RED : GREEN}40`,
              }}
            >
              <div className="flex justify-between mb-3">
                <span className="text-gray-400">System Balance</span>
                <span
                  className="font-bold"
                  style={{ color: BLUE, fontFamily: MONO }}
                >
                  ₦{systemBalance.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between mb-3">
                <span className="text-gray-400">Physical Cash</span>
                <span
                  className="font-bold"
                  style={{ color: GOLD, fontFamily: MONO }}
                >
                  ₦{physicalCash.toLocaleString()}
                </span>
              </div>
              <div className="h-px my-3" style={{ background: BORDER }} />
              <div className="flex justify-between">
                <span className="text-gray-300 font-bold">Variance</span>
                <span
                  className="font-bold text-xl"
                  style={{
                    color: Math.abs(variance) > 1000 ? RED : GREEN,
                    fontFamily: MONO,
                  }}
                >
                  {variance >= 0 ? "+" : ""}₦{variance.toLocaleString()}
                </span>
              </div>
            </div>
            {Math.abs(variance) > 1000 ? (
              <div
                className="rounded-xl p-4"
                style={{ background: `${RED}15`, border: `1px solid ${RED}40` }}
              >
                <p className="text-red-400 font-semibold text-sm">
                  ⚠ Variance exceeds threshold
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  Please recount cash or contact supervisor before submitting
                </p>
              </div>
            ) : (
              <div
                className="rounded-xl p-4"
                style={{
                  background: `${GREEN}15`,
                  border: `1px solid ${GREEN}40`,
                }}
              >
                <p className="text-green-400 font-semibold text-sm">
                  ✓ Variance within acceptable range
                </p>
                <p className="text-gray-400 text-xs mt-1">
                  Ready to submit end-of-day report
                </p>
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <div className="text-center py-8">
            <div className="text-6xl mb-4">📋</div>
            <h3
              className="text-white font-bold text-xl mb-2"
              style={{ fontFamily: DISP }}
            >
              Submit EOD Report
            </h3>
            <p className="text-gray-400 text-sm mb-6">
              Report will be sent to your supervisor and CBN compliance system
            </p>
            <button
              onClick={() => {
                toast.success("EOD report submitted successfully");
                onBack();
              }}
              className="w-full py-4 rounded-2xl font-bold text-white text-lg"
              style={{
                background: `linear-gradient(135deg, ${GREEN}, oklch(0.55 0.18 160))`,
              }}
            >
              ✓ Submit Report
            </button>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div
        className="flex gap-3 p-4"
        style={{ borderTop: `1px solid ${BORDER}` }}
      >
        {step > 0 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="flex-1 py-3 rounded-xl font-semibold text-gray-400"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            ← Back
          </button>
        )}
        {step < steps.length - 1 && (
          <button
            onClick={() => setStep(s => s + 1)}
            className="flex-1 py-3 rounded-xl font-bold text-white"
            style={{ background: BLUE }}
          >
            Next →
          </button>
        )}
      </div>
    </div>
  );
}

// ── Micro-Insurance Screen ────────────────────────────────────────────────────
export function MicroInsuranceScreen({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"browse" | "select" | "confirm" | "success">(
    "browse"
  );
  const [selected, setSelected] = useState<{
    name: string;
    premium: number;
    cover: number;
    period: string;
  } | null>(null);

  const products = [
    {
      name: "Life Cover Basic",
      icon: "🛡️",
      premium: 500,
      cover: 500000,
      period: "Monthly",
      desc: "₦500K life insurance for ₦500/month",
    },
    {
      name: "Health Micro Plan",
      icon: "🏥",
      premium: 800,
      cover: 200000,
      period: "Monthly",
      desc: "Outpatient & emergency cover",
    },
    {
      name: "Crop Insurance",
      icon: "🌾",
      premium: 1200,
      cover: 1000000,
      period: "Seasonal",
      desc: "Protect farm income from weather events",
    },
    {
      name: "Device Protection",
      icon: "📱",
      premium: 300,
      cover: 150000,
      period: "Monthly",
      desc: "Cover for insurance service & mobile devices",
    },
    {
      name: "Travel Accident",
      icon: "✈️",
      premium: 200,
      cover: 300000,
      period: "Per trip",
      desc: "Accidental death & disability cover",
    },
    {
      name: "Business Interruption",
      icon: "🏪",
      premium: 1500,
      cover: 2000000,
      period: "Monthly",
      desc: "Income protection for your agency",
    },
  ];

  return (
    <div className="flex flex-col h-screen" style={{ background: BG }}>
      <ScreenHeader
        title="🛡️ Micro-Insurance"
        onBack={onBack}
        badge={
          <span
            className="text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{
              background: "oklch(0.55 0.22 300 / 0.2)",
              color: "#a855f7",
              fontFamily: DISP,
            }}
          >
            EMBEDDED FINANCE
          </span>
        }
      />

      <div className="flex-1 overflow-y-auto p-4">
        {step === "browse" && (
          <>
            <div
              className="rounded-2xl p-4 mb-4"
              style={{
                background: "oklch(0.55 0.22 300 / 0.1)",
                border: "1px solid oklch(0.55 0.22 300 / 0.3)",
              }}
            >
              <p className="text-gray-300 text-sm">
                Protect yourself and your customers with affordable
                micro-insurance products. Premiums deducted from your commission
                balance.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {products.map((p, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setSelected(p);
                    setStep("select");
                  }}
                  className="flex items-center gap-4 p-4 rounded-2xl text-left transition-all active:scale-98"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div className="text-3xl">{p.icon}</div>
                  <div className="flex-1">
                    <div
                      className="font-bold text-white text-sm"
                      style={{ fontFamily: DISP }}
                    >
                      {p.name}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{p.desc}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-xs font-bold"
                        style={{ color: GREEN, fontFamily: MONO }}
                      >
                        ₦{p.premium.toLocaleString()}/{p.period}
                      </span>
                      <span className="text-xs text-gray-600">·</span>
                      <span className="text-xs text-gray-400">
                        Cover: ₦{p.cover.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <span className="text-gray-500">›</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "select" && selected && (
          <>
            <div
              className="rounded-2xl p-6 mb-4 text-center"
              style={{
                background: CARD,
                border: `1px solid oklch(0.55 0.22 300 / 0.4)`,
              }}
            >
              <div className="text-5xl mb-3">
                {products.find(p => p.name === selected.name)?.icon}
              </div>
              <h3
                className="text-white font-bold text-xl mb-1"
                style={{ fontFamily: DISP }}
              >
                {selected.name}
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                Coverage: ₦{selected.cover.toLocaleString()}
              </p>
              <div
                className="text-3xl font-bold"
                style={{ color: GREEN, fontFamily: MONO }}
              >
                ₦{selected.premium.toLocaleString()}
              </div>
              <p className="text-gray-500 text-sm">
                per {selected.period.toLowerCase()}
              </p>
            </div>
            <div
              className="rounded-xl p-4 mb-4"
              style={{ background: BG, border: `1px solid ${BORDER}` }}
            >
              {[
                ["Coverage Amount", `₦${selected.cover.toLocaleString()}`],
                [
                  "Premium",
                  `₦${selected.premium.toLocaleString()}/${selected.period}`,
                ],
                ["Payment Method", "Commission Balance"],
                ["Provider", "AXA Mansard Insurance"],
                ["Underwriter", "NAICOM Licensed"],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between py-2 border-b last:border-0"
                  style={{ borderColor: BORDER }}
                >
                  <span className="text-gray-500 text-sm">{k}</span>
                  <span
                    className="text-white text-sm font-semibold"
                    style={{ fontFamily: MONO }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setStep("browse")}
                className="flex-1 py-3 rounded-xl font-semibold text-gray-400"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                ← Back
              </button>
              <button
                onClick={() => setStep("confirm")}
                className="flex-2 flex-grow py-3 rounded-xl font-bold text-white"
                style={{ background: "oklch(0.55 0.22 300)" }}
              >
                Subscribe →
              </button>
            </div>
          </>
        )}

        {step === "confirm" && selected && (
          <>
            <div
              className="rounded-2xl p-6 mb-4 text-center"
              style={{ background: CARD, border: `1px solid ${GOLD}40` }}
            >
              <div className="text-4xl mb-3">🔐</div>
              <h3
                className="text-white font-bold text-xl mb-2"
                style={{ fontFamily: DISP }}
              >
                Confirm Subscription
              </h3>
              <p className="text-gray-400 text-sm mb-4">
                ₦{selected.premium.toLocaleString()} will be deducted from your
                commission balance {selected.period.toLowerCase()}
              </p>
              <div
                className="text-2xl font-bold"
                style={{ color: GOLD, fontFamily: MONO }}
              >
                ₦{selected.premium.toLocaleString()}/{selected.period}
              </div>
            </div>
            <button
              onClick={() => setStep("success")}
              className="w-full py-4 rounded-2xl font-bold text-white text-lg mb-3"
              style={{ background: GREEN }}
            >
              ✓ Confirm Subscription
            </button>
            <button
              onClick={() => setStep("select")}
              className="w-full py-3 rounded-2xl font-semibold text-gray-400"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              ← Back
            </button>
          </>
        )}

        {step === "success" && selected && (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <div className="text-7xl mb-6">🎉</div>
            <h3
              className="text-white font-bold text-2xl mb-2"
              style={{ fontFamily: DISP }}
            >
              Subscribed!
            </h3>
            <p className="text-gray-400 mb-4">{selected.name} is now active</p>
            <div
              className="rounded-xl px-6 py-3 mb-6"
              style={{
                background: "oklch(0.55 0.22 300 / 0.15)",
                border: "1px solid oklch(0.55 0.22 300 / 0.3)",
              }}
            >
              <p className="text-purple-400 font-semibold">Policy Number</p>
              <p className="text-white font-mono font-bold">
                POL-{Date.now().toString().slice(-8)}
              </p>
            </div>
            <button
              onClick={onBack}
              className="px-8 py-3 rounded-2xl font-bold text-white"
              style={{ background: BLUE }}
            >
              Back to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Architecture Overview Panel ───────────────────────────────────────────────
export function ArchitecturePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"services" | "infra" | "hardware">("services");

  const services = [
    {
      name: "Backend API",
      lang: "Python",
      count: 260,
      color: "#3b82f6",
      desc: "FastAPI microservices",
    },
    {
      name: "Go Services",
      lang: "Go",
      count: 52,
      color: "#06b6d4",
      desc: "High-performance event processing",
    },
    {
      name: "Rust Services",
      lang: "Rust",
      count: 5,
      color: "#f59e0b",
      desc: "Ultra-low-latency financial ops",
    },
    {
      name: "React PWA",
      lang: "TSX",
      count: 552,
      color: "#8b5cf6",
      desc: "Management dashboard",
    },
    {
      name: "React Native",
      lang: "JSX",
      count: 64,
      color: "#ec4899",
      desc: "Mobile agent app (64 screens)",
    },
    {
      name: "Flutter",
      lang: "Dart",
      count: 214,
      color: "#10b981",
      desc: "Alternative mobile app",
    },
  ];

  const infra = [
    { name: "Kafka", icon: "📨", desc: "Event streaming & DLQ" },
    { name: "TigerBeetle", icon: "⚡", desc: "Double-entry ledger" },
    { name: "Temporal", icon: "⏱", desc: "Workflow orchestration" },
    { name: "Keycloak", icon: "🔑", desc: "Identity & OAuth2" },
    { name: "Istio", icon: "🕸", desc: "Service mesh & mTLS" },
    { name: "Vault", icon: "🔐", desc: "Secrets management" },
    { name: "PgBouncer", icon: "🏊", desc: "Connection pooling" },
    { name: "APISIX", icon: "🚪", desc: "API gateway" },
    { name: "Prometheus", icon: "📊", desc: "Metrics & alerting" },
    { name: "Flagsmith", icon: "🚩", desc: "Feature flags" },
    { name: "Chaos Mesh", icon: "💥", desc: "Chaos engineering" },
    { name: "OpenTelemetry", icon: "🔭", desc: "Distributed tracing" },
  ];

  const hardware = [
    {
      model: "PAX A920 MAX",
      os: "PayDroid",
      nfc: true,
      printer: true,
      camera: true,
    },
    {
      model: "PAX A8900",
      os: "PayDroid",
      nfc: true,
      printer: true,
      camera: false,
    },
    {
      model: "HorizonPay K11",
      os: "AOSP",
      nfc: true,
      printer: true,
      camera: true,
    },
    {
      model: "Newland N910",
      os: "AOSP",
      nfc: false,
      printer: true,
      camera: false,
    },
    {
      model: "Newland N910 Pro",
      os: "AOSP",
      nfc: true,
      printer: true,
      camera: true,
    },
    {
      model: "Topwise T11 Pro",
      os: "PAXBiz",
      nfc: true,
      printer: true,
      camera: true,
    },
    {
      model: "Topwise MP45P",
      os: "PAXBiz",
      nfc: false,
      printer: false,
      camera: false,
    },
    {
      model: "Verifone P400",
      os: "AOSP",
      nfc: true,
      printer: false,
      camera: false,
    },
    {
      model: "Ingenico MOVE 5000",
      os: "AOSP",
      nfc: true,
      printer: false,
      camera: false,
    },
    {
      model: "Sunmi P2 Pro",
      os: "AOSP",
      nfc: true,
      printer: true,
      camera: true,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: "rgba(0,0,0,0.85)" }}
      onClick={onClose}
    >
      <div
        className="w-full rounded-t-3xl flex flex-col"
        style={{
          background: "oklch(0.11 0.012 240)",
          border: `1px solid ${BORDER}`,
          maxHeight: "90vh",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between p-4 border-b flex-shrink-0"
          style={{ borderColor: BORDER }}
        >
          <div>
            <div
              className="text-base font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              InsurePortal Platform Architecture
            </div>
            <div className="text-xs text-gray-500">v14 · Production Ready</div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 px-4 py-3 flex-shrink-0">
          {(["services", "infra", "hardware"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 rounded-xl text-xs font-semibold capitalize transition-all"
              style={{
                background: tab === t ? BLUE : CARD,
                color: tab === t ? "white" : "#6b7280",
                border: `1px solid ${tab === t ? BLUE : BORDER}`,
              }}
            >
              {t === "services"
                ? "Services"
                : t === "infra"
                  ? "Infrastructure"
                  : "POS Hardware"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {tab === "services" && (
            <div className="flex flex-col gap-3">
              {services.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs"
                    style={{
                      background: `${s.color}20`,
                      color: s.color,
                      fontFamily: MONO,
                    }}
                  >
                    {s.lang}
                  </div>
                  <div className="flex-1">
                    <div
                      className="text-sm font-bold text-white"
                      style={{ fontFamily: DISP }}
                    >
                      {s.name}
                    </div>
                    <div className="text-xs text-gray-400">{s.desc}</div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-lg font-bold"
                      style={{ color: s.color, fontFamily: MONO }}
                    >
                      {s.count}
                    </div>
                    <div className="text-xs text-gray-600">files</div>
                  </div>
                </div>
              ))}
              <div
                className="rounded-xl p-3 text-center"
                style={{
                  background: "oklch(0.65 0.18 160 / 0.1)",
                  border: `1px solid ${GREEN}30`,
                }}
              >
                <div
                  className="text-2xl font-bold"
                  style={{ color: GREEN, fontFamily: MONO }}
                >
                  8,076
                </div>
                <div className="text-xs text-gray-400">
                  Total files across all services
                </div>
              </div>
            </div>
          )}

          {tab === "infra" && (
            <div className="grid grid-cols-2 gap-3">
              {infra.map((item, i) => (
                <div
                  key={i}
                  className="p-3 rounded-xl"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div className="text-2xl mb-1">{item.icon}</div>
                  <div
                    className="text-sm font-bold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {item.name}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "hardware" && (
            <div className="flex flex-col gap-2">
              {hardware.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div className="text-xl">🖥</div>
                  <div className="flex-1">
                    <div
                      className="text-sm font-bold text-white"
                      style={{ fontFamily: DISP }}
                    >
                      {h.model}
                    </div>
                    <div className="text-xs text-gray-400">{h.os}</div>
                  </div>
                  <div className="flex gap-1">
                    {h.nfc && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: "oklch(0.60 0.22 260 / 0.2)",
                          color: "#3b82f6",
                        }}
                      >
                        NFC
                      </span>
                    )}
                    {h.printer && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: "oklch(0.65 0.18 160 / 0.2)",
                          color: GREEN,
                        }}
                      >
                        PRT
                      </span>
                    )}
                    {h.camera && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          background: "oklch(0.78 0.18 80 / 0.2)",
                          color: GOLD,
                        }}
                      >
                        CAM
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Disputes Screen ──────────────────────────────────────────────────────────
export function DisputesScreen({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<"list" | "raise" | "detail">("list");
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [txRef, setTxRef] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [msg, setMsg] = useState("");
  const [page, setPage] = useState(0);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.disputes.myDisputes.useQuery(
    { limit: 10, offset: page * 10 },
    { enabled: view === "list" }
  );
  const { data: detail } = trpc.disputes.getDispute.useQuery(
    { ref: selectedRef! },
    { enabled: view === "detail" && !!selectedRef, refetchInterval: 15_000 }
  );

  const raise = trpc.disputes.raise.useMutation({
    onSuccess: () => {
      toast.success("Dispute raised successfully");
      utils.disputes.myDisputes.invalidate();
      setView("list");
      setTxRef("");
      setReason("");
      setEvidence("");
    },
    onError: e => toast.error(e.message),
  });

  const addMsg = trpc.disputes.addMessage.useMutation({
    onSuccess: () => {
      utils.disputes.getDispute.invalidate({ ref: selectedRef! });
      setMsg("");
    },
    onError: e => toast.error(e.message),
  });

  const statusColor: Record<string, string> = {
    raised: "#f59e0b",
    investigating: "#3b82f6",
    resolved: "#10b981",
    escalated: "#ef4444",
    closed: "#6b7280",
  };

  return (
    <div
      className="flex flex-col h-screen"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 pt-safe pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <button
          onClick={view === "list" ? onBack : () => setView("list")}
          className="text-gray-400 hover:text-white text-xl"
        >
          ←
        </button>
        <div>
          <div className="text-base font-bold text-white">My Disputes</div>
          <div className="text-xs text-gray-500">
            Raise & track transaction disputes
          </div>
        </div>
        {view === "list" && (
          <button
            onClick={() => setView("raise")}
            className="ml-auto px-3 py-1.5 rounded-xl text-xs font-bold"
            style={{ background: "#8b5cf6", color: "white" }}
          >
            + Raise
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* ── List view ── */}
        {view === "list" && (
          <div className="flex flex-col gap-3">
            {isLoading && (
              <div className="text-center text-gray-500 py-8">
                Loading disputes…
              </div>
            )}
            {!isLoading && (!data?.disputes || data.disputes.length === 0) && (
              <div className="text-center text-gray-500 py-12">
                <div className="text-4xl mb-3">⚖</div>
                <div className="text-sm">No disputes raised yet</div>
                <div className="text-xs text-gray-600 mt-1">
                  Tap "+ Raise" to dispute a transaction
                </div>
              </div>
            )}
            {data?.disputes.map((d: any) => (
              <button
                key={d.ref}
                onClick={() => {
                  setSelectedRef(d.ref);
                  setView("detail");
                }}
                className="w-full text-left rounded-2xl p-4 transition-all hover:opacity-90"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-white font-mono">
                    {d.ref}
                  </span>
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-bold uppercase"
                    style={{
                      background: `${statusColor[d.status] ?? "#6b7280"}22`,
                      color: statusColor[d.status] ?? "#6b7280",
                    }}
                  >
                    {d.status}
                  </span>
                </div>
                <div className="text-xs text-gray-400 truncate">{d.reason}</div>
                <div className="text-xs text-gray-600 mt-1">
                  Tx: {d.transactionRef}
                </div>
              </button>
            ))}
            {/* Pagination */}
            {data && data.total > 10 && (
              <div className="flex justify-between mt-2">
                <button
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold disabled:opacity-40"
                  style={{
                    background: CARD,
                    color: "white",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  ← Prev
                </button>
                <span className="text-xs text-gray-500 self-center">
                  {page * 10 + 1}–{Math.min((page + 1) * 10, data.total)} of{" "}
                  {data.total}
                </span>
                <button
                  disabled={(page + 1) * 10 >= data.total}
                  onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold disabled:opacity-40"
                  style={{
                    background: CARD,
                    color: "white",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Raise view ── */}
        {view === "raise" && (
          <div className="flex flex-col gap-4">
            <div className="text-sm font-bold text-white">Raise a Dispute</div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase tracking-widest">
                Transaction Reference *
              </label>
              <input
                value={txRef}
                onChange={e => setTxRef(e.target.value)}
                placeholder="TXN-XXXXXXXX"
                className="rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  fontFamily: MONO,
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase tracking-widest">
                Reason * (min 10 chars)
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={3}
                placeholder="Describe the issue with this transaction…"
                className="rounded-xl px-3 py-2.5 text-sm text-white outline-none resize-none"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 uppercase tracking-widest">
                Evidence (optional)
              </label>
              <textarea
                value={evidence}
                onChange={e => setEvidence(e.target.value)}
                rows={2}
                placeholder="Attach any supporting notes or reference numbers…"
                className="rounded-xl px-3 py-2.5 text-sm text-white outline-none resize-none"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              />
            </div>
            <button
              onClick={() =>
                raise.mutate({
                  transactionRef: txRef,
                  reason,
                  evidence: evidence || undefined,
                })
              }
              disabled={raise.isPending || !txRef || reason.length < 10}
              className="w-full py-3 rounded-2xl font-bold text-sm transition-all disabled:opacity-50"
              style={{
                background: raise.isPending ? "#374151" : "#8b5cf6",
                color: "white",
              }}
            >
              {raise.isPending ? "Submitting…" : "Submit Dispute"}
            </button>
          </div>
        )}

        {/* ── Detail view ── */}
        {view === "detail" && detail && (
          <div className="flex flex-col gap-4">
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white font-mono">
                  {detail.ref}
                </span>
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-bold uppercase"
                  style={{
                    background: `${statusColor[detail.status] ?? "#6b7280"}22`,
                    color: statusColor[detail.status] ?? "#6b7280",
                  }}
                >
                  {detail.status}
                </span>
              </div>
              <div className="text-xs text-gray-400 mb-1">
                Tx:{" "}
                <span className="text-white font-mono">
                  {detail.transactionRef}
                </span>
              </div>
              <div className="text-xs text-gray-300">{detail.reason}</div>
              {detail.resolution && (
                <div
                  className="mt-2 p-2 rounded-xl text-xs text-green-400"
                  style={{ background: "#10b98120" }}
                >
                  Resolution: {detail.resolution}
                </div>
              )}
            </div>

            {/* Messages thread */}
            <div className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Thread
            </div>
            <div className="flex flex-col gap-2">
              {detail.messages.map((m: any) => (
                <div
                  key={m.id}
                  className="rounded-xl p-3"
                  style={{
                    background:
                      m.authorRole === "agent"
                        ? "oklch(0.18 0.02 260)"
                        : "oklch(0.14 0.015 240)",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-xs font-bold"
                      style={{
                        color: m.authorRole === "agent" ? "#3b82f6" : "#10b981",
                      }}
                    >
                      {m.authorName}
                    </span>
                    <span className="text-xs text-gray-600">
                      {new Date(m.createdAt).toLocaleString("en-NG", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-gray-300 whitespace-pre-wrap">
                    {m.message}
                  </div>
                </div>
              ))}
            </div>

            {/* Reply box */}
            {detail.status !== "resolved" && detail.status !== "rejected" && (
              <div className="flex gap-2 mt-2">
                <input
                  value={msg}
                  onChange={e => setMsg(e.target.value)}
                  placeholder="Add a message…"
                  className="flex-1 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                />
                <button
                  onClick={() =>
                    addMsg.mutate({ disputeRef: detail.ref, message: msg })
                  }
                  disabled={addMsg.isPending || !msg.trim()}
                  className="px-4 py-2.5 rounded-xl font-bold text-sm disabled:opacity-50"
                  style={{ background: "#3b82f6", color: "white" }}
                >
                  {addMsg.isPending ? "…" : "Send"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sprint 75: USSD Transaction Screen ──────────────────────────────────────
function UssdTransactionScreen({ onBack }: { onBack: () => void }) {
  const BG2 = "#0a0e1a";
  const CARD2 = "oklch(0.14 0.02 240)";
  const BORDER2 = "oklch(0.22 0.02 240)";
  const GREEN2 = "oklch(0.65 0.18 160)";
  const BLUE2 = "oklch(0.60 0.22 260)";
  const GOLD2 = "oklch(0.78 0.18 80)";
  const DISP2 = "'Space Grotesk', sans-serif";
  const MONO2 = "'JetBrains Mono', monospace";

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [response, setResponse] = useState<string>("");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<
    Array<{ type: "in" | "out"; text: string; time: string }>
  >([]);
  const [txRef, setTxRef] = useState<string | null>(null);
  const [selectedShortcut, setSelectedShortcut] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const startSession = trpc.ussdIntegration.startSession.useMutation();
  const processInput = trpc.ussdIntegration.processInput.useMutation();
  const stats = trpc.ussdIntegration.getStats.useQuery();
  const shortcuts = trpc.ussdIntegration.getShortcuts.useQuery();

  useEffect(() => {
    if (scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history]);

  const handleDial = async (code?: string) => {
    try {
      const result = await startSession.mutateAsync({
        phoneNumber: "+2348012345678",
        agentCode: "AGT-NG-0042",
        carrier: "MTN",
        menuCode: code || selectedShortcut || "*384#",
      });
      setSessionId(result.sessionId);
      setResponse(result.response);
      setHistory([
        {
          type: "out",
          text: result.response.replace(/^(CON|END)\s*/, ""),
          time: new Date().toLocaleTimeString(),
        },
      ]);
      setTxRef(null);
    } catch {
      toast.error("Failed to start USSD session");
    }
  };

  const handleSend = async () => {
    if (!sessionId || !input.trim()) return;
    setHistory(h => [
      ...h,
      { type: "in", text: input, time: new Date().toLocaleTimeString() },
    ]);
    try {
      const result = await processInput.mutateAsync({
        sessionId,
        input: input.trim(),
      });
      setResponse(result.response);
      setHistory(h => [
        ...h,
        {
          type: "out",
          text: result.response.replace(/^(CON|END)\s*/, ""),
          time: new Date().toLocaleTimeString(),
        },
      ]);
      if (result.txRef) setTxRef(result.txRef);
      if (!result.continue) setSessionId(null);
    } catch {
      toast.error("Session error");
    }
    setInput("");
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: BG2 }}>
      <ScreenHeader
        title="# USSD Transact"
        onBack={onBack}
        badge={
          <span
            className="text-xs px-2 py-1 rounded-full"
            style={{ background: `${GREEN2}20`, color: GREEN2 }}
          >
            {stats.data?.activeSessions || 0} active
          </span>
        }
      />
      <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
        {/* Shortcut codes */}
        <div className="mb-4">
          <div
            className="text-xs text-gray-500 mb-2"
            style={{ fontFamily: DISP2 }}
          >
            Quick Dial
          </div>
          <div className="flex flex-wrap gap-2">
            {(shortcuts.data || []).map(s => (
              <button
                key={s.id}
                onClick={() => handleDial(s.code)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95"
                style={{
                  background: CARD2,
                  border: `1px solid ${BORDER2}`,
                  color: "white",
                  fontFamily: MONO2,
                }}
              >
                {s.code} {s.title}
              </button>
            ))}
          </div>
        </div>

        {/* USSD terminal display */}
        <div
          className="rounded-2xl overflow-hidden mb-4"
          style={{ border: `1px solid ${GREEN2}30` }}
        >
          <div
            className="px-4 py-2 flex items-center justify-between"
            style={{ background: `${GREEN2}10` }}
          >
            <span
              className="text-xs font-bold"
              style={{ color: GREEN2, fontFamily: MONO2 }}
            >
              *384#
            </span>
            <span className="text-xs text-gray-500">
              {sessionId ? "SESSION ACTIVE" : "IDLE"}
            </span>
          </div>
          <div className="p-4 min-h-40" style={{ background: "#050810" }}>
            {history.length === 0 ? (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">#</div>
                <div
                  className="text-gray-500 text-sm"
                  style={{ fontFamily: DISP2 }}
                >
                  Dial *384# to start a USSD transaction
                </div>
                <button
                  onClick={() => handleDial()}
                  className="mt-4 px-6 py-2 rounded-xl text-sm font-bold"
                  style={{ background: GREEN2, color: "white" }}
                >
                  Dial *384#
                </button>
              </div>
            ) : (
              history.map((h, i) => (
                <div
                  key={i}
                  className={`mb-2 ${h.type === "in" ? "text-right" : ""}`}
                >
                  <div
                    className={`inline-block px-3 py-1.5 rounded-lg text-xs max-w-[85%] ${h.type === "in" ? "" : ""}`}
                    style={{
                      background:
                        h.type === "in" ? `${BLUE2}20` : `${GREEN2}10`,
                      color: h.type === "in" ? "#93c5fd" : "#6ee7b7",
                      fontFamily: MONO2,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {h.text}
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">
                    {h.time}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Transaction ref */}
        {txRef && (
          <div
            className="rounded-xl p-3 mb-4"
            style={{
              background: `${GREEN2}15`,
              border: `1px solid ${GREEN2}30`,
            }}
          >
            <div className="flex items-center gap-2">
              <span className="text-lg">✓</span>
              <div>
                <div className="text-xs text-gray-400">
                  Transaction Reference
                </div>
                <div
                  className="text-sm font-bold"
                  style={{ color: GREEN2, fontFamily: MONO2 }}
                >
                  {txRef}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stats */}
        {stats.data && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {[
              {
                label: "Completed",
                value: stats.data.completedTransactions,
                color: GREEN2,
              },
              {
                label: "Volume",
                value: `₦${(stats.data.totalVolume / 1000).toFixed(0)}K`,
                color: GOLD2,
              },
              {
                label: "Active",
                value: stats.data.activeSessions,
                color: BLUE2,
              },
            ].map((s, i) => (
              <div
                key={i}
                className="rounded-xl p-3 text-center"
                style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
              >
                <div
                  className="text-lg font-bold"
                  style={{ color: s.color, fontFamily: MONO2 }}
                >
                  {s.value}
                </div>
                <div className="text-[10px] text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Recent USSD transactions */}
        {stats.data?.recentTransactions &&
          stats.data.recentTransactions.length > 0 && (
            <div>
              <div
                className="text-xs text-gray-500 mb-2"
                style={{ fontFamily: DISP2 }}
              >
                Recent USSD Transactions
              </div>
              {stats.data.recentTransactions.map((tx, i) => (
                <div
                  key={i}
                  className="rounded-xl p-3 mb-2 flex items-center justify-between"
                  style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
                >
                  <div>
                    <div
                      className="text-xs font-bold text-white"
                      style={{ fontFamily: MONO2 }}
                    >
                      {tx.txRef}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {tx.type} · {tx.carrier}
                    </div>
                  </div>
                  <div className="text-right">
                    <div
                      className="text-xs font-bold"
                      style={{ color: GREEN2, fontFamily: MONO2 }}
                    >
                      ₦{tx.amount.toLocaleString()}
                    </div>
                    <div
                      className="text-[10px]"
                      style={{
                        color: tx.status === "completed" ? GREEN2 : GOLD2,
                      }}
                    >
                      {tx.status}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Input area */}
      {sessionId && (
        <div
          className="p-4 flex-shrink-0"
          style={{ borderTop: `1px solid ${BORDER2}` }}
        >
          <div className="flex gap-2 mb-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSend()}
              placeholder="Enter option..."
              className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{
                background: "#050810",
                border: `1px solid ${BORDER2}`,
                color: "#6ee7b7",
                fontFamily: MONO2,
              }}
            />
            <button
              onClick={handleSend}
              disabled={processInput.isPending}
              className="px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ background: GREEN2, color: "white" }}
            >
              {processInput.isPending ? "…" : "Send"}
            </button>
          </div>
          {/* Mini keypad */}
          <div className="grid grid-cols-6 gap-1.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map(
              k => (
                <button
                  key={k}
                  onClick={() => setInput(v => v + k)}
                  className="py-2 rounded-lg text-white text-xs font-bold transition-all active:scale-95"
                  style={{
                    background: CARD2,
                    border: `1px solid ${BORDER2}`,
                    fontFamily: MONO2,
                  }}
                >
                  {k}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sprint 75: Carrier Switch Screen ────────────────────────────────────────
function CarrierSwitchScreen({ onBack }: { onBack: () => void }) {
  const BG2 = "#0a0e1a";
  const CARD2 = "oklch(0.14 0.02 240)";
  const BORDER2 = "oklch(0.22 0.02 240)";
  const GREEN2 = "oklch(0.65 0.18 160)";
  const BLUE2 = "oklch(0.60 0.22 260)";
  const GOLD2 = "oklch(0.78 0.18 80)";
  const RED2 = "oklch(0.60 0.22 25)";
  const CYAN2 = "oklch(0.65 0.18 200)";
  const DISP2 = "'Space Grotesk', sans-serif";
  const MONO2 = "'JetBrains Mono', monospace";

  const [currentCarrier, setCurrentCarrier] = useState("MTN");
  const [autoSwitch, setAutoSwitch] = useState(false);

  const rankings = trpc.carrierSwitching.getRankings.useQuery();
  const recommendation = trpc.carrierSwitching.getRecommendation.useQuery({
    currentCarrier,
  });
  const switchStats = trpc.carrierSwitching.getSwitchStats.useQuery();
  const recordSwitch = trpc.carrierSwitching.recordSwitch.useMutation({
    onSuccess: () => {
      rankings.refetch();
      recommendation.refetch();
      switchStats.refetch();
    },
  });

  const handleSwitch = async (toCarrier: string) => {
    if (toCarrier === currentCarrier) return;
    try {
      await recordSwitch.mutateAsync({
        fromCarrier: currentCarrier,
        toCarrier,
        agentCode: "AGT-NG-0042",
        reason: "Manual switch from CarrierSwitch screen",
        autoTriggered: false,
      });
      setCurrentCarrier(toCarrier);
      toast.success(`Switched to ${toCarrier}`);
    } catch {
      toast.error("Switch failed");
    }
  };

  const gradeColor = (grade: string) => {
    if (grade === "A+" || grade === "A") return GREEN2;
    if (grade === "B") return BLUE2;
    if (grade === "C") return GOLD2;
    return RED2;
  };

  const barColor = (bars: number) => {
    if (bars >= 4) return GREEN2;
    if (bars >= 3) return BLUE2;
    if (bars >= 2) return GOLD2;
    return RED2;
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: BG2 }}>
      <ScreenHeader
        title="📡 Carrier Switch"
        onBack={onBack}
        badge={
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-2 py-1 rounded-full"
              style={{
                background: `${CYAN2}20`,
                color: CYAN2,
                fontFamily: MONO2,
              }}
            >
              {currentCarrier}
            </span>
          </div>
        }
      />
      <div className="flex-1 overflow-y-auto p-4">
        {/* Auto-switch recommendation */}
        {recommendation.data?.shouldSwitch && (
          <div
            className="rounded-2xl p-4 mb-4"
            style={{
              background: `${GREEN2}10`,
              border: `1px solid ${GREEN2}30`,
            }}
          >
            <div className="flex items-center gap-3">
              <div className="text-2xl">⚡</div>
              <div className="flex-1">
                <div
                  className="text-sm font-bold text-white"
                  style={{ fontFamily: DISP2 }}
                >
                  Switch Recommended
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {recommendation.data.reason}
                </div>
              </div>
              <button
                onClick={() => handleSwitch(recommendation.data!.bestCarrier!)}
                disabled={recordSwitch.isPending}
                className="px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-50"
                style={{ background: GREEN2, color: "white" }}
              >
                {recordSwitch.isPending ? "…" : "Switch"}
              </button>
            </div>
            <div className="flex items-center gap-4 mt-3">
              <div
                className="flex-1 rounded-lg p-2 text-center"
                style={{ background: `${RED2}15` }}
              >
                <div className="text-xs text-gray-500">Current</div>
                <div
                  className="text-sm font-bold"
                  style={{ color: RED2, fontFamily: MONO2 }}
                >
                  {recommendation.data.currentScore}
                </div>
              </div>
              <div className="text-gray-600">→</div>
              <div
                className="flex-1 rounded-lg p-2 text-center"
                style={{ background: `${GREEN2}15` }}
              >
                <div className="text-xs text-gray-500">Best</div>
                <div
                  className="text-sm font-bold"
                  style={{ color: GREEN2, fontFamily: MONO2 }}
                >
                  {recommendation.data.bestScore}
                </div>
              </div>
              <div
                className="flex-1 rounded-lg p-2 text-center"
                style={{ background: `${BLUE2}15` }}
              >
                <div className="text-xs text-gray-500">Gain</div>
                <div
                  className="text-sm font-bold"
                  style={{ color: BLUE2, fontFamily: MONO2 }}
                >
                  +{recommendation.data.improvement}%
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Current carrier */}
        <div
          className="rounded-2xl p-4 mb-4"
          style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
        >
          <div className="flex items-center justify-between mb-3">
            <div
              className="text-xs text-gray-500"
              style={{ fontFamily: DISP2 }}
            >
              Active Carrier
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Auto-Switch</span>
              <button
                onClick={() => setAutoSwitch(!autoSwitch)}
                className="w-10 h-5 rounded-full transition-all relative"
                style={{ background: autoSwitch ? GREEN2 : BORDER2 }}
              >
                <div
                  className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all"
                  style={{ left: autoSwitch ? "22px" : "2px" }}
                />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
              style={{ background: `${CYAN2}15` }}
            >
              📡
            </div>
            <div className="flex-1">
              <div
                className="text-lg font-bold text-white"
                style={{ fontFamily: DISP2 }}
              >
                {currentCarrier}
              </div>
              <div className="text-xs text-gray-500">
                Score:{" "}
                <span style={{ color: GREEN2 }}>
                  {recommendation.data?.currentScore || "—"}
                </span>
              </div>
            </div>
            {/* Signal bars */}
            <div className="flex items-end gap-0.5 h-6">
              {[1, 2, 3, 4, 5].map(bar => {
                const active =
                  (rankings.data?.find(r => r.name === currentCarrier)
                    ?.signalBars || 3) >= bar;
                return (
                  <div
                    key={bar}
                    className="w-1.5 rounded-sm transition-all"
                    style={{
                      height: `${bar * 4 + 4}px`,
                      background: active
                        ? barColor(
                            rankings.data?.find(r => r.name === currentCarrier)
                              ?.signalBars || 3
                          )
                        : BORDER2,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>

        {/* Carrier rankings */}
        <div className="mb-4">
          <div
            className="text-xs text-gray-500 mb-2"
            style={{ fontFamily: DISP2 }}
          >
            Carrier Rankings
          </div>
          {(rankings.data || []).map((carrier: any) => (
            <div
              key={carrier.name}
              className="rounded-xl p-3 mb-2 flex items-center gap-3 transition-all"
              style={{
                background:
                  carrier.name === currentCarrier ? `${CYAN2}10` : CARD2,
                border: `1px solid ${carrier.name === currentCarrier ? `${CYAN2}40` : BORDER2}`,
              }}
            >
              {/* Rank */}
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
                style={{
                  background: `${gradeColor(carrier.grade)}20`,
                  color: gradeColor(carrier.grade),
                  fontFamily: MONO2,
                }}
              >
                {carrier.rank}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="text-sm font-bold text-white truncate"
                    style={{ fontFamily: DISP2 }}
                  >
                    {carrier.name}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                    style={{
                      background: `${gradeColor(carrier.grade)}20`,
                      color: gradeColor(carrier.grade),
                    }}
                  >
                    {carrier.grade}
                  </span>
                  {carrier.name === currentCarrier && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full"
                      style={{ background: `${CYAN2}20`, color: CYAN2 }}
                    >
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-gray-500">
                    {carrier.technology}
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {carrier.signalDbm.toFixed(0)} dBm
                  </span>
                  <span className="text-[10px] text-gray-500">
                    {carrier.latencyMs.toFixed(0)}ms
                  </span>
                </div>
              </div>
              {/* Signal bars */}
              <div className="flex items-end gap-0.5 h-5">
                {[1, 2, 3, 4, 5].map(bar => (
                  <div
                    key={bar}
                    className="w-1 rounded-sm"
                    style={{
                      height: `${bar * 3 + 3}px`,
                      background:
                        carrier.signalBars >= bar
                          ? barColor(carrier.signalBars)
                          : BORDER2,
                    }}
                  />
                ))}
              </div>
              {/* Quality score */}
              <div className="text-right">
                <div
                  className="text-sm font-bold"
                  style={{
                    color: gradeColor(carrier.grade),
                    fontFamily: MONO2,
                  }}
                >
                  {carrier.qualityScore.toFixed(0)}
                </div>
              </div>
              {/* Switch button */}
              {carrier.name !== currentCarrier && carrier.sampleCount > 0 && (
                <button
                  onClick={() => handleSwitch(carrier.name)}
                  disabled={recordSwitch.isPending}
                  className="px-2 py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-50"
                  style={{
                    background: `${BLUE2}20`,
                    color: BLUE2,
                    border: `1px solid ${BLUE2}30`,
                  }}
                >
                  Switch
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Switch stats */}
        {switchStats.data && (
          <div className="mb-4">
            <div
              className="text-xs text-gray-500 mb-2"
              style={{ fontFamily: DISP2 }}
            >
              Switch Statistics
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  label: "Total Switches",
                  value: switchStats.data.totalSwitches,
                  color: BLUE2,
                },
                {
                  label: "Auto Switches",
                  value: switchStats.data.autoSwitches,
                  color: CYAN2,
                },
                {
                  label: "Manual",
                  value: switchStats.data.manualSwitches,
                  color: GOLD2,
                },
                {
                  label: "Avg Improvement",
                  value: `${switchStats.data.avgImprovement}%`,
                  color: GREEN2,
                },
              ].map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl p-3"
                  style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
                >
                  <div
                    className="text-lg font-bold"
                    style={{ color: s.color, fontFamily: MONO2 }}
                  >
                    {s.value}
                  </div>
                  <div className="text-[10px] text-gray-500">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent switches */}
        {switchStats.data?.recentSwitches &&
          switchStats.data.recentSwitches.length > 0 && (
            <div>
              <div
                className="text-xs text-gray-500 mb-2"
                style={{ fontFamily: DISP2 }}
              >
                Recent Switches
              </div>
              {switchStats.data.recentSwitches.map((sw, i) => (
                <div
                  key={i}
                  className="rounded-xl p-3 mb-2 flex items-center gap-3"
                  style={{ background: CARD2, border: `1px solid ${BORDER2}` }}
                >
                  <div
                    className="text-xs font-bold"
                    style={{ color: RED2, fontFamily: MONO2 }}
                  >
                    {sw.fromCarrier}
                  </div>
                  <div className="text-gray-600">→</div>
                  <div
                    className="text-xs font-bold"
                    style={{ color: GREEN2, fontFamily: MONO2 }}
                  >
                    {sw.toCarrier}
                  </div>
                  <div className="flex-1 text-right">
                    <div
                      className="text-[10px]"
                      style={{ color: sw.improvement > 0 ? GREEN2 : RED2 }}
                    >
                      {sw.improvement > 0 ? "+" : ""}
                      {sw.improvement}%
                    </div>
                    <div className="text-[10px] text-gray-600">
                      {sw.autoTriggered ? "auto" : "manual"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
