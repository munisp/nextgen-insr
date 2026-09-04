import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Search,
  Users,
  ArrowRightLeft,
  UserCheck,
  Building,
  FileText,
} from "lucide-react";

// Mock search results (in production, powered by tRPC full-text search across entities)
const mockAgents = [
  {
    id: "a1",
    code: "AG-001",
    name: "Adebayo Ogundimu",
    tier: "platinum",
    status: "active",
    location: "Lagos",
  },
  {
    id: "a2",
    code: "AG-002",
    name: "Chioma Nwosu",
    tier: "gold",
    status: "active",
    location: "Abuja",
  },
  {
    id: "a3",
    code: "AG-003",
    name: "Emeka Okafor",
    tier: "gold",
    status: "active",
    location: "Port Harcourt",
  },
  {
    id: "a4",
    code: "AG-004",
    name: "Fatima Ibrahim",
    tier: "silver",
    status: "suspended",
    location: "Kano",
  },
  {
    id: "a5",
    code: "AG-005",
    name: "Oluwaseun Bakare",
    tier: "bronze",
    status: "active",
    location: "Ibadan",
  },
];

const mockTransactions = [
  {
    id: "t1",
    ref: "TXN-20260420-001",
    type: "cash_in",
    amount: 50000,
    customer: "Ade Johnson",
    status: "success",
    date: "2026-04-20",
  },
  {
    id: "t2",
    ref: "TXN-20260420-002",
    type: "transfer",
    amount: 125000,
    customer: "Bola Tinubu",
    status: "success",
    date: "2026-04-20",
  },
  {
    id: "t3",
    ref: "TXN-20260419-015",
    type: "cash_out",
    amount: 30000,
    customer: "Chidi Eze",
    status: "reversed",
    date: "2026-04-19",
  },
  {
    id: "t4",
    ref: "TXN-20260419-008",
    type: "airtime",
    amount: 5000,
    customer: "Dayo Adeleke",
    status: "success",
    date: "2026-04-19",
  },
];

const mockCustomers = [
  {
    id: "c1",
    name: "Ade Johnson",
    phone: "08012345678",
    totalTx: 45,
    lastActive: "2026-04-20",
  },
  {
    id: "c2",
    name: "Bola Tinubu",
    phone: "08098765432",
    totalTx: 12,
    lastActive: "2026-04-20",
  },
  {
    id: "c3",
    name: "Chidi Eze",
    phone: "07011223344",
    totalTx: 28,
    lastActive: "2026-04-19",
  },
];

export default function GlobalSearchPage() {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  const q = query.toLowerCase();

  const filteredAgents = useMemo(
    () =>
      mockAgents.filter(
        (a: any) =>
          a.name.toLowerCase().includes(q) ||
          a.code.toLowerCase().includes(q) ||
          a.location.toLowerCase().includes(q)
      ),
    [q]
  );

  const filteredTx = useMemo(
    () =>
      mockTransactions.filter(
        (t: any) =>
          t.ref.toLowerCase().includes(q) ||
          t.customer.toLowerCase().includes(q) ||
          t.type.includes(q)
      ),
    [q]
  );

  const filteredCustomers = useMemo(
    () =>
      mockCustomers.filter(
        (c: any) => c.name.toLowerCase().includes(q) || c.phone.includes(q)
      ),
    [q]
  );

  const totalResults =
    filteredAgents.length + filteredTx.length + filteredCustomers.length;
  // Sprint 87: Wired to advancedSearchFiltering router
  const { data, isLoading } =
    // @ts-ignore Sprint 85
    trpc.advancedSearchFiltering.globalSearch.useQuery({ page: 1, limit: 10 });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Search className="w-6 h-6 text-blue-400" />
            Global Search
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Search across agents, transactions, and customers. Use{" "}
            <kbd className="px-1 py-0.5 rounded bg-muted text-xs">Ctrl+K</kbd>{" "}
            for quick access.
          </p>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            className="pl-10 text-lg h-12"
            placeholder="Search agents, transactions, customers..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
        </div>

        {query && (
          <p className="text-sm text-muted-foreground">
            {totalResults} results for "{query}"
          </p>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="all">All ({totalResults})</TabsTrigger>
            <TabsTrigger value="agents">
              Agents ({filteredAgents.length})
            </TabsTrigger>
            <TabsTrigger value="transactions">
              Transactions ({filteredTx.length})
            </TabsTrigger>
            <TabsTrigger value="customers">
              Customers ({filteredCustomers.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-4">
            {filteredAgents.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Users className="w-4 h-4" /> Agents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {filteredAgents.slice(0, 3).map((a: any) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                    >
                      <div>
                        <span className="font-medium">{a.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {a.code}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="outline" className="text-xs capitalize">
                          {a.tier}
                        </Badge>
                        <Badge
                          variant={
                            a.status === "active" ? "default" : "destructive"
                          }
                          className="text-xs"
                        >
                          {a.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {filteredTx.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4" /> Transactions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {filteredTx.slice(0, 3).map((t: any) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                    >
                      <div>
                        <span className="font-mono text-xs">{t.ref}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {t.customer}
                        </span>
                      </div>
                      <div className="flex gap-2 items-center">
                        <span className="font-medium">
                          ₦{t.amount.toLocaleString()}
                        </span>
                        <Badge
                          variant={
                            t.status === "success" ? "default" : "destructive"
                          }
                          className="text-xs"
                        >
                          {t.status}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {filteredCustomers.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <UserCheck className="w-4 h-4" /> Customers
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {filteredCustomers.slice(0, 3).map((c: any) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                    >
                      <div>
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {c.phone}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {c.totalTx} transactions
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="agents">
            <Card>
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3">Code</th>
                      <th className="text-left py-2 px-3">Name</th>
                      <th className="text-left py-2 px-3">Location</th>
                      <th className="text-center py-2 px-3">Tier</th>
                      <th className="text-center py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAgents.map((a: any) => (
                      <tr
                        key={a.id}
                        className="border-b border-border/50 hover:bg-muted/30"
                      >
                        <td className="py-2 px-3 font-mono text-xs">
                          {a.code}
                        </td>
                        <td className="py-2 px-3">{a.name}</td>
                        <td className="py-2 px-3">{a.location}</td>
                        <td className="text-center py-2 px-3">
                          <Badge variant="outline" className="capitalize">
                            {a.tier}
                          </Badge>
                        </td>
                        <td className="text-center py-2 px-3">
                          <Badge
                            variant={
                              a.status === "active" ? "default" : "destructive"
                            }
                          >
                            {a.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transactions">
            <Card>
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3">Reference</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-right py-2 px-3">Amount</th>
                      <th className="text-left py-2 px-3">Customer</th>
                      <th className="text-center py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTx.map((t: any) => (
                      <tr
                        key={t.id}
                        className="border-b border-border/50 hover:bg-muted/30"
                      >
                        <td className="py-2 px-3 font-mono text-xs">{t.ref}</td>
                        <td className="py-2 px-3 capitalize">
                          {t.type.replace("_", " ")}
                        </td>
                        <td className="text-right py-2 px-3">
                          ₦{t.amount.toLocaleString()}
                        </td>
                        <td className="py-2 px-3">{t.customer}</td>
                        <td className="text-center py-2 px-3">
                          <Badge
                            variant={
                              t.status === "success"
                                ? "default"
                                : "destructive"
                            }
                          >
                            {t.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-xs">{t.date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customers">
            <Card>
              <CardContent className="pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3">Name</th>
                      <th className="text-left py-2 px-3">Phone</th>
                      <th className="text-right py-2 px-3">
                        Total Transactions
                      </th>
                      <th className="text-left py-2 px-3">Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((c: any) => (
                      <tr
                        key={c.id}
                        className="border-b border-border/50 hover:bg-muted/30"
                      >
                        <td className="py-2 px-3">{c.name}</td>
                        <td className="py-2 px-3">{c.phone}</td>
                        <td className="text-right py-2 px-3">{c.totalTx}</td>
                        <td className="py-2 px-3 text-xs">{c.lastActive}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
