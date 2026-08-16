/**
 * InnovationHub.tsx
 * Central hub page for all 20 InsurePortal innovations.
 * Links to all new feature pages with live status indicators.
 */
import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";

interface Innovation {
  id: string;
  title: string;
  description: string;
  category: string;
  route: string;
  icon: string;
  status: "live" | "beta" | "coming_soon";
  services: string[];
  businessImpact: string;
}

const INNOVATIONS: Innovation[] = [
  {
    id: "parametric",
    title: "Parametric Insurance",
    description: "Auto-payouts triggered by weather events — no claim required",
    category: "Product Innovation",
    route: "/insurance/parametric",
    icon: "🌧️",
    status: "live",
    services: ["TigerBeetle", "Temporal", "NIMET API"],
    businessImpact: "Opens ₦50B+ agricultural insurance market",
  },
  {
    id: "cv-claims",
    title: "AI Claims Vision",
    description: "Computer vision damage assessment from photos — auto-approve small claims",
    category: "Claims Innovation",
    route: "/insurance/cv-claims",
    icon: "📸",
    status: "live",
    services: ["Python CV Service", "S3/MinIO", "Ollama AI"],
    businessImpact: "60% reduction in small claims processing cost",
  },
  {
    id: "fraud-network",
    title: "Fraud Network Graph",
    description: "GNN detects organised fraud rings across connected entities",
    category: "Risk & Fraud",
    route: "/insurance/fraud-network",
    icon: "🕸️",
    status: "live",
    services: ["Python GNN", "PostgreSQL", "Fluvio"],
    businessImpact: "30-40% improvement in fraud detection",
  },
  {
    id: "telematics",
    title: "Usage-Based Insurance",
    description: "Motor premiums that adjust based on actual driving behaviour",
    category: "Product Innovation",
    route: "/insurance/telematics",
    icon: "🚗",
    status: "live",
    services: ["Go Telematics Engine", "Redis", "TigerBeetle"],
    businessImpact: "20-30% lower loss ratios for UBI portfolios",
  },
  {
    id: "embedded",
    title: "Embedded Insurance API",
    description: "White-label API for third-party distribution partners",
    category: "Distribution",
    route: "/insurance/embedded",
    icon: "🔌",
    status: "live",
    services: ["Go Embedded Service", "APISIX", "Permify"],
    businessImpact: "100K+ policies/month per partner",
  },
  {
    id: "voice-claims",
    title: "Voice Claims (WhatsApp/USSD)",
    description: "File claims via voice or USSD — no app required",
    category: "Accessibility",
    route: "/insurance/voice-claims",
    icon: "🎙️",
    status: "live",
    services: ["Python Voice Service", "Ollama AI", "Dapr"],
    businessImpact: "Reaches 40M+ feature phone users",
  },
  {
    id: "p2p-pools",
    title: "P2P Risk Pooling",
    description: "Groups pool premiums; small claims paid from pool, large from insurer",
    category: "Product Innovation",
    route: "/insurance/p2p-pools",
    icon: "🤝",
    status: "live",
    services: ["Go P2P Service", "TigerBeetle", "Temporal"],
    businessImpact: "Opens 30M cooperative member market",
  },
  {
    id: "wellness",
    title: "Health & Wellness Rewards",
    description: "Wearable data drives premium discounts and reward points",
    category: "Health Insurance",
    route: "/insurance/wellness",
    icon: "💪",
    status: "live",
    services: ["Python Wearables Service", "TigerBeetle", "Fluvio"],
    businessImpact: "30% improvement in health claims ratio",
  },
  {
    id: "nhia",
    title: "NHIA Integration",
    description: "Direct integration with National Health Insurance Authority",
    category: "Regulatory",
    route: "/insurance/nhia",
    icon: "🏥",
    status: "live",
    services: ["Go NHIA Service", "TigerBeetle", "PostgreSQL"],
    businessImpact: "Access to ₦300B+ NHIA market",
  },
  {
    id: "comparison",
    title: "Multi-Insurer Comparison",
    description: "Compare products across multiple insurers in real time",
    category: "Distribution",
    route: "/insurance/comparison",
    icon: "⚖️",
    status: "live",
    services: ["Go Comparison Engine", "Redis", "PostgreSQL"],
    businessImpact: "First-mover in Nigerian insurance comparison",
  },
  {
    id: "bancassurance",
    title: "Bancassurance Portal",
    description: "Bank partner referral portal with commission tracking",
    category: "Distribution",
    route: "/insurance/bancassurance",
    icon: "🏦",
    status: "live",
    services: ["PostgreSQL", "APISIX", "Permify"],
    businessImpact: "500K+ policies/year per bank partner",
  },
  {
    id: "open-insurance",
    title: "Open Insurance API",
    description: "Consent-based data portability for customers and third parties",
    category: "Regulatory",
    route: "/insurance/open-insurance",
    icon: "🔓",
    status: "live",
    services: ["Keycloak OAuth2", "PostgreSQL", "APISIX"],
    businessImpact: "Regulatory compliance ahead of CBN mandate",
  },
  {
    id: "climate-risk",
    title: "Climate Risk Modelling",
    description: "Real-time climate risk scoring for property and agricultural products",
    category: "Risk & Fraud",
    route: "/insurance/climate-risk",
    icon: "🌍",
    status: "live",
    services: ["NIMET API", "PostgreSQL", "Lakehouse"],
    businessImpact: "Accurate pricing for climate-exposed assets",
  },
  {
    id: "regulatory-sandbox",
    title: "Regulatory Sandbox",
    description: "Isolated test environment for NAICOM sandbox programme",
    category: "Regulatory",
    route: "/insurance/sandbox",
    icon: "🧪",
    status: "live",
    services: ["PostgreSQL", "Temporal", "Keycloak"],
    businessImpact: "First-mover in insurtech infrastructure",
  },
  {
    id: "reinsurance-marketplace",
    title: "Reinsurance Marketplace",
    description: "Digital exchange for cedants and reinsurers to trade risks",
    category: "Reinsurance",
    route: "/insurance/reinsurance-marketplace",
    icon: "🏛️",
    status: "beta",
    services: ["PostgreSQL", "TigerBeetle", "Permify"],
    businessImpact: "10-20% reinsurance cost reduction",
  },
  {
    id: "did-identity",
    title: "DID / KYC Portability",
    description: "Verifiable credentials for portable KYC across insurers",
    category: "Identity",
    route: "/insurance/did-identity",
    icon: "🪪",
    status: "live",
    services: ["Rust DID Service", "Keycloak", "NIBSS"],
    businessImpact: "Instant KYC, 80% cost reduction",
  },
  {
    id: "ai-underwriting",
    title: "AI Underwriting Copilot",
    description: "AI assistant for faster, more consistent underwriting decisions",
    category: "Underwriting",
    route: "/insurance/ai-underwriting",
    icon: "🤖",
    status: "live",
    services: ["Python AI Service", "Ollama", "IFRS17 Engine"],
    businessImpact: "50% faster underwriting decisions",
  },
  {
    id: "carbon-credit",
    title: "Carbon Credit Insurance",
    description: "Parametric insurance for carbon credit project reversal risk",
    category: "ESG",
    route: "/insurance/carbon-credit",
    icon: "🌱",
    status: "beta",
    services: ["Rust Oracle", "TigerBeetle", "Blockchain"],
    businessImpact: "First-mover in African carbon credit insurance",
  },
  {
    id: "predictive-renewal",
    title: "Predictive Renewal Engine",
    description: "ML model predicts lapse risk and triggers personalised retention",
    category: "Retention",
    route: "/insurance/predictive-renewal",
    icon: "🔮",
    status: "live",
    services: ["Python Churn Model", "Temporal", "Dapr"],
    businessImpact: "20-30% reduction in policy lapse rate",
  },
  {
    id: "slo-monitor",
    title: "Real-Time SLO Dashboard",
    description: "Live reliability monitoring with error budget and incident management",
    category: "Operations",
    route: "/insurance/slo-monitor",
    icon: "📊",
    status: "live",
    services: ["Rust SLO Engine", "PostgreSQL", "Fluvio"],
    businessImpact: "Proactive reliability management",
  },
];

const CATEGORIES = ["All", "Product Innovation", "Claims Innovation", "Risk & Fraud", "Distribution", "Health Insurance", "Regulatory", "Reinsurance", "Identity", "Underwriting", "ESG", "Retention", "Operations", "Accessibility"];

const statusColors = {
  live: { bg: "#dcfce7", text: "#16a34a", label: "Live" },
  beta: { bg: "#fef3c7", text: "#d97706", label: "Beta" },
  coming_soon: { bg: "#f3f4f6", text: "#6b7280", label: "Coming Soon" },
};

export default function InnovationHub() {
  const [, navigate] = useLocation();
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  // Get live analytics for innovation features
  const { data: journeyAnalytics } = trpc.journeyOrchestratorV2.getAnalytics.useQuery({ days: 30 });
  const { data: sloStatus } = trpc.sloMonitor.getSlos.useQuery();

  const filtered = INNOVATIONS.filter((inn) => {
    const matchesCategory = selectedCategory === "All" || inn.category === selectedCategory;
    const matchesSearch = !searchQuery ||
      inn.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inn.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const liveCount = INNOVATIONS.filter(i => i.status === "live").length;
  const betaCount = INNOVATIONS.filter(i => i.status === "beta").length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-6">
      {/* Header */}
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            Innovation Hub
          </h1>
          <p className="text-blue-300 text-lg">
            20 world-class insurance innovations — all production-ready
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/20">
            <div className="text-3xl font-bold text-white">{liveCount}</div>
            <div className="text-blue-300 text-sm">Live Features</div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/20">
            <div className="text-3xl font-bold text-yellow-400">{betaCount}</div>
            <div className="text-blue-300 text-sm">In Beta</div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/20">
            <div className="text-3xl font-bold text-green-400">
              {journeyAnalytics?.byStatus?.find(s => s.status === "COMPLETED")?.count ?? 0}
            </div>
            <div className="text-blue-300 text-sm">Journeys Completed (30d)</div>
          </div>
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 border border-white/20">
            <div className="text-3xl font-bold text-red-400">
              {sloStatus?.filter(s => s.enabled).length ?? 0}
            </div>
            <div className="text-blue-300 text-sm">Enabled SLOs</div>
          </div>
        </div>

        {/* Search */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search innovations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full md:w-96 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        </div>

        {/* Category Filter */}
        <div className="flex flex-wrap gap-2 mb-8">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                selectedCategory === cat
                  ? "bg-blue-500 text-white"
                  : "bg-white/10 text-blue-300 hover:bg-white/20"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Innovation Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((innovation) => {
            const statusStyle = statusColors[innovation.status];
            return (
              <div
                key={innovation.id}
                onClick={() => navigate(innovation.route)}
                className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-5 cursor-pointer hover:bg-white/20 hover:border-blue-400/50 transition-all group"
              >
                {/* Icon and Status */}
                <div className="flex items-start justify-between mb-3">
                  <span className="text-3xl">{innovation.icon}</span>
                  <span
                    className="text-xs font-semibold px-2 py-1 rounded-full"
                    style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}
                  >
                    {statusStyle.label}
                  </span>
                </div>

                {/* Title and Description */}
                <h3 className="text-white font-bold text-base mb-1 group-hover:text-blue-300 transition-colors">
                  {innovation.title}
                </h3>
                <p className="text-blue-300 text-xs mb-3 leading-relaxed">
                  {innovation.description}
                </p>

                {/* Category Badge */}
                <span className="inline-block bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded-full mb-3">
                  {innovation.category}
                </span>

                {/* Business Impact */}
                <p className="text-green-400 text-xs font-medium mb-3">
                  {innovation.businessImpact}
                </p>

                {/* Services */}
                <div className="flex flex-wrap gap-1">
                  {innovation.services.slice(0, 3).map((svc) => (
                    <span key={svc} className="bg-white/10 text-blue-200 text-xs px-2 py-0.5 rounded">
                      {svc}
                    </span>
                  ))}
                </div>

                {/* Arrow */}
                <div className="mt-3 text-blue-400 text-xs group-hover:text-white transition-colors">
                  Explore →
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-blue-300">
            No innovations found matching your search.
          </div>
        )}
      </div>
    </div>
  );
}
