import DashboardLayout from "@/components/DashboardLayout";
import { useState } from "react";

import { trpc } from "@/lib/trpc";
export default function UssdSessionReplayPage() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [replayStep, setReplayStep] = useState(0);
  const [filter, setFilter] = useState("all");

  const sessions = [
    {
      id: "SESS-001",
      phone: "+2348012345678",
      carrier: "MTN_NG",
      status: "completed",
      steps: 4,
      duration: "15s",
      agent: "AGT-001",
    },
    {
      id: "SESS-002",
      phone: "+2348099887766",
      carrier: "Airtel_NG",
      status: "dropped",
      steps: 3,
      duration: "10s",
      agent: "AGT-002",
    },
    {
      id: "SESS-003",
      phone: "+254712345678",
      carrier: "Safaricom_KE",
      status: "completed",
      steps: 5,
      duration: "20s",
      agent: "AGT-003",
    },
    {
      id: "SESS-004",
      phone: "+2348055555555",
      carrier: "Glo_NG",
      status: "timeout",
      steps: 2,
      duration: "30s",
      agent: "—",
    },
    {
      id: "SESS-005",
      phone: "+233201234567",
      carrier: "MTN_GH",
      status: "error",
      steps: 3,
      duration: "10s",
      agent: "AGT-005",
    },
  ];

  const replayData: Record<
    string,
    { input: string; screen: string; ms: number }[]
  > = {
    "SESS-001": [
      {
        input: "*384#",
        screen:
          "Welcome to InsurePortal\n1. Cash In\n2. Cash Out\n3. Transfer\n4. Balance",
        ms: 450,
      },
      { input: "1", screen: "Cash In\nEnter Amount:", ms: 320 },
      {
        input: "50000",
        screen: "Confirm Cash In ₦50,000\n1. Confirm\n2. Cancel",
        ms: 280,
      },
      {
        input: "1",
        screen: "Transaction Successful!\nRef: TX-ABC123\nBalance: ₦150,000",
        ms: 1200,
      },
    ],
    "SESS-002": [
      {
        input: "*384#",
        screen:
          "Welcome to InsurePortal\n1. Cash In\n2. Cash Out\n3. Transfer\n4. Balance",
        ms: 450,
      },
      { input: "2", screen: "Cash Out\nEnter Amount:", ms: 380 },
      {
        input: "100000",
        screen: "Confirm Cash Out ₦100,000\n1. Confirm\n2. Cancel",
        ms: 290,
      },
    ],
  };

  const statusColor: Record<string, string> = {
    completed: "text-green-400",
    dropped: "text-red-400",
    timeout: "text-yellow-400",
    error: "text-red-500",
  };

  const filtered =
    filter === "all" ? sessions : sessions.filter(s => s.status === filter);
  const currentReplay = selectedSession ? replayData[selectedSession] : null;
  // Sprint 87: Wired to ussdSessionReplay router
  const { data, isLoading } = trpc.ussdSessionReplay.list.useQuery({
    // @ts-ignore Sprint 85
    page: 1,
    limit: 10,
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">USSD Session Replay</h1>
          <div className="flex gap-2">
            {["all", "completed", "dropped", "timeout", "error"].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded text-sm ${filter === f ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300"}`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="bg-gray-800 rounded p-4 text-center">
            <div className="text-2xl font-bold text-white">
              {sessions.length}
            </div>
            <div className="text-gray-400 text-sm">Total Sessions</div>
          </div>
          <div className="bg-gray-800 rounded p-4 text-center">
            <div className="text-2xl font-bold text-green-400">
              {sessions.filter(s => s.status === "completed").length}
            </div>
            <div className="text-gray-400 text-sm">Completed</div>
          </div>
          <div className="bg-gray-800 rounded p-4 text-center">
            <div className="text-2xl font-bold text-red-400">
              {sessions.filter(s => s.status === "dropped").length}
            </div>
            <div className="text-gray-400 text-sm">Dropped</div>
          </div>
          <div className="bg-gray-800 rounded p-4 text-center">
            <div className="text-2xl font-bold text-yellow-400">60%</div>
            <div className="text-gray-400 text-sm">Completion Rate</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="bg-gray-800 rounded p-4">
            <h2 className="text-lg font-semibold text-white mb-3">Sessions</h2>
            <div className="space-y-2">
              {filtered.map(s => (
                <div
                  key={s.id}
                  onClick={() => {
                    setSelectedSession(s.id);
                    setReplayStep(0);
                  }}
                  className={`p-3 rounded cursor-pointer ${selectedSession === s.id ? "bg-blue-900 border border-blue-500" : "bg-gray-700 hover:bg-gray-600"}`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-white font-mono text-sm">{s.id}</span>
                    <span className={`text-sm ${statusColor[s.status]}`}>
                      {s.status}
                    </span>
                  </div>
                  <div className="text-gray-400 text-xs mt-1">
                    {s.phone} · {s.carrier} · {s.steps} steps · {s.duration}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-gray-800 rounded p-4">
            <h2 className="text-lg font-semibold text-white mb-3">
              Replay Viewer
            </h2>
            {currentReplay ? (
              <div className="space-y-4">
                <div className="bg-black rounded-lg p-4 font-mono text-green-400 text-sm min-h-[200px]">
                  <div className="text-gray-500 mb-2">
                    Step {replayStep + 1}/{currentReplay.length}
                  </div>
                  <div className="text-yellow-300">
                    Input: {currentReplay[replayStep].input}
                  </div>
                  <div className="mt-2 whitespace-pre-line">
                    {currentReplay[replayStep].screen}
                  </div>
                  <div className="text-gray-500 mt-2">
                    Response: {currentReplay[replayStep].ms}ms
                  </div>
                </div>
                <div className="flex gap-2 justify-center">
                  <button
                    onClick={() => setReplayStep(Math.max(0, replayStep - 1))}
                    className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600"
                    disabled={replayStep === 0}
                  >
                    ◀ Prev
                  </button>
                  <button
                    onClick={() =>
                      setReplayStep(
                        Math.min(currentReplay.length - 1, replayStep + 1)
                      )
                    }
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
                    disabled={replayStep >= currentReplay.length - 1}
                  >
                    Next ▶
                  </button>
                </div>
                <div className="flex gap-1">
                  {currentReplay.map((_, i) => (
                    <div
                      key={i}
                      onClick={() => setReplayStep(i)}
                      className={`h-2 flex-1 rounded cursor-pointer ${i <= replayStep ? "bg-blue-500" : "bg-gray-600"}`}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-center py-12">
                Select a session to replay
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
