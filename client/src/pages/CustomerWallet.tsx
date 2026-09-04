/**
 * Customer Wallet Management — View balance, transaction history, limits
 * Wired to customer.account.balance, customer.transactions.list, customer.transactions.stats
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Shield,
  TrendingUp,
} from "lucide-react";

export default function CustomerWallet() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 20;

  const balance = trpc.customer.account.balance.useQuery(undefined, {
    retry: false,
  });
  const profile = trpc.customer.account.me.useQuery(undefined, {
    retry: false,
  });
  const txns = trpc.customer.transactions.list.useQuery(
    { page, limit },
    { retry: false }
  );
  const stats = trpc.customer.transactions.stats.useQuery(
    { period: "month" },
    { retry: false }
  );

  const formatCurrency = (n: string | number) =>
    `₦${Number(n).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
  const totalPages = Math.ceil((txns.data?.total ?? 0) / limit);

  const filteredTxns = (txns.data?.items ?? []).filter((t: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.type?.toLowerCase().includes(q) ||
      t.reference?.toLowerCase().includes(q) ||
      t.status?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="w-6 h-6 text-blue-400" /> Customer Wallet
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Manage your wallet balance, view transactions, and track spending
        </p>
      </div>

      {/* Balance & Limits */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-900/40 to-blue-800/20 border-blue-700/40 col-span-1 sm:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-blue-400 text-xs font-medium mb-2">
              <CreditCard className="w-4 h-4" /> Wallet Balance
            </div>
            <div className="text-4xl font-bold text-white">
              {balance.data ? formatCurrency(balance.data.walletBalance) : "—"}
            </div>
            <div className="text-xs text-slate-500 mt-2">
              {profile.data?.firstName} {profile.data?.lastName} •{" "}
              {profile.data?.phone}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-900/40 to-green-800/20 border-green-700/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-green-400 text-xs font-medium">
              <Shield className="w-4 h-4" /> Daily Limit
            </div>
            <div className="text-xl font-bold text-white mt-1">
              {balance.data ? formatCurrency(balance.data.dailyLimit) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-900/40 to-purple-800/20 border-purple-700/40">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-purple-400 text-xs font-medium">
              <TrendingUp className="w-4 h-4" /> Monthly Limit
            </div>
            <div className="text-xl font-bold text-white mt-1">
              {balance.data ? formatCurrency(balance.data.monthlyLimit) : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stats */}
      {stats.data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="bg-slate-900/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-slate-500">Total Transactions</div>
              <div className="text-lg font-bold text-white">
                {stats.data.txCount}
              </div>
            </CardContent>
          </Card>
          <Card className="bg-slate-900/50 border-slate-700">
            <CardContent className="p-3 text-center">
              <div className="text-xs text-slate-500">Total Volume</div>
              <div className="text-lg font-bold text-white">
                {formatCurrency(stats.data.volume)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Transaction Search */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white">
            Transaction History
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by type, reference, or status..."
              className="pl-9 bg-slate-800 border-slate-700 text-white"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-500">
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Reference</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {txns.isLoading ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-500">
                      Loading...
                    </td>
                  </tr>
                ) : filteredTxns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-500">
                      No transactions found
                    </td>
                  </tr>
                ) : (
                  filteredTxns.map((t: any) => (
                    <tr key={t.id} className="hover:bg-slate-800/40">
                      <td className="px-3 py-2 text-slate-400">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          {t.type?.includes("deposit") ||
                          t.type?.includes("in") ? (
                            <ArrowDownLeft className="w-3 h-3 text-green-400" />
                          ) : (
                            <ArrowUpRight className="w-3 h-3 text-red-400" />
                          )}
                          <span className="text-white">{t.type}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500 text-[10px]">
                        {t.reference}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-white">
                        {formatCurrency(t.amount)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${t.status === "success" ? "border-green-600 text-green-400" : t.status === "pending" ? "border-yellow-600 text-yellow-400" : "border-red-600 text-red-400"}`}
                        >
                          {t.status}
                        </Badge>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                  className="border-slate-700 text-slate-300"
                >
                  <ChevronLeft className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="border-slate-700 text-slate-300"
                >
                  <ChevronRight className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
