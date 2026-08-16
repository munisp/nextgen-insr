import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { NotificationProvider } from "@/contexts/NotificationContext";
import "./index.css";

// ── PWA Update Detection ────────────────────────────────────────────────────
// Import the auto-generated hook from vite-plugin-pwa
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * PWAUpdateBanner — Displays a banner when a new service worker is available
 * and the app needs to be refreshed to get the latest version.
 */
function PWAUpdateBanner() {
  const { needRefresh, updateServiceWorker } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="fixed top-4 left-4 right-4 md:left-auto md:right-4 z-[10000]">
      <div className="bg-primary text-primary-foreground rounded-lg shadow-lg p-4 flex items-center gap-3 max-w-md mx-auto md:mx-0">
        <div className="flex-shrink-0 w-8 h-8 bg-primary-foreground/20 rounded-full flex items-center justify-center">
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </div>
        <p className="text-sm flex-1">
          New version available. Refresh to get the latest updates.
        </p>
        <button
          onClick={() => updateServiceWorker()}
          className="flex-shrink-0 bg-primary-foreground text-primary px-3 py-1.5 rounded text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Update Now
        </button>
        <button
          onClick={() =>
            (document.querySelector(
              "#pwa-update-banner"
            ) as HTMLElement)?.remove()
          }
          className="flex-shrink-0 text-primary-foreground/80 hover:text-primary-foreground"
          aria-label="Dismiss update banner"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Hook to handle PWA updates in background
useRegisterSW({
  onRegisteredSW(_swUrl, registration) {
    if (process.env.NODE_ENV === "development") {
      console.info("[PWA] Service Worker registered:", registration?.active?.scriptURL);
    }
  },
  onRegisterError(error) {
    console.error("[PWA] Service Worker registration failed:", error);
  },
});

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <NotificationProvider>
        <PWAUpdateBanner />
        <App />
      </NotificationProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
