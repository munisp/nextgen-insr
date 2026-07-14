import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { getLoginUrl } from "@/const";
import {
  Shield,
  Zap,
  Globe,
  Smartphone,
  BarChart3,
  Users,
  ArrowRight,
  CheckCircle2,
  Lock,
  Wifi,
  CreditCard,
  Building2,
} from "lucide-react";

const FEATURES = [
  {
    icon: <CreditCard className="w-6 h-6" />,
    title: "Multi-Channel Payments",
    desc: "Cash-in, claim payout, transfers, NFC, QR, card — all from one terminal.",
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: "Real-Time Fraud Detection",
    desc: "ML-powered scoring with auto-escalation, geo-fencing, and velocity checks.",
  },
  {
    icon: <Wifi className="w-6 h-6" />,
    title: "Offline-First Architecture",
    desc: "Rust-powered durable queue + USSD fallback. Never miss a transaction.",
  },
  {
    icon: <BarChart3 className="w-6 h-6" />,
    title: "Analytics & Reporting",
    desc: "CBN-compliant reports, real-time dashboards, and data lake integration.",
  },
  {
    icon: <Users className="w-6 h-6" />,
    title: "Agent Network Management",
    desc: "Onboarding, KYC, tiered commissions, loyalty rewards, and MDM.",
  },
  {
    icon: <Lock className="w-6 h-6" />,
    title: "Enterprise Security",
    desc: "mTLS, Keycloak SSO, Permify RBAC, Vault secrets, and OWASP hardening.",
  },
];

const STATS = [
  { value: "50K+", label: "Active Agents" },
  { value: "₦2.1B", label: "Daily Volume" },
  { value: "99.97%", label: "Uptime SLA" },
  { value: "<200ms", label: "Avg Latency" },
];

const STACK = [
  "TigerBeetle Ledger",
  "Apache Kafka",
  "Temporal Workflows",
  "HashiCorp Vault",
  "Keycloak IAM",
  "Permify RBAC",
  "Apache Sedona",
  "Prometheus + Grafana",
];

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen bg-[oklch(0.06_0.012_240)] text-white">
      {/* ── Nav ─────────────────────────────────────────────────────────────── */}
      <nav className="border-b border-white/10 backdrop-blur-md sticky top-0 z-50 bg-[oklch(0.06_0.012_240)]/80">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center font-bold text-sm text-black">
              54
            </div>
            <span className="text-lg font-semibold tracking-tight">InsurePortal</span>
            <Badge
              variant="outline"
              className="text-[10px] border-emerald-500/40 text-emerald-400 ml-1"
            >
              v4.0
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-500"
                onClick={() => navigate("/platform")}
              >
                Open Platform <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-400 hover:text-white"
                  onClick={() => (window.location.href = getLoginUrl())}
                >
                  Sign In
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-500"
                  onClick={() => (window.location.href = getLoginUrl())}
                >
                  Get Started
                </Button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/5 to-transparent" />
        <div className="max-w-7xl mx-auto px-6 pt-24 pb-20 relative">
          <div className="max-w-3xl">
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 mb-6">
              <Zap className="w-3 h-3 mr-1" /> Nigeria's Premier Insurance
              Platform
            </Badge>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] mb-6">
              The Operating System for{" "}
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                Insurance
              </span>
            </h1>
            <p className="text-lg text-gray-400 leading-relaxed mb-8 max-w-2xl">
              InsurePortal powers 50,000+ POS agents across Nigeria with real-time
              fraud detection, offline-first transactions, TigerBeetle
              double-entry ledger, and CBN-compliant reporting — all from a
              single terminal.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="bg-emerald-600 hover:bg-emerald-500 h-12 px-8"
                onClick={() =>
                  isAuthenticated
                    ? navigate("/pos")
                    : (window.location.href = getLoginUrl())
                }
              >
                <Smartphone className="w-5 h-5 mr-2" /> Launch Service Node
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-12 px-8 border-white/20 text-white hover:bg-white/5"
                onClick={() => navigate("/platform")}
              >
                <Globe className="w-5 h-5 mr-2" /> Explore Platform
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      <section className="border-y border-white/10 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-2 md:grid-cols-4 gap-8">
          {STATS.map((s: any) => (
            <div key={s.label} className="text-center">
              <div className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                {s.value}
              </div>
              <div className="text-sm text-gray-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ────────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold mb-4">Enterprise-Grade Features</h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Built for the unique challenges of Nigerian insurance —
            unreliable networks, regulatory compliance, and massive scale.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f: any) => (
            <Card
              key={f.title}
              className="bg-white/[0.03] border-white/10 hover:border-emerald-500/30 transition-colors"
            >
              <CardContent className="p-6">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-4">
                  {f.icon}
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">
                  {f.title}
                </h3>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {f.desc}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ── Tech Stack ──────────────────────────────────────────────────────── */}
      <section className="border-t border-white/10 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">
              Production Infrastructure
            </h2>
            <p className="text-gray-400">
              Battle-tested components powering every transaction.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {STACK.map((s: any) => (
              <Badge
                key={s}
                variant="outline"
                className="border-white/15 text-gray-300 px-4 py-2 text-sm"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1.5 text-emerald-500" />{" "}
                {s}
              </Badge>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 p-12 text-center">
          <Building2 className="w-12 h-12 text-emerald-400 mx-auto mb-6" />
          <h2 className="text-3xl font-bold mb-4">
            Ready to Transform Your Agent Network?
          </h2>
          <p className="text-gray-400 max-w-xl mx-auto mb-8">
            Join thousands of financial institutions using InsurePortal to power their
            insurance operations.
          </p>
          <Button
            size="lg"
            className="bg-emerald-600 hover:bg-emerald-500 h-12 px-10"
            onClick={() =>
              isAuthenticated
                ? navigate("/platform")
                : (window.location.href = getLoginUrl())
            }
          >
            Get Started Today <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/10 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="w-5 h-5 rounded bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center font-bold text-[8px] text-black">
              54
            </div>
            InsurePortal Insurance Platform &copy; {new Date().getFullYear()}
          </div>
          <div className="flex gap-6 text-sm text-gray-500">
            <a href="/privacy" className="hover:text-white transition-colors">
              Privacy Policy
            </a>
            <a href="/hub" className="hover:text-white transition-colors">
              Platform
            </a>
            <a href="/admin" className="hover:text-white transition-colors">
              Admin
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
