import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Loader2, RefreshCw, Download, Search, Filter } from "lucide-react";
import { toast } from "sonner";

export default function AutoReconciliationEngine() {
  const {
    data: stats,
    isLoading,
    refetch,
  } = trpc.autoReconciliationEngine.getStats.useQuery();
  const [searchTerm, setSearchTerm] = useState("");

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 min-h-screen bg-gray-950 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Automated Reconciliation</h1>
            <p className="text-gray-400 text-sm mt-1">
              Bank statement matching with exception handling and
              auto-resolution
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 w-64"
              />
            </div>
            <button
              onClick={() => {
                refetch();
                toast.success("Data refreshed");
              }}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm hover:bg-gray-700 transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button className="flex items-center gap-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm hover:bg-gray-700 transition-colors">
              <Download className="w-4 h-4" /> Export
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            <span className="ml-3 text-gray-400">
              Loading dashboard data...
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Reconciliations</p>
                <p className="text-xl font-bold text-blue-400">
                  {String(stats?.totalReconciliations ?? "—")}
                </p>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Match Rate %</p>
                <p className="text-xl font-bold text-emerald-400">
                  {String(stats?.avgMatchRate ?? "—")}
                </p>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Exceptions</p>
                <p className="text-xl font-bold text-amber-400">
                  {String(stats?.totalExceptions ?? "—")}
                </p>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Pending Review</p>
                <p className="text-xl font-bold text-rose-400">
                  {String(stats?.pendingReview ?? "—")}
                </p>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Banks</p>
                <p className="text-xl font-bold text-purple-400">
                  {String(stats?.banksConnected ?? "—")}
                </p>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Auto-Resolved</p>
                <p className="text-xl font-bold text-cyan-400">
                  {String(stats?.autoResolvedToday ?? "—")}
                </p>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Manual Review</p>
                <p className="text-xl font-bold text-indigo-400">
                  {String(stats?.manualReviewNeeded ?? "—")}
                </p>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <p className="text-xs text-gray-400 mb-1">Last Run</p>
                <p className="text-xl font-bold text-orange-400">
                  {String(stats?.lastRunTime ?? "—")}
                </p>
              </div>
            </div>

            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4">Overview</h2>
              <div className="text-gray-400 text-sm">
                <p>
                  This module provides comprehensive management capabilities for
                  automated reconciliation.
                </p>
                <p className="mt-2">
                  Use the search and filter controls above to find specific
                  records. Click Refresh to update data in real-time.
                </p>
              </div>
            </div>

            <div className="bg-gray-800/30 border border-gray-700 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Recent Activity</h2>
                <button className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300">
                  <Filter className="w-4 h-4" /> Filter
                </button>
              </div>
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map(i => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-3 border-b border-gray-700/50 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500" />
                      <span className="text-sm text-gray-300">
                        Activity record #{i}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {new Date(Date.now() - i * 3600000).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
