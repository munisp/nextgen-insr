import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, Hash, ArrowRight, RotateCcw } from "lucide-react";

export default function UssdGateway() {
  const [phone, setPhone] = useState("08012345678");
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [screen, setScreen] = useState<string>("");
  const [ended, setEnded] = useState(false);

  // @ts-ignore Sprint 85
  const menuTree = trpc.ussdGateway.menuTree.useQuery();
  // @ts-ignore Sprint 85
  const analytics = trpc.ussdGateway.analytics.useQuery();
  // @ts-ignore Sprint 85
  const sessions = trpc.ussdGateway.activeSessions.useQuery();
  // @ts-ignore Sprint 85
  const txns = trpc.ussdGateway.transactions.useQuery({ limit: 20 });
  // @ts-ignore Sprint 85
  const processInput = trpc.ussdGateway.processInput.useMutation({
    // @ts-ignore Sprint 85
    onSuccess: data => {
      setSessionId(data.sessionId);
      setScreen(data?.text);
      setEnded(data.end);
      setInput("");
    },
  });

  const handleSend = () => {
    processInput.mutate({
      agentId: "AGT001",
      phoneNumber: phone,
      input,
      sessionId: sessionId ?? undefined,
    });
  };

  const handleReset = () => {
    setSessionId(null);
    setScreen("");
    setEnded(false);
    setInput("");
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">USSD Gateway</h1>
            <p className="text-muted-foreground">
              Feature phone banking via USSD menus
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Active Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {sessions.data?.sessions?.length ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Transactions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.totalTransactions ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Active Sessions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.activeSessions ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Menu Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {menuTree.data?.menuTree
                  ? Object.keys(menuTree.data.menuTree).length
                  : 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" /> USSD Simulator
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-gray-900 text-green-400 font-mono p-4 rounded-lg min-h-[200px] whitespace-pre-wrap">
                {screen || "Dial *737# to start..."}
              </div>
              <div className="flex gap-2">
                <Input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-40"
                  disabled={!!sessionId}
                />
                <Input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={sessionId ? "Enter option..." : "Enter *737#"}
                  onKeyDown={e => e.key === "Enter" && handleSend()}
                  disabled={ended}
                />
                <Button
                  onClick={handleSend}
                  disabled={ended || processInput.isPending}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
              {ended && <Badge variant="secondary">Session ended</Badge>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Hash className="h-5 w-5" /> Recent Transactions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {txns.data?.transactions?.map((tx: any) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between p-2 border rounded"
                  >
                    <div>
                      <p className="text-sm font-medium">{tx.type}</p>
                      <p className="text-xs text-muted-foreground">
                        {tx.phone}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">
                        NGN {tx.amount?.toLocaleString()}
                      </p>
                      <Badge
                        variant={
                          tx.status === "success" ? "default" : "destructive"
                        }
                        className="text-xs"
                      >
                        {tx.status}
                      </Badge>
                    </div>
                  </div>
                ))}
                {(!txns.data?.transactions ||
                  txns.data.transactions.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No transactions yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
