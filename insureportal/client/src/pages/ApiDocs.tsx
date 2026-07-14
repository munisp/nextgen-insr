import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Code2,
  Lock,
  Globe,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";

interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  description: string;
  auth: "public" | "protected" | "admin";
  category: string;
  params?: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
  response?: string;
}

const endpoints: Endpoint[] = [
  // Auth
  {
    method: "GET",
    path: "/api/trpc/auth.me",
    description: "Get current authenticated user",
    auth: "public",
    category: "Authentication",
  },
  {
    method: "POST",
    path: "/api/trpc/auth.logout",
    description: "Logout current session",
    auth: "protected",
    category: "Authentication",
  },
  // Transactions
  {
    method: "GET",
    path: "/api/trpc/transactions.list",
    description: "List transactions with pagination and filters",
    auth: "protected",
    category: "Transactions",
    params: [
      {
        name: "page",
        type: "number",
        required: false,
        description: "Page number (default: 1)",
      },
      {
        name: "limit",
        type: "number",
        required: false,
        description: "Items per page (default: 20)",
      },
      {
        name: "status",
        type: "string",
        required: false,
        description: "Filter by status",
      },
    ],
  },
  {
    method: "POST",
    path: "/api/trpc/transactions.create",
    description: "Create a new transaction",
    auth: "protected",
    category: "Transactions",
    params: [
      {
        name: "type",
        type: "string",
        required: true,
        description:
          "Transaction type (premium_payment, claim_payout, transfer, bill_payment)",
      },
      {
        name: "amount",
        type: "number",
        required: true,
        description: "Transaction amount in Naira",
      },
      {
        name: "agentId",
        type: "string",
        required: true,
        description: "Agent ID processing the transaction",
      },
    ],
  },
  {
    method: "GET",
    path: "/api/trpc/transactions.get",
    description: "Get transaction by ID",
    auth: "protected",
    category: "Transactions",
  },
  {
    method: "POST",
    path: "/api/trpc/transactions.reverse",
    description: "Reverse a completed transaction",
    auth: "admin",
    category: "Transactions",
  },
  // Agents
  {
    method: "GET",
    path: "/api/trpc/agents.list",
    description: "List all agents with filters",
    auth: "protected",
    category: "Agents",
  },
  {
    method: "POST",
    path: "/api/trpc/agents.create",
    description: "Register a new agent",
    auth: "admin",
    category: "Agents",
  },
  {
    method: "GET",
    path: "/api/trpc/agents.get",
    description: "Get agent details by ID",
    auth: "protected",
    category: "Agents",
  },
  {
    method: "POST",
    path: "/api/trpc/agents.update",
    description: "Update agent information",
    auth: "protected",
    category: "Agents",
  },
  // Fraud
  {
    method: "GET",
    path: "/api/trpc/fraud.alerts",
    description: "List fraud alerts",
    auth: "protected",
    category: "Fraud Detection",
  },
  {
    method: "GET",
    path: "/api/trpc/fraud.rules",
    description: "List fraud detection rules",
    auth: "admin",
    category: "Fraud Detection",
  },
  {
    method: "POST",
    path: "/api/trpc/fraud.resolve",
    description: "Resolve a fraud alert",
    auth: "protected",
    category: "Fraud Detection",
  },
  // KYC
  {
    method: "POST",
    path: "/api/trpc/kyc.submit",
    description: "Submit KYC documents for verification",
    auth: "protected",
    category: "KYC",
  },
  {
    method: "POST",
    path: "/api/trpc/kyc.review",
    description: "Review KYC submission",
    auth: "admin",
    category: "KYC",
  },
  {
    method: "POST",
    path: "/api/trpc/kyc.approve",
    description: "Approve KYC submission",
    auth: "admin",
    category: "KYC",
  },
  {
    method: "POST",
    path: "/api/trpc/kyc.reject",
    description: "Reject KYC submission",
    auth: "admin",
    category: "KYC",
  },
  // Settlement
  {
    method: "GET",
    path: "/api/trpc/settlement.batches",
    description: "List settlement batches",
    auth: "protected",
    category: "Settlement",
  },
  {
    method: "POST",
    path: "/api/trpc/settlement.process",
    description: "Process a settlement batch",
    auth: "admin",
    category: "Settlement",
  },
  {
    method: "POST",
    path: "/api/trpc/settlement.reconcile",
    description: "Reconcile settlement with bank",
    auth: "admin",
    category: "Settlement",
  },
  // Reports
  {
    method: "GET",
    path: "/api/trpc/reports.weekly",
    description: "Get weekly report data",
    auth: "protected",
    category: "Reports",
  },
  {
    method: "GET",
    path: "/api/trpc/reports.comparison",
    description: "Compare two weekly reports",
    auth: "protected",
    category: "Reports",
  },
  // Float
  {
    method: "GET",
    path: "/api/trpc/float.balance",
    description: "Get agent premium reserve",
    auth: "protected",
    category: "Float Management",
  },
  {
    method: "POST",
    path: "/api/trpc/float.requestTopUp",
    description: "Request float top-up",
    auth: "protected",
    category: "Float Management",
  },
  // Stripe
  {
    method: "POST",
    path: "/api/trpc/stripe.createCheckout",
    description: "Create Stripe checkout session",
    auth: "protected",
    category: "Payments",
  },
  {
    method: "GET",
    path: "/api/trpc/stripe.history",
    description: "Get payment history",
    auth: "protected",
    category: "Payments",
  },
  {
    method: "POST",
    path: "/api/stripe/webhook",
    description: "Stripe webhook endpoint",
    auth: "public",
    category: "Payments",
  },
  // Chat
  {
    method: "POST",
    path: "/api/trpc/aiChatSupport.sendMessage",
    description: "Send message to AI chat support",
    auth: "protected",
    category: "Support",
  },
  {
    method: "GET",
    path: "/api/trpc/aiChatSupport.getHistory",
    description: "Get chat session history",
    auth: "protected",
    category: "Support",
  },
];

const methodColors: Record<string, string> = {
  GET: "bg-emerald-500/20 text-emerald-400",
  POST: "bg-blue-500/20 text-blue-400",
  PUT: "bg-amber-500/20 text-amber-400",
  DELETE: "bg-red-500/20 text-red-400",
};

const authIcons: Record<
  string,
  { icon: typeof Globe; label: string; color: string }
> = {
  public: { icon: Globe, label: "Public", color: "text-emerald-400" },
  protected: { icon: Lock, label: "Auth Required", color: "text-amber-400" },
  admin: { icon: Lock, label: "Admin Only", color: "text-red-400" },
};

export default function ApiDocs() {
  const [search, setSearch] = useState("");
  const [expandedEndpoint, setExpandedEndpoint] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = new Map<string, Endpoint[]>();
    endpoints
      .filter(
        e =>
          e.path.toLowerCase().includes(search.toLowerCase()) ||
          e.description.toLowerCase().includes(search.toLowerCase()) ||
          e.category.toLowerCase().includes(search.toLowerCase())
      )
      .forEach((e: any) => {
        if (!cats.has(e.category)) cats.set(e.category, []);
        cats.get(e.category)!.push(e);
      });
    return cats;
  }, [search]);

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Code2 className="h-6 w-6 text-primary" />
              API Documentation
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {endpoints.length} endpoints across{" "}
              {new Set(endpoints.map((e: any) => e.category)).size} categories
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            v1.0
          </Badge>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search endpoints..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="space-y-6">
          {Array.from(categories.entries()).map(([category, eps]) => (
            <div key={category} className="space-y-2">
              <h2 className="text-lg font-semibold text-foreground border-b border-border pb-2">
                {category}
                <span className="text-xs text-muted-foreground ml-2">
                  ({eps.length})
                </span>
              </h2>
              <div className="space-y-1">
                {eps.map((ep: any) => {
                  const isExpanded = expandedEndpoint === ep.path;
                  const AuthIcon = authIcons[ep.auth];
                  return (
                    <div
                      key={ep.path}
                      className="border border-border rounded-md overflow-hidden"
                    >
                      <button
                        onClick={() =>
                          setExpandedEndpoint(isExpanded ? null : ep.path)
                        }
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors text-left"
                      >
                        <Badge
                          className={`${methodColors[ep.method]} font-mono text-xs px-2 py-0.5 min-w-[52px] text-center`}
                        >
                          {ep.method}
                        </Badge>
                        <code className="text-sm font-mono text-foreground flex-1 truncate">
                          {ep.path}
                        </code>
                        <AuthIcon.icon
                          className={`h-3.5 w-3.5 ${AuthIcon.color}`}
                        />
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t border-border bg-card/50 space-y-3">
                          <p className="text-sm text-muted-foreground">
                            {ep.description}
                          </p>
                          <div className="flex items-center gap-4 text-xs">
                            <span
                              className={`flex items-center gap-1 ${AuthIcon.color}`}
                            >
                              <AuthIcon.icon className="h-3 w-3" />
                              {AuthIcon.label}
                            </span>
                            <button
                              onClick={() => handleCopy(ep.path)}
                              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                            >
                              {copiedPath === ep.path ? (
                                <>
                                  <Check className="h-3 w-3" /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" /> Copy path
                                </>
                              )}
                            </button>
                          </div>
                          {ep.params && ep.params.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-muted-foreground mb-2">
                                Parameters
                              </h4>
                              <div className="space-y-1">
                                {ep.params.map((p: any) => (
                                  <div
                                    key={p.name}
                                    className="flex items-center gap-2 text-xs"
                                  >
                                    <code className="font-mono text-primary">
                                      {p.name}
                                    </code>
                                    <Badge
                                      variant="outline"
                                      className="text-[10px] px-1"
                                    >
                                      {p.type}
                                    </Badge>
                                    {p.required && (
                                      <Badge
                                        variant="destructive"
                                        className="text-[10px] px-1"
                                      >
                                        required
                                      </Badge>
                                    )}
                                    <span className="text-muted-foreground">
                                      {p.description}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {categories.size === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Code2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No endpoints match your search.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
