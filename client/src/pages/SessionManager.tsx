import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function SessionManager() {
  const sessionsQ = trpc.sessionMgmt.list.useQuery({});
  const forceLogout = trpc.sessionMgmt.forceLogout.useMutation({
    onSuccess: () => {
      sessionsQ.refetch();
      toast.success("Session terminated");
    },
  });
  const logoutAll = trpc.sessionMgmt.logoutAll.useMutation({
    onSuccess: d => {
      sessionsQ.refetch();
      toast.success(`${d.loggedOut} sessions terminated`);
    },
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Session Management</h1>
            <p className="text-gray-400">
              View active sessions and manage device access
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                logoutAll.mutate({ userId: "user_001", exceptCurrent: true })
              }
            >
              Logout All Others
            </Button>
            <a href="/" className="text-sm text-gray-400 hover:text-white">
              ← Back
            </a>
          </div>
        </div>

        <div className="text-sm text-gray-400">
          {sessionsQ.data?.total ?? 0} active sessions
        </div>

        <div className="space-y-3">
          {sessionsQ.data?.sessions.map(session => (
            <Card
              key={session.id}
              className={`bg-gray-900 ${session.isCurrentSession ? "border-green-600" : "border-gray-800"}`}
            >
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center text-lg">
                      {session.device.includes("iPhone") ||
                      session.device.includes("Galaxy")
                        ? "📱"
                        : "💻"}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">
                          {session.device}
                        </span>
                        {session.isCurrentSession && (
                          <Badge className="bg-green-600 text-white text-xs">
                            Current
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">
                        {session.browser} · {session.ip} · {session.location}
                      </div>
                      <div className="text-xs text-gray-500">
                        Last active:{" "}
                        {new Date(session.lastActiveAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  {!session.isCurrentSession && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-400 border-red-800 hover:bg-red-950"
                      onClick={() =>
                        forceLogout.mutate({ sessionId: session.id })
                      }
                    >
                      Terminate
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
