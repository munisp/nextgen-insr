import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  Search,
  ArrowRight,
  Command,
  BarChart3,
  Users,
  CreditCard,
  Shield,
  Bell,
  Settings,
  FileCheck,
  Globe,
  Wallet,
  Layers,
  Webhook,
  Activity,
  Smartphone,
  Mail,
} from "lucide-react";

interface SearchItem {
  id: string;
  label: string;
  description: string;
  path: string;
  icon: React.ReactNode;
  category: string;
}

const SEARCH_ITEMS: SearchItem[] = [
  {
    id: "home",
    label: "POS Terminal",
    description: "Main insurance portal interface",
    path: "/",
    icon: <CreditCard className="w-4 h-4" />,
    category: "Navigation",
  },
  {
    id: "admin",
    label: "Admin Panel",
    description: "System administration",
    path: "/admin",
    icon: <Shield className="w-4 h-4" />,
    category: "Navigation",
  },
  {
    id: "multi-currency",
    label: "Multi-Currency",
    description: "Exchange rates and converter",
    path: "/multi-currency",
    icon: <Globe className="w-4 h-4" />,
    category: "Finance",
  },
  {
    id: "rate-alerts",
    label: "Rate Alerts",
    description: "Exchange rate subscriptions",
    path: "/rate-alerts",
    icon: <BarChart3 className="w-4 h-4" />,
    category: "Finance",
  },
  {
    id: "notification-inbox",
    label: "Notification Inbox",
    description: "All notifications timeline",
    path: "/notification-inbox",
    icon: <Bell className="w-4 h-4" />,
    category: "Notifications",
  },
  {
    id: "notification-prefs",
    label: "Notification Preferences",
    description: "Channel delivery matrix",
    path: "/notification-preference-matrix",
    icon: <Settings className="w-4 h-4" />,
    category: "Notifications",
  },
  {
    id: "webhook-config",
    label: "Webhook Config",
    description: "Manage webhook integrations",
    path: "/webhook-config",
    icon: <Webhook className="w-4 h-4" />,
    category: "System",
  },
  {
    id: "batch-ops",
    label: "Batch Operations",
    description: "Bulk actions on entities",
    path: "/batch-operations",
    icon: <Layers className="w-4 h-4" />,
    category: "Operations",
  },
  {
    id: "agent-perf",
    label: "Agent Performance",
    description: "Leaderboard and KPIs",
    path: "/agent-performance",
    icon: <Users className="w-4 h-4" />,
    category: "Agents",
  },
  {
    id: "customer-wallet",
    label: "Customer Wallet",
    description: "Wallet management",
    path: "/customer-wallet",
    icon: <Wallet className="w-4 h-4" />,
    category: "Finance",
  },
  {
    id: "kyc-workflow",
    label: "KYC Workflow",
    description: "Identity verification",
    path: "/kyc-workflow",
    icon: <FileCheck className="w-4 h-4" />,
    category: "Compliance",
  },
  {
    id: "commission-config",
    label: "Commission Config",
    description: "Commission structures",
    path: "/commission-config",
    icon: <Activity className="w-4 h-4" />,
    category: "Finance",
  },
  {
    id: "audit-export",
    label: "Audit Export",
    description: "Export audit logs",
    path: "/audit-export",
    icon: <FileCheck className="w-4 h-4" />,
    category: "Compliance",
  },
  {
    id: "sms-notif",
    label: "SMS Notifications",
    description: "SMS delivery settings",
    path: "/notification-preferences",
    icon: <Smartphone className="w-4 h-4" />,
    category: "Notifications",
  },
  {
    id: "email-notif",
    label: "Email Notifications",
    description: "Email delivery settings",
    path: "/notification-preferences",
    icon: <Mail className="w-4 h-4" />,
    category: "Notifications",
  },
  {
    id: "health",
    label: "System Health",
    description: "Service health dashboard",
    path: "/system-health",
    icon: <Activity className="w-4 h-4" />,
    category: "System",
  },
];

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? SEARCH_ITEMS.filter(
        item =>
          item.label.toLowerCase().includes(query.toLowerCase()) ||
          item.description.toLowerCase().includes(query.toLowerCase()) ||
          item.category.toLowerCase().includes(query.toLowerCase())
      )
    : SEARCH_ITEMS;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setOpen(prev => !prev);
      setQuery("");
      setSelectedIndex(0);
    }
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  function select(item: SearchItem) {
    navigate(item.path);
    setOpen(false);
    setQuery("");
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    }
    if (e.key === "Enter" && filtered[selectedIndex]) {
      select(filtered[selectedIndex]);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-background border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search pages, features, settings..."
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <kbd className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
            ESC
          </kbd>
        </div>
        <div className="max-h-[300px] overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No results found
            </p>
          ) : (
            filtered.map((item, i) => (
              <button
                key={item.id}
                onClick={() => select(item)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted/50"}`}
              >
                <div className="p-1.5 rounded bg-muted shrink-0">
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">
                    {item.label}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {item.description}
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {item.category}
                </Badge>
                <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
              </button>
            ))
          )}
        </div>
        <div className="border-t px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="bg-muted px-1 rounded">↑↓</kbd> Navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-muted px-1 rounded">↵</kbd> Select
          </span>
          <span className="flex items-center gap-1">
            <Command className="w-3 h-3" />
            <kbd className="bg-muted px-1 rounded">K</kbd> Toggle
          </span>
        </div>
      </div>
    </div>
  );
}

function Badge({
  variant,
  className,
  children,
}: {
  variant: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${className}`}
    >
      {children}
    </span>
  );
}
