import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  MessageCircle,
  Send,
  Search,
  Shield,
  BookOpen,
  Loader2,
  CheckCircle,
  Clock,
  Bot,
  User,
} from "lucide-react";

export default function ComplianceChatbotPage() {
  const [tab, setTab] = useState("chat");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [kbQuery, setKbQuery] = useState("");
  const [checkType, setCheckType] = useState<
    "kyc" | "aml" | "transaction_limit" | "agent_onboarding" | "reporting"
  >("kyc");
  const chatEndRef = useRef<HTMLDivElement>(null);

  // B13 (wave-2c): wired to the REAL complianceChatbot procedures — real
  // Ollama chat with conversation persistence (chat_sessions/chat_messages).
  // When Ollama is unreachable the backend fails loud
  // ('ollama_unavailable …') and the page shows that honest state; no canned
  // compliance answer is ever rendered.
  const utils = trpc.useUtils();
  const botStatus = trpc.complianceChatbot.status.useQuery(undefined, {
    retry: false,
  });
  const startSession = trpc.complianceChatbot.startSession.useMutation({
    onSuccess: data => {
      setSessionId(data.sessionId);
      setTab("chat");
      utils.complianceChatbot.listSessions.invalidate();
    },
    onError: err => toast.error(`Could not start session: ${err.message}`),
  });
  const sendMsg = trpc.complianceChatbot.sendMessage.useMutation({
    onSuccess: () => {
      utils.complianceChatbot.getHistory.invalidate();
      utils.complianceChatbot.listSessions.invalidate();
    },
    onError: err => toast.error(err.message),
  });
  const history = trpc.complianceChatbot.getHistory.useQuery(
    { sessionId: sessionId ?? "" },
    { enabled: !!sessionId, retry: false }
  );
  const sessions = trpc.complianceChatbot.listSessions.useQuery(undefined, {
    retry: false,
  });
  const kbSearch = trpc.complianceChatbot.searchKnowledgeBase.useQuery(
    { query: kbQuery || " " },
    { enabled: false, retry: false }
  );
  const complianceCheck = trpc.complianceChatbot.quickComplianceCheck.useMutation({
    onError: err => toast.error(err.message),
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history.data?.messages]);

  const handleSend = () => {
    if (!message.trim() || !sessionId) return;
    sendMsg.mutate({ sessionId, message: message.trim() });
    setMessage("");
  };

  const handleNewSession = () => {
    startSession.mutate();
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MessageCircle className="h-7 w-7 text-purple-500" /> Compliance
              Chatbot
            </h1>
            <p className="text-muted-foreground mt-1">
              Natural language queries for compliance, fraud patterns, and
              regulations
            </p>
          </div>
          <Button onClick={handleNewSession} disabled={startSession.isPending}>
            {startSession.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <MessageCircle className="h-4 w-4 mr-2" />
            )}
            New Chat
          </Button>
        </div>

        {botStatus.data && !botStatus.data.configured && (
          <Card>
            <CardContent className="py-3 text-sm text-muted-foreground">
              Ollama is not configured on this deployment (OLLAMA_URL unset).
              Chat sessions and history persist, but answers, classification,
              and checks will report 'ollama_unavailable' until a real Ollama
              endpoint is configured — no canned answers are shown.
            </CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="kb">Knowledge Base</TabsTrigger>
            <TabsTrigger value="checks">Quick Checks</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
          </TabsList>

          <TabsContent value="chat" className="space-y-4">
            {!sessionId ? (
              <Card>
                <CardContent className="pt-8 pb-8 text-center">
                  <Bot className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">
                    Start a Compliance Chat
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Ask about CBN regulations, fraud patterns, KYC requirements,
                    AML compliance, agent onboarding, and more.
                  </p>
                  <Button
                    onClick={handleNewSession}
                    disabled={startSession.isPending}
                  >
                    {startSession.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : null}
                    Start New Chat
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card
                className="flex flex-col"
                style={{ height: "calc(100vh - 280px)", minHeight: "400px" }}
              >
                <CardContent className="flex-1 overflow-y-auto pt-4 space-y-4">
                  {history.data?.messages?.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      {msg.role === "assistant" && (
                        <Bot className="h-8 w-8 p-1.5 rounded-full bg-primary/10 text-primary shrink-0 mt-1" />
                      )}
                      <div
                        className={`max-w-[75%] rounded-lg p-3 ${msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                      >
                        <p className="text-sm whitespace-pre-wrap">
                          {msg.content}
                        </p>
                        {msg.role === "assistant" && msg.model && (
                          <p className="text-xs text-muted-foreground mt-1">
                            model: {msg.model}
                          </p>
                        )}
                      </div>
                      {msg.role === "user" && (
                        <User className="h-8 w-8 p-1.5 rounded-full bg-primary text-primary-foreground shrink-0 mt-1" />
                      )}
                    </div>
                  ))}
                  {sendMsg.isPending && (
                    <div className="flex gap-3">
                      <Bot className="h-8 w-8 p-1.5 rounded-full bg-primary/10 text-primary shrink-0" />
                      <div className="bg-muted rounded-lg p-3">
                        <Loader2 className="h-4 w-4 animate-spin" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </CardContent>
                <div className="p-4 border-t">
                  <div className="flex gap-2">
                    <input
                      className="flex-1 p-2 border rounded bg-background text-sm"
                      placeholder="Ask about compliance, fraud patterns, regulations..."
                      value={message}
                      onChange={e => setMessage(e.target.value)}
                      onKeyDown={e =>
                        e.key === "Enter" && !e.shiftKey && handleSend()
                      }
                      disabled={sendMsg.isPending}
                    />
                    <Button
                      onClick={handleSend}
                      disabled={sendMsg.isPending || !message.trim()}
                    >
                      {sendMsg.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {[
                      "What are CBN agent banking limits?",
                      "How does fraud detection work?",
                      "KYC tier requirements",
                      "AML compliance checklist",
                    ].map(q => (
                      <Button
                        key={q}
                        variant="outline"
                        size="sm"
                        className="text-xs"
                        onClick={() => {
                          setMessage(q);
                        }}
                      >
                        {q}
                      </Button>
                    ))}
                  </div>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="kb" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Search className="h-4 w-4" /> Knowledge Base Search
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4">
                  <input
                    className="flex-1 p-2 border rounded bg-background text-sm"
                    placeholder="Search compliance knowledge base..."
                    value={kbQuery}
                    onChange={e => setKbQuery(e.target.value)}
                  />
                </div>
                {/* Honest state: no knowledge-base store is delivered; the
                    backend fails loud rather than searching an unrelated
                    table. */}
                <div className="text-sm text-muted-foreground py-6 text-center">
                  <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  {kbSearch.isError
                    ? kbSearch.error.message
                    : "A compliance knowledge-base store is not delivered on this deployment. Use the Chat tab (real Ollama answers) instead."}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="checks" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="h-4 w-4" /> Quick Compliance Check
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2 mb-4 flex-wrap">
                  {(
                    [
                      "kyc",
                      "aml",
                      "transaction_limit",
                      "agent_onboarding",
                      "reporting",
                    ] as const
                  ).map(t => (
                    <Button
                      key={t}
                      variant={checkType === t ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCheckType(t)}
                    >
                      {t
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, c => c.toUpperCase())}
                    </Button>
                  ))}
                </div>
                <Button
                  size="sm"
                  onClick={() => complianceCheck.mutate({ checkType })}
                  disabled={complianceCheck.isPending}
                >
                  {complianceCheck.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Shield className="h-4 w-4 mr-2" />
                  )}
                  Run Check (Ollama)
                </Button>
                {complianceCheck.data && (
                  <Card>
                    <CardContent className="pt-4">
                      <div className="flex items-center gap-3 mb-3">
                        {complianceCheck.data.status === "compliant" ? (
                          <CheckCircle className="h-6 w-6 text-green-500" />
                        ) : (
                          <Clock className="h-6 w-6 text-yellow-500" />
                        )}
                        <div>
                          <Badge
                            variant={
                              complianceCheck.data.status === "compliant"
                                ? "default"
                                : "secondary"
                            }
                          >
                            {complianceCheck.data.status
                              ?.replace(/_/g, " ")
                              .toUpperCase() ?? "—"}
                          </Badge>
                          <span className="ml-2 text-xs text-muted-foreground">
                            model: {complianceCheck.data.model}
                          </span>
                        </div>
                      </div>
                      <p className="text-sm mb-3">
                        {complianceCheck.data.details}
                      </p>
                      <div>
                        <p className="text-xs font-medium mb-2">
                          Requirements:
                        </p>
                        <ul className="space-y-1">
                          {complianceCheck.data.requirements?.map((r, i) => (
                            <li
                              key={i}
                              className="text-xs text-muted-foreground flex items-center gap-2"
                            >
                              <CheckCircle className="h-3 w-3 text-green-500" />{" "}
                              {r.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sessions" className="space-y-4">
            {sessions.data?.sessions?.map(s => (
              <Card
                key={s.id}
                className="cursor-pointer hover:border-primary/50"
                onClick={() => {
                  setSessionId(s.id);
                  setTab("chat");
                }}
              >
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{s.id}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.preview || "New session"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{s.messageCount} msgs</Badge>
                    <span className="text-xs text-muted-foreground">
                      {s.lastActivity ? new Date(s.lastActivity).toLocaleString() : "—"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(!sessions.data || (sessions.data as { total?: number }).total === 0) && (
              <p className="text-center text-muted-foreground py-8">
                No chat sessions yet. Start a new chat above.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
