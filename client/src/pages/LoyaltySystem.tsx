// @ts-nocheck
/**
 * InsurePortal — Agent Loyalty Points System
 * Design: Bloomberg Terminal dark — near-black bg, gold/amber primary for rewards
 * Features: Points dashboard, tier progression, transaction multipliers,
 *           rewards catalogue, leaderboard, milestone badges, redemption flow,
 *           performance analytics, weekly/monthly challenges
 */

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc";
import { usePosStore } from "../store/posStore";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
} from "recharts";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const BG = "oklch(0.08 0.012 240)";
const CARD = "oklch(0.12 0.015 240)";
const CARD2 = "oklch(0.16 0.015 240)";
const BORDER = "oklch(0.22 0.015 240)";
const RED = "#ef4444";
const GOLD = "#f59e0b";
const AMBER = "#d97706";
const GREEN = "#10b981";
const BLUE = "#3b82f6";
const PURPLE = "#8b5cf6";
const CYAN = "#06b6d4";
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

// ─── Types ────────────────────────────────────────────────────────────────────
type TierName = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond";

interface LoyaltyTier {
  name: TierName;
  minPoints: number;
  maxPoints: number;
  color: string;
  bgColor: string;
  icon: string;
  multiplier: number;
  perks: string[];
}

interface Reward {
  id: string;
  name: string;
  description: string;
  cost: number;
  category: "cash" | "float" | "data" | "device" | "training" | "recognition";
  icon: string;
  available: boolean;
  popular?: boolean;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward: number;
  deadline: string;
  type: "daily" | "weekly" | "monthly";
  icon: string;
  completed: boolean;
}

interface LeaderboardEntry {
  rank: number;
  agentName: string;
  agentId: string;
  location: string;
  points: number;
  tier: TierName;
  change: "up" | "down" | "same";
  changeAmount: number;
  txCount: number;
  isCurrentAgent?: boolean;
}

interface PointsHistory {
  date: string;
  points: number;
  source: string;
  type: "earned" | "redeemed" | "bonus";
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const TIERS: LoyaltyTier[] = [
  {
    name: "Bronze",
    minPoints: 0,
    maxPoints: 2_499,
    color: "#cd7f32",
    bgColor: "oklch(0.50 0.12 50 / 0.15)",
    icon: "🥉",
    multiplier: 1.0,
    perks: [
      "1× points on all transactions",
      "Basic support access",
      "Monthly statement",
    ],
  },
  {
    name: "Silver",
    minPoints: 2_500,
    maxPoints: 7_499,
    color: "#9ca3af",
    bgColor: "oklch(0.55 0.01 240 / 0.2)",
    icon: "🥈",
    multiplier: 1.5,
    perks: [
      "1.5× points multiplier",
      "Priority support queue",
      "Weekly performance report",
      "Float top-up discount 5%",
    ],
  },
  {
    name: "Gold",
    minPoints: 7_500,
    maxPoints: 19_999,
    color: GOLD,
    bgColor: "oklch(0.78 0.18 80 / 0.15)",
    icon: "🥇",
    multiplier: 2.0,
    perks: [
      "2× points multiplier",
      "Dedicated support agent",
      "Float top-up discount 10%",
      "Monthly cash bonus",
      "Training access",
    ],
  },
  {
    name: "Platinum",
    minPoints: 20_000,
    maxPoints: 49_999,
    color: CYAN,
    bgColor: "oklch(0.65 0.18 200 / 0.15)",
    icon: "💎",
    multiplier: 2.5,
    perks: [
      "2.5× points multiplier",
      "24/7 priority support",
      "Float top-up discount 15%",
      "Quarterly device upgrade",
      "CBN compliance training",
    ],
  },
  {
    name: "Diamond",
    minPoints: 50_000,
    maxPoints: Infinity,
    color: PURPLE,
    bgColor: "oklch(0.55 0.22 300 / 0.15)",
    icon: "👑",
    multiplier: 3.0,
    perks: [
      "3× points multiplier",
      "Personal relationship manager",
      "Float top-up discount 20%",
      "Annual device upgrade",
      "Revenue sharing program",
    ],
  },
];

const REWARDS: Reward[] = [
  {
    id: "r1",
    name: "₦5,000 Cash Bonus",
    description: "Credited to your commission wallet",
    cost: 500,
    category: "cash",
    icon: "💵",
    available: true,
    popular: true,
  },
  {
    id: "r2",
    name: "₦10,000 Cash Bonus",
    description: "Credited to your commission wallet",
    cost: 950,
    category: "cash",
    icon: "💵",
    available: true,
  },
  {
    id: "r3",
    name: "₦50,000 Float Top-Up",
    description: "Instant premium reserve credit",
    cost: 4_000,
    category: "float",
    icon: "💰",
    available: true,
    popular: true,
  },
  {
    id: "r4",
    name: "₦100,000 Float Top-Up",
    description: "Instant premium reserve credit",
    cost: 7_500,
    category: "float",
    icon: "💰",
    available: true,
  },
  {
    id: "r5",
    name: "20GB Data Bundle",
    description: "MTN / Airtel / Glo — your choice",
    cost: 300,
    category: "data",
    icon: "📶",
    available: true,
  },
  {
    id: "r6",
    name: "50GB Data Bundle",
    description: "MTN / Airtel / Glo — your choice",
    cost: 700,
    category: "data",
    icon: "📶",
    available: true,
  },
  {
    id: "r7",
    name: "PAX A920 MAX Upgrade",
    description: "Latest terminal model — free upgrade",
    cost: 25_000,
    category: "device",
    icon: "🖥",
    available: false,
  },
  {
    id: "r8",
    name: "Thermal Paper (10 rolls)",
    description: "Compatible with all InsurePortal terminals",
    cost: 200,
    category: "device",
    icon: "🖨",
    available: true,
  },
  {
    id: "r9",
    name: "AML Compliance Course",
    description: "CBN-accredited online training",
    cost: 1_500,
    category: "training",
    icon: "📚",
    available: true,
  },
  {
    id: "r10",
    name: "Agent of the Month",
    description: "Certificate + social media feature",
    cost: 0,
    category: "recognition",
    icon: "🏆",
    available: false,
  },
];

const CHALLENGES: Challenge[] = [
  {
    id: "c1",
    type: "daily",
    icon: "⚡",
    title: "Speed Demon",
    description: "Complete 10 transactions before 12:00 PM",
    target: 10,
    progress: 5,
    reward: 50,
    deadline: "Today 12:00 PM",
    completed: false,
  },
  {
    id: "c2",
    type: "daily",
    icon: "💰",
    title: "Float Master",
    description: "Process ₦500,000 in Cash-In transactions today",
    target: 500_000,
    progress: 285_000,
    reward: 75,
    deadline: "Today 11:59 PM",
    completed: false,
  },
  {
    id: "c3",
    type: "weekly",
    icon: "🎯",
    title: "Weekly Target",
    description: "Complete 50 transactions this week",
    target: 50,
    progress: 38,
    reward: 200,
    deadline: "Sun 11:59 PM",
    completed: false,
  },
  {
    id: "c4",
    type: "weekly",
    icon: "🛡️",
    title: "Zero Fraud Week",
    description: "Zero fraud alerts for 7 consecutive days",
    target: 7,
    progress: 7,
    reward: 300,
    deadline: "Sun 11:59 PM",
    completed: true,
  },
  {
    id: "c5",
    type: "monthly",
    icon: "👑",
    title: "Top Performer",
    description: "Rank in the top 10 agents this month",
    target: 10,
    progress: 14,
    reward: 1_000,
    deadline: "Mar 31",
    completed: false,
  },
  {
    id: "c6",
    type: "monthly",
    icon: "🌟",
    title: "Customer Champion",
    description: "Onboard 20 new customers this month",
    target: 20,
    progress: 13,
    reward: 500,
    deadline: "Mar 31",
    completed: false,
  },
];

const LEADERBOARD: LeaderboardEntry[] = [
  {
    rank: 1,
    agentName: "Aminu Garba",
    agentId: "AG-KAN-007812",
    location: "Kano City",
    points: 52_340,
    tier: "Diamond",
    change: "same",
    changeAmount: 0,
    txCount: 203,
  },
  {
    rank: 2,
    agentName: "Biodun Olatunji",
    agentId: "AG-LOS-008876",
    location: "Victoria Island",
    points: 48_120,
    tier: "Platinum",
    change: "up",
    changeAmount: 1,
    txCount: 178,
  },
  {
    rank: 3,
    agentName: "Chioma Obi",
    agentId: "AG-PHC-003219",
    location: "Port Harcourt",
    points: 34_890,
    tier: "Platinum",
    change: "down",
    changeAmount: 1,
    txCount: 156,
  },
  {
    rank: 4,
    agentName: "Emeka Eze",
    agentId: "AG-ABJ-002341",
    location: "Wuse, Abuja",
    points: 28_450,
    tier: "Platinum",
    change: "up",
    changeAmount: 2,
    txCount: 142,
  },
  {
    rank: 5,
    agentName: "Ngozi Adeyemi",
    agentId: "AG-ENU-001187",
    location: "Enugu",
    points: 21_780,
    tier: "Platinum",
    change: "up",
    changeAmount: 1,
    txCount: 134,
  },
  {
    rank: 6,
    agentName: "Tunde Bakare",
    agentId: "AG-IBD-005543",
    location: "Ibadan, Oyo",
    points: 18_340,
    tier: "Gold",
    change: "down",
    changeAmount: 2,
    txCount: 119,
  },
  {
    rank: 7,
    agentName: "Musa Aliyu",
    agentId: "AG-KAD-009934",
    location: "Kaduna",
    points: 15_670,
    tier: "Gold",
    change: "same",
    changeAmount: 0,
    txCount: 98,
  },
  {
    rank: 8,
    agentName: "Fatima Bello",
    agentId: "AG-LOS-003311",
    location: "Surulere, Lagos",
    points: 12_980,
    tier: "Gold",
    change: "up",
    changeAmount: 3,
    txCount: 87,
  },
  {
    rank: 9,
    agentName: "Chidi Okafor",
    agentId: "AG-OWR-006612",
    location: "Owerri, Imo",
    points: 11_240,
    tier: "Gold",
    change: "down",
    changeAmount: 1,
    txCount: 76,
  },
  {
    rank: 10,
    agentName: "Blessing Eze",
    agentId: "AG-LOS-009901",
    location: "Lekki, Lagos",
    points: 9_870,
    tier: "Gold",
    change: "up",
    changeAmount: 2,
    txCount: 71,
  },
  {
    rank: 14,
    agentName: "Adaeze Okonkwo",
    agentId: "AG-LOS-004821",
    location: "Ikeja, Lagos",
    points: 8_450,
    tier: "Gold",
    change: "up",
    changeAmount: 1,
    txCount: 67,
    isCurrentAgent: true,
  },
];

const POINTS_HISTORY: PointsHistory[] = [
  {
    date: "Today 09:42",
    points: 142,
    source: "Cash In — ₦50,000",
    type: "earned",
  },
  {
    date: "Today 09:38",
    points: 98,
    source: "Cash Out — ₦20,000",
    type: "earned",
  },
  {
    date: "Today 09:31",
    points: 67,
    source: "Transfer — ₦15,000",
    type: "earned",
  },
  {
    date: "Yesterday",
    points: 300,
    source: "Zero Fraud Week bonus",
    type: "bonus",
  },
  {
    date: "Yesterday",
    points: 1_200,
    source: "Redeemed: ₦5,000 Cash",
    type: "redeemed",
  },
  {
    date: "Mon Mar 25",
    points: 200,
    source: "Weekly target achieved",
    type: "bonus",
  },
  {
    date: "Mon Mar 25",
    points: 89,
    source: "Airtime — ₦1,000 × 5",
    type: "earned",
  },
  {
    date: "Sun Mar 24",
    points: 500,
    source: "Weekend multiplier bonus",
    type: "bonus",
  },
];

const WEEKLY_POINTS = [
  { day: "Mon", points: 420 },
  { day: "Tue", points: 380 },
  { day: "Wed", points: 510 },
  { day: "Thu", points: 290 },
  { day: "Fri", points: 640 },
  { day: "Sat", points: 720 },
  { day: "Sun", points: 180 },
];

const MULTIPLIERS = [
  { txType: "Cash In", multiplier: "2×", color: GREEN },
  { txType: "Cash Out", multiplier: "1.5×", color: BLUE },
  { txType: "Transfer", multiplier: "2×", color: PURPLE },
  { txType: "Card Payment", multiplier: "2.5×", color: GOLD },
  { txType: "NFC/Tap", multiplier: "3×", color: CYAN },
  { txType: "Airtime", multiplier: "1×", color: "#6b7280" },
  { txType: "Bills", multiplier: "1.5×", color: AMBER },
  { txType: "Account Open", multiplier: "5×", color: RED },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getCurrentTier = (points: number): LoyaltyTier =>
  TIERS.slice()
    .reverse()
    .find(t => points >= t.minPoints) || TIERS[0];

const getNextTier = (tier: LoyaltyTier): LoyaltyTier | null =>
  TIERS[TIERS.findIndex(t => t.name === tier.name) + 1] || null;

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LoyaltySystem({ onBack }: { onBack?: () => void }) {
  const [tab, setTab] = useState<
    "overview" | "rewards" | "challenges" | "leaderboard" | "history"
  >("overview");
  const [redeeming, setRedeeming] = useState<Reward | null>(null);
  // ── Leaderboard search/filter state ──────────────────────────────────────────────
  const [lbSearch, setLbSearch] = useState("");
  const [lbTier, setLbTier] = useState<
    "all" | "Bronze" | "Silver" | "Gold" | "Platinum"
  >("all");
  const [lbSortBy, setLbSortBy] = useState<"loyaltyPoints" | "streak" | "rank">(
    "loyaltyPoints"
  );
  const [lbPage, setLbPage] = useState(1);
  // ── Live data from tRPC ────────────────────────────────────────────────────────────
  const { data: loyaltyData, refetch } = trpc.loyalty.profile.useQuery(
    undefined,
    { retry: false }
  );
  const { data: lbData, isLoading: lbLoading } =
    trpc.loyalty.leaderboard.useQuery(
      { tier: lbTier, sortBy: lbSortBy, page: lbPage, limit: 20 },
      { enabled: tab === "leaderboard", retry: false }
    );
  const claimChallengeMutation = trpc.loyalty.claimChallenge.useMutation({
    onSuccess: () => refetch(),
  });
  const redeemRewardMutation = trpc.loyalty.redeemReward.useMutation({
    onSuccess: () => refetch(),
  });
  const storeAgent = usePosStore(s => s.agent);
  const updateLoyaltyPoints = usePosStore(s => s.updateLoyaltyPoints);

  // Use live points if available, fall back to store agent, then to mock
  const [points, setPoints] = useState(8_450);
  const [animPoints, setAnimPoints] = useState(8_450);

  useEffect(() => {
    const livePoints = loyaltyData?.points ?? storeAgent?.loyaltyPoints;
    if (livePoints !== undefined) {
      setPoints(livePoints);
    }
  }, [loyaltyData?.points, storeAgent?.loyaltyPoints]);

  const tier = getCurrentTier(points);
  const nextTier = getNextTier(tier);
  const tierProgress = nextTier
    ? ((points - tier.minPoints) / (nextTier.minPoints - tier.minPoints)) * 100
    : 100;

  // Animate points counter
  useEffect(() => {
    const diff = points - animPoints;
    if (diff === 0) return;
    const step = Math.ceil(Math.abs(diff) / 20);
    const iv = setInterval(() => {
      setAnimPoints(p => {
        const next =
          diff > 0 ? Math.min(p + step, points) : Math.max(p - step, points);
        if (next === points) clearInterval(iv);
        return next;
      });
    }, 30);
    return () => clearInterval(iv);
  }, [points]);

  const handleRedeem = (reward: Reward) => {
    if (points < reward.cost) {
      toast.error("Insufficient points");
      return;
    }
    // Try tRPC first, fall back to local update
    redeemRewardMutation.mutate(
      { rewardId: reward.id, pointsCost: reward.cost, rewardName: reward.name },
      {
        onSuccess: () => {
          updateLoyaltyPoints(-reward.cost);
          setRedeeming(null);
          toast.success(
            `🎉 Redeemed: ${reward.name}! Processing within 24 hours.`
          );
        },
        onError: () => {
          setPoints(p => p - reward.cost);
          setRedeeming(null);
          toast.success(
            `🎉 Redeemed: ${reward.name}! Processing within 24 hours.`
          );
        },
      }
    );
  };

  const claimChallenge = (challenge: Challenge) => {
    if (!challenge.completed) {
      toast.error("Challenge not yet completed");
      return;
    }
    // Try tRPC first, fall back to local update
    claimChallengeMutation.mutate(
      { challengeId: challenge.id, points: challenge.reward },
      {
        onSuccess: () => {
          updateLoyaltyPoints(challenge.reward);
          toast.success(`🏆 +${challenge.reward} points claimed!`);
        },
        onError: () => {
          setPoints(p => p + challenge.reward);
          toast.success(`🏆 +${challenge.reward} points claimed!`);
        },
      }
    );
  };

  return (
    <div className="flex flex-col h-screen" style={{ background: BG }}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
        style={{
          background: "oklch(0.07 0.01 240)",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white text-xl"
        >
          ←
        </button>
        <div className="flex-1">
          <div
            className="text-base font-bold text-white"
            style={{ fontFamily: DISP }}
          >
            Loyalty Rewards
          </div>
          <div className="text-xs text-gray-500">
            InsurePortal Agent Rewards Program
          </div>
        </div>
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl"
          style={{ background: `${GOLD}15`, border: `1px solid ${GOLD}30` }}
        >
          <span className="text-sm">{tier.icon}</span>
          <span
            className="text-sm font-bold"
            style={{ color: GOLD, fontFamily: MONO }}
          >
            {animPoints.toLocaleString()} pts
          </span>
        </div>
      </div>

      {/* Tab nav */}
      <div
        className="flex gap-1 px-4 py-2.5 overflow-x-auto flex-shrink-0"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        {(
          [
            { id: "overview", label: "Overview", icon: "🏠" },
            { id: "rewards", label: "Rewards", icon: "🎁" },
            { id: "challenges", label: "Challenges", icon: "🎯" },
            { id: "leaderboard", label: "Leaderboard", icon: "🏆" },
            { id: "history", label: "History", icon: "📋" },
          ] as const
        ).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0"
            style={{
              background: tab === t.id ? `${GOLD}20` : "transparent",
              color: tab === t.id ? GOLD : "#6b7280",
              border: `1px solid ${tab === t.id ? GOLD + "50" : "transparent"}`,
            }}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* ── OVERVIEW TAB ── */}
        {tab === "overview" && (
          <div className="flex flex-col gap-4">
            {/* Tier card */}
            <div
              className="rounded-2xl p-5 relative overflow-hidden"
              style={{
                background: tier.bgColor,
                border: `2px solid ${tier.color}40`,
              }}
            >
              <div className="absolute top-0 right-0 text-8xl opacity-10 -mt-4 -mr-4">
                {tier.icon}
              </div>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div
                    className="text-xs text-gray-400 uppercase tracking-wider mb-1"
                    style={{ fontFamily: DISP }}
                  >
                    Current Tier
                  </div>
                  <div
                    className="text-3xl font-bold"
                    style={{ color: tier.color, fontFamily: DISP }}
                  >
                    {tier.icon} {tier.name}
                  </div>
                  <div
                    className="text-xs mt-1"
                    style={{ color: tier.color, fontFamily: MONO }}
                  >
                    {tier.multiplier}× points multiplier
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="text-3xl font-bold"
                    style={{ color: GOLD, fontFamily: MONO }}
                  >
                    {animPoints.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-400">total points</div>
                </div>
              </div>

              {/* Progress to next tier */}
              {nextTier && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span
                      className="text-xs text-gray-400"
                      style={{ fontFamily: DISP }}
                    >
                      Progress to {nextTier.icon} {nextTier.name}
                    </span>
                    <span
                      className="text-xs font-bold"
                      style={{ color: nextTier.color, fontFamily: MONO }}
                    >
                      {(nextTier.minPoints - points).toLocaleString()} pts
                      needed
                    </span>
                  </div>
                  <div
                    className="h-3 rounded-full overflow-hidden"
                    style={{ background: "oklch(0.10 0.01 240)" }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{
                        width: `${tierProgress}%`,
                        background: `linear-gradient(90deg, ${tier.color}, ${nextTier.color})`,
                      }}
                    />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span
                      className="text-xs text-gray-600"
                      style={{ fontFamily: MONO }}
                    >
                      {tier.minPoints.toLocaleString()}
                    </span>
                    <span
                      className="text-xs text-gray-600"
                      style={{ fontFamily: MONO }}
                    >
                      {nextTier.minPoints.toLocaleString()}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: "This Week",
                  value: "+2,340",
                  color: GREEN,
                  icon: "📈",
                },
                { label: "Rank", value: "#14", color: GOLD, icon: "🏆" },
                { label: "Streak", value: "12 days", color: BLUE, icon: "🔥" },
              ].map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl p-3 text-center"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div className="text-xl mb-1">{s.icon}</div>
                  <div
                    className="text-sm font-bold"
                    style={{ color: s.color, fontFamily: MONO }}
                  >
                    {s.value}
                  </div>
                  <div
                    className="text-xs text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Weekly points chart */}
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-sm font-bold text-white mb-3"
                style={{ fontFamily: DISP }}
              >
                Points This Week
              </div>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={WEEKLY_POINTS}>
                  <defs>
                    <linearGradient id="ptGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={GOLD} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={GOLD} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                  />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{
                      background: CARD2,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="points"
                    stroke={GOLD}
                    fill="url(#ptGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Points multipliers */}
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-sm font-bold text-white mb-3"
                style={{ fontFamily: DISP }}
              >
                Points Multipliers (Gold Tier)
              </div>
              <div className="grid grid-cols-2 gap-2">
                {MULTIPLIERS.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 rounded-xl"
                    style={{ background: BG, border: `1px solid ${BORDER}` }}
                  >
                    <span
                      className="text-xs text-gray-300"
                      style={{ fontFamily: DISP }}
                    >
                      {m.txType}
                    </span>
                    <span
                      className="text-xs font-bold"
                      style={{ color: m.color, fontFamily: MONO }}
                    >
                      {m.multiplier}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Tier perks */}
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-sm font-bold text-white mb-3"
                style={{ fontFamily: DISP }}
              >
                Your {tier.name} Perks
              </div>
              {tier.perks.map((perk, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 py-2"
                  style={{
                    borderBottom:
                      i < tier.perks.length - 1
                        ? `1px solid ${BORDER}`
                        : "none",
                  }}
                >
                  <span className="text-green-400 text-sm">✓</span>
                  <span
                    className="text-sm text-gray-300"
                    style={{ fontFamily: DISP }}
                  >
                    {perk}
                  </span>
                </div>
              ))}
            </div>

            {/* All tiers */}
            <div
              className="rounded-2xl p-4"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-sm font-bold text-white mb-3"
                style={{ fontFamily: DISP }}
              >
                Tier Progression
              </div>
              {TIERS.map((t, i) => {
                const isActive = t.name === tier.name;
                const isAchieved = points >= t.minPoints;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-2.5"
                    style={{
                      borderBottom:
                        i < TIERS.length - 1 ? `1px solid ${BORDER}` : "none",
                    }}
                  >
                    <div className="text-xl">{t.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-bold"
                          style={{
                            color: isActive
                              ? t.color
                              : isAchieved
                                ? "#9ca3af"
                                : "#4b5563",
                            fontFamily: DISP,
                          }}
                        >
                          {t.name}
                        </span>
                        {isActive && (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-bold"
                            style={{
                              background: `${t.color}20`,
                              color: t.color,
                            }}
                          >
                            Current
                          </span>
                        )}
                      </div>
                      <div
                        className="text-xs text-gray-500"
                        style={{ fontFamily: MONO }}
                      >
                        {t.minPoints.toLocaleString()}
                        {t.maxPoints < Infinity
                          ? `–${t.maxPoints.toLocaleString()}`
                          : "+"}{" "}
                        pts · {t.multiplier}× multiplier
                      </div>
                    </div>
                    {isAchieved && (
                      <span className="text-green-400 text-sm">✓</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── REWARDS TAB ── */}
        {tab === "rewards" && (
          <div className="flex flex-col gap-3">
            <div
              className="rounded-xl p-3 flex items-center justify-between"
              style={{ background: `${GOLD}10`, border: `1px solid ${GOLD}30` }}
            >
              <span
                className="text-sm text-gray-300"
                style={{ fontFamily: DISP }}
              >
                Available balance
              </span>
              <span
                className="text-lg font-bold"
                style={{ color: GOLD, fontFamily: MONO }}
              >
                {points.toLocaleString()} pts
              </span>
            </div>

            {(
              [
                "cash",
                "float",
                "data",
                "device",
                "training",
                "recognition",
              ] as const
            ).map(cat => {
              const catRewards = REWARDS.filter(r => r.category === cat);
              if (!catRewards.length) return null;
              const catLabel: Record<string, string> = {
                cash: "💵 Cash Bonuses",
                float: "💰 Float Top-Ups",
                data: "📶 Data Bundles",
                device: "🖥 Device & Accessories",
                training: "📚 Training",
                recognition: "🏆 Recognition",
              };
              return (
                <div key={cat}>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 mt-2">
                    {catLabel[cat]}
                  </div>
                  <div className="flex flex-col gap-2">
                    {catRewards.map(reward => (
                      <div
                        key={reward.id}
                        className="flex items-center gap-3 p-4 rounded-2xl"
                        style={{
                          background: CARD,
                          border: `1px solid ${BORDER}`,
                          opacity: reward.available ? 1 : 0.5,
                        }}
                      >
                        <div className="text-3xl">{reward.icon}</div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-sm font-bold text-white"
                              style={{ fontFamily: DISP }}
                            >
                              {reward.name}
                            </span>
                            {reward.popular && (
                              <span
                                className="text-xs px-1.5 py-0.5 rounded font-bold"
                                style={{ background: `${RED}20`, color: RED }}
                              >
                                HOT
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {reward.description}
                          </div>
                          <div
                            className="text-sm font-bold mt-1"
                            style={{
                              color: points >= reward.cost ? GOLD : "#6b7280",
                              fontFamily: MONO,
                            }}
                          >
                            {reward.cost === 0
                              ? "Auto-awarded"
                              : `${reward.cost.toLocaleString()} pts`}
                          </div>
                        </div>
                        {reward.available && reward.cost > 0 && (
                          <button
                            onClick={() => setRedeeming(reward)}
                            disabled={points < reward.cost}
                            className="px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                            style={{
                              background:
                                points >= reward.cost ? `${GOLD}20` : CARD,
                              color: points >= reward.cost ? GOLD : "#4b5563",
                              border: `1px solid ${points >= reward.cost ? GOLD + "40" : BORDER}`,
                            }}
                          >
                            Redeem
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── CHALLENGES TAB ── */}
        {tab === "challenges" && (
          <div className="flex flex-col gap-4">
            {(["daily", "weekly", "monthly"] as const).map(type => {
              const typeChallenges = CHALLENGES.filter(c => c.type === type);
              return (
                <div key={type}>
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {type === "daily"
                      ? "⚡ Daily"
                      : type === "weekly"
                        ? "🗓 Weekly"
                        : "📅 Monthly"}{" "}
                    Challenges
                  </div>
                  <div className="flex flex-col gap-3">
                    {typeChallenges.map(ch => {
                      const pct = Math.min(
                        (ch.progress / ch.target) * 100,
                        100
                      );
                      const isNum = ch.target > 100;
                      return (
                        <div
                          key={ch.id}
                          className="rounded-2xl p-4"
                          style={{
                            background: CARD,
                            border: `1px solid ${ch.completed ? GREEN + "40" : BORDER}`,
                          }}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{ch.icon}</span>
                              <div>
                                <div
                                  className="text-sm font-bold text-white"
                                  style={{ fontFamily: DISP }}
                                >
                                  {ch.title}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {ch.description}
                                </div>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0 ml-2">
                              <div
                                className="text-sm font-bold"
                                style={{ color: GOLD, fontFamily: MONO }}
                              >
                                +{ch.reward} pts
                              </div>
                              <div className="text-xs text-gray-500">
                                {ch.deadline}
                              </div>
                            </div>
                          </div>
                          {/* Progress */}
                          <div className="mb-3">
                            <div className="flex justify-between mb-1">
                              <span className="text-xs text-gray-400">
                                {isNum
                                  ? `₦${ch.progress.toLocaleString()} / ₦${ch.target.toLocaleString()}`
                                  : `${ch.progress} / ${ch.target}`}
                              </span>
                              <span
                                className="text-xs font-bold"
                                style={{
                                  color: ch.completed ? GREEN : GOLD,
                                  fontFamily: MONO,
                                }}
                              >
                                {Math.round(pct)}%
                              </span>
                            </div>
                            <div
                              className="h-2 rounded-full overflow-hidden"
                              style={{ background: BORDER }}
                            >
                              <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                  width: `${pct}%`,
                                  background: ch.completed
                                    ? GREEN
                                    : `linear-gradient(90deg, ${BLUE}, ${GOLD})`,
                                }}
                              />
                            </div>
                          </div>
                          <button
                            onClick={() => claimChallenge(ch)}
                            disabled={!ch.completed}
                            className="w-full py-2.5 rounded-xl text-sm font-bold transition-all active:scale-98"
                            style={{
                              background: ch.completed ? `${GREEN}20` : CARD,
                              color: ch.completed ? GREEN : "#4b5563",
                              border: `1px solid ${ch.completed ? GREEN + "40" : BORDER}`,
                            }}
                          >
                            {ch.completed
                              ? "✓ Claim Reward"
                              : `${Math.round(pct)}% Complete`}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── LEADERBOARD TAB ── */}
        {tab === "leaderboard" && (
          <div className="flex flex-col gap-3">
            {/* Search + Filter controls */}
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                placeholder="Search agent name or code…"
                value={lbSearch}
                onChange={e => {
                  setLbSearch(e.target.value);
                  setLbPage(1);
                }}
                className="flex-1 min-w-[140px] text-xs px-3 py-1.5 rounded-xl border"
                style={{
                  background: CARD,
                  borderColor: BORDER,
                  color: "white",
                }}
              />
              <select
                value={lbTier}
                onChange={e => {
                  setLbTier(e.target.value as any);
                  setLbPage(1);
                }}
                className="text-xs px-2 py-1.5 rounded-xl border"
                style={{
                  background: CARD,
                  borderColor: BORDER,
                  color: "white",
                }}
              >
                <option value="all">All Tiers</option>
                {["Bronze", "Silver", "Gold", "Platinum"].map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={lbSortBy}
                onChange={e => {
                  setLbSortBy(e.target.value as any);
                  setLbPage(1);
                }}
                className="text-xs px-2 py-1.5 rounded-xl border"
                style={{
                  background: CARD,
                  borderColor: BORDER,
                  color: "white",
                }}
              >
                <option value="loyaltyPoints">By Points</option>
                <option value="streak">By Streak</option>
                <option value="rank">By Rank</option>
              </select>
            </div>

            {lbLoading ? (
              <div
                className="text-center py-8 text-xs"
                style={{ color: "#6b7280" }}
              >
                Loading leaderboard…
              </div>
            ) : (
              <>
                {/* Top 3 podium (only on page 1, no search) */}
                {lbPage === 1 &&
                  !lbSearch &&
                  (lbData?.agents ?? []).length >= 3 && (
                    <div className="flex items-end justify-center gap-3 py-4">
                      {[lbData!.agents[1], lbData!.agents[0], lbData!.agents[2]]
                        .filter(Boolean)
                        .map((entry, i) => {
                          const tierObj =
                            TIERS.find(t => t.name === entry.tier) ?? TIERS[0];
                          return (
                            <div
                              key={entry.id}
                              className={`flex flex-col items-center gap-1 justify-end`}
                            >
                              <div className="text-lg">{tierObj.icon}</div>
                              <div
                                className="text-xs font-bold text-white text-center"
                                style={{ fontFamily: DISP, maxWidth: 70 }}
                              >
                                {entry.name.split(" ")[0]}
                              </div>
                              <div
                                className="w-16 rounded-t-xl flex items-center justify-center font-bold text-white"
                                style={{
                                  height: i === 1 ? 80 : i === 0 ? 60 : 48,
                                  background:
                                    i === 1
                                      ? `linear-gradient(180deg, ${GOLD}, ${AMBER})`
                                      : CARD2,
                                  border: `1px solid ${i === 1 ? GOLD : BORDER}`,
                                  fontFamily: MONO,
                                }}
                              >
                                #{entry.position}
                              </div>
                              <div
                                className="text-xs font-bold"
                                style={{ color: GOLD, fontFamily: MONO }}
                              >
                                {((entry.loyaltyPoints ?? 0) / 1000).toFixed(1)}
                                K
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                {/* Full list */}
                <div
                  className="rounded-2xl overflow-hidden"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  {(lbData?.agents ?? [])
                    .filter(
                      e =>
                        !lbSearch ||
                        e.name.toLowerCase().includes(lbSearch.toLowerCase()) ||
                        (e.agentId ?? "")
                          .toLowerCase()
                          .includes(lbSearch.toLowerCase())
                    )
                    .map((entry, i, arr) => {
                      const tierObj =
                        TIERS.find(t => t.name === entry.tier) ?? TIERS[0];
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center gap-3 px-4 py-3"
                          style={{
                            borderBottom:
                              i < arr.length - 1
                                ? `1px solid ${BORDER}`
                                : "none",
                          }}
                        >
                          <div className="w-8 text-center">
                            <span
                              className="text-sm font-bold"
                              style={{
                                color:
                                  (entry.position ?? 99) <= 3
                                    ? GOLD
                                    : "#6b7280",
                                fontFamily: MONO,
                              }}
                            >
                              {(entry.position ?? 99) <= 3
                                ? ["🥇", "🥈", "🥉"][(entry.position ?? 99) - 1]
                                : `#${entry.position}`}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div
                              className="text-sm font-bold text-white truncate"
                              style={{ fontFamily: DISP }}
                            >
                              {entry.name}
                            </div>
                            <div
                              className="text-xs truncate"
                              style={{ color: "#6b7280" }}
                            >
                              {entry.location ?? entry.agentId}
                            </div>
                          </div>
                          <span className="text-base">{tierObj.icon}</span>
                          <div className="text-right">
                            <div
                              className="text-sm font-bold"
                              style={{ color: GOLD, fontFamily: MONO }}
                            >
                              {(entry.loyaltyPoints ?? 0).toLocaleString()}
                            </div>
                            <div
                              className="text-xs"
                              style={{ color: "#6b7280", fontFamily: MONO }}
                            >
                              streak {entry.streak ?? 0}d
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  {(lbData?.agents ?? []).length === 0 && (
                    <div
                      className="p-6 text-center text-xs"
                      style={{ color: "#6b7280" }}
                    >
                      No agents found
                    </div>
                  )}
                </div>

                {/* Pagination */}
                {(lbData?.total ?? 0) > 20 && (
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs" style={{ color: "#6b7280" }}>
                      Page {lbPage} of {Math.ceil((lbData?.total ?? 0) / 20)}
                    </span>
                    <div className="flex gap-2">
                      <button
                        disabled={lbPage === 1}
                        onClick={() => setLbPage(p => p - 1)}
                        className="text-xs px-3 py-1 rounded-lg"
                        style={{
                          background: CARD2,
                          color: lbPage === 1 ? "#4b5563" : GOLD,
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        Prev
                      </button>
                      <button
                        disabled={
                          lbPage >= Math.ceil((lbData?.total ?? 0) / 20)
                        }
                        onClick={() => setLbPage(p => p + 1)}
                        className="text-xs px-3 py-1 rounded-lg"
                        style={{
                          background: CARD2,
                          color:
                            lbPage >= Math.ceil((lbData?.total ?? 0) / 20)
                              ? "#4b5563"
                              : GOLD,
                          border: `1px solid ${BORDER}`,
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 mb-2">
              <div
                className="rounded-xl p-3 text-center"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div
                  className="text-lg font-bold"
                  style={{ color: GREEN, fontFamily: MONO }}
                >
                  +
                  {POINTS_HISTORY.filter(h => h.type !== "redeemed")
                    .reduce((s: any, h: any) => s + h.points, 0)
                    .toLocaleString()}
                </div>
                <div className="text-xs text-gray-500">Earned this month</div>
              </div>
              <div
                className="rounded-xl p-3 text-center"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div
                  className="text-lg font-bold"
                  style={{ color: RED, fontFamily: MONO }}
                >
                  −
                  {POINTS_HISTORY.filter(h => h.type === "redeemed")
                    .reduce((s: any, h: any) => s + h.points, 0)
                    .toLocaleString()}
                </div>
                <div className="text-xs text-gray-500">Redeemed this month</div>
              </div>
            </div>

            <div
              className="rounded-2xl overflow-hidden"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              {POINTS_HISTORY.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{
                    borderBottom:
                      i < POINTS_HISTORY.length - 1
                        ? `1px solid ${BORDER}`
                        : "none",
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background:
                        h.type === "earned"
                          ? `${GREEN}20`
                          : h.type === "bonus"
                            ? `${GOLD}20`
                            : `${RED}20`,
                    }}
                  >
                    <span className="text-sm">
                      {h.type === "earned"
                        ? "+"
                        : h.type === "bonus"
                          ? "⭐"
                          : "−"}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm text-white truncate"
                      style={{ fontFamily: DISP }}
                    >
                      {h.source}
                    </div>
                    <div className="text-xs text-gray-500">{h.date}</div>
                  </div>
                  <div
                    className="text-sm font-bold flex-shrink-0"
                    style={{
                      color:
                        h.type === "redeemed"
                          ? RED
                          : h.type === "bonus"
                            ? GOLD
                            : GREEN,
                      fontFamily: MONO,
                    }}
                  >
                    {h.type === "redeemed" ? "−" : "+"}
                    {h.points.toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Redemption confirmation modal */}
      {redeeming && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.85)" }}
        >
          <div
            className="w-full max-w-sm rounded-t-3xl p-6"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="text-center mb-5">
              <div className="text-5xl mb-3">{redeeming.icon}</div>
              <h3
                className="text-white font-bold text-xl mb-1"
                style={{ fontFamily: DISP }}
              >
                Confirm Redemption
              </h3>
              <p className="text-gray-400 text-sm">{redeeming.name}</p>
            </div>
            <div
              className="rounded-xl p-4 mb-4"
              style={{ background: BG, border: `1px solid ${BORDER}` }}
            >
              {[
                ["Cost", `${redeeming.cost.toLocaleString()} pts`],
                ["Balance", `${points.toLocaleString()} pts`],
                [
                  "Remaining",
                  `${(points - redeeming.cost).toLocaleString()} pts`,
                ],
              ].map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between py-2"
                  style={{ borderBottom: `1px solid ${BORDER}` }}
                >
                  <span className="text-gray-500 text-sm">{k}</span>
                  <span
                    className="text-white text-sm font-bold"
                    style={{ fontFamily: MONO }}
                  >
                    {v}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setRedeeming(null)}
                className="flex-1 py-3 rounded-xl font-semibold text-gray-400"
                style={{ background: BG, border: `1px solid ${BORDER}` }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleRedeem(redeeming)}
                className="flex-1 py-3 rounded-xl font-bold text-white"
                style={{
                  background: `linear-gradient(135deg, ${GOLD}, ${AMBER})`,
                }}
              >
                ✓ Redeem Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
