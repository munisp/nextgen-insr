import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { Command, Keyboard } from "lucide-react";

interface Shortcut {
  keys: string;
  description: string;
  action: () => void;
  category: string;
}

export function useKeyboardShortcuts() {
  const [, navigate] = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);

  const shortcuts: Shortcut[] = [
    {
      keys: "g h",
      description: "Go to Home / Insurance Service",
      action: () => navigate("/"),
      category: "Navigation",
    },
    {
      keys: "g a",
      description: "Go to Admin Panel",
      action: () => navigate("/admin"),
      category: "Navigation",
    },
    {
      keys: "g m",
      description: "Go to Multi-Currency",
      action: () => navigate("/multi-currency"),
      category: "Navigation",
    },
    {
      keys: "g r",
      description: "Go to Rate Alerts",
      action: () => navigate("/rate-alerts"),
      category: "Navigation",
    },
    {
      keys: "g n",
      description: "Go to Notification Inbox",
      action: () => navigate("/notification-inbox"),
      category: "Navigation",
    },
    {
      keys: "g w",
      description: "Go to Webhook Config",
      action: () => navigate("/webhook-config"),
      category: "Navigation",
    },
    {
      keys: "g b",
      description: "Go to Batch Operations",
      action: () => navigate("/batch-operations"),
      category: "Navigation",
    },
    {
      keys: "g s",
      description: "Go to System Health",
      action: () => navigate("/system-health"),
      category: "Navigation",
    },
    {
      keys: "?",
      description: "Show keyboard shortcuts",
      action: () => setHelpOpen(true),
      category: "General",
    },
  ];

  const pendingKeys = { current: "" };
  const pendingTimeout = {
    current: null as ReturnType<typeof setTimeout> | null,
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toLowerCase();

      if (key === "?" && !e.shiftKey) {
        e.preventDefault();
        setHelpOpen(prev => !prev);
        return;
      }

      if (key === "escape") {
        setHelpOpen(false);
        pendingKeys.current = "";
        return;
      }

      // Build sequence
      if (pendingTimeout.current) clearTimeout(pendingTimeout.current);
      pendingKeys.current += (pendingKeys.current ? " " : "") + key;

      const match = shortcuts.find(s => s.keys === pendingKeys.current);
      if (match) {
        e.preventDefault();
        match.action();
        pendingKeys.current = "";
        return;
      }

      // Check if any shortcut starts with current sequence
      const hasPrefix = shortcuts.some(s =>
        s.keys.startsWith(pendingKeys.current)
      );
      if (!hasPrefix) {
        pendingKeys.current = "";
        return;
      }

      // Reset after 1s of no input
      pendingTimeout.current = setTimeout(() => {
        pendingKeys.current = "";
      }, 1000);
    },
    [navigate]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { shortcuts, helpOpen, setHelpOpen };
}

export default function KeyboardShortcutsHelp({
  open,
  onClose,
  shortcuts,
}: {
  open: boolean;
  onClose: () => void;
  shortcuts: { keys: string; description: string; category: string }[];
}) {
  if (!open) return null;

  const categories = Array.from(new Set(shortcuts.map(s => s.category)));

  return (
    <div
      className="fixed inset-0 z-[99] flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative bg-background border rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <Keyboard className="w-4 h-4" />
          <span className="font-medium text-sm">Keyboard Shortcuts</span>
          <kbd className="ml-auto text-[10px] bg-muted px-1.5 py-0.5 rounded font-mono">
            ESC
          </kbd>
        </div>
        <div className="max-h-[400px] overflow-y-auto py-2">
          {categories.map(cat => (
            <div key={cat}>
              <div className="px-4 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {cat}
              </div>
              {shortcuts
                .filter(s => s.category === cat)
                .map(s => (
                  <div
                    key={s.keys}
                    className="flex items-center justify-between px-4 py-1.5"
                  >
                    <span className="text-sm">{s.description}</span>
                    <div className="flex gap-1">
                      {s.keys.split(" ").map((k, i) => (
                        <kbd
                          key={i}
                          className="text-[11px] bg-muted px-1.5 py-0.5 rounded font-mono min-w-[20px] text-center"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ))}
        </div>
        <div className="border-t px-4 py-2 text-[10px] text-muted-foreground flex items-center gap-1">
          <Command className="w-3 h-3" /> Press{" "}
          <kbd className="bg-muted px-1 rounded">?</kbd> to toggle this overlay
        </div>
      </div>
    </div>
  );
}
