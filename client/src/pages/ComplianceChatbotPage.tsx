import { useState, useRef, useEffect } from "react";
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

  const startSession = trpc.complianceChatbot.startSession.useMutation({
    onSuccess: data => setSessionId(data.sessionId),
  });
  const sendMsg = trpc.complianceChatbot.sendMessage.useMutation({
    onSuccess: () => history.refetch(),
  });
  const history = trpc.complianceChatbot.getHistory.useQuery(
    { sessionId: sessionId ?? "" },
    { enabled: !!sessionId, refetchInterval: 2000 }
  );
  const sessions = trpc.complianceChatbot.listSessions.useQuery();
  const kbSearch = trpc.complianceChatbot.searchKnowledgeBase.useQuery(
    { query: kbQuery, topK: 5 },
    { enabled: kbQuery.length > 2 }
  );
  const complianceCheck = trpc.complianceChatbot.quickComplianceCheck.useQuery({
    checkType,
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
                  {history.data?.messages.map((msg, i) => (
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
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-border/50">
                            <p className="text-xs font-medium mb-1">Sources:</p>
                            {msg.sources.map((s, j) => (
                              <Badge
                                key={j}
                                variant="outline"
                                className="mr-1 mb-1 text-xs"
                              >
                                <BookOpen className="h-2 w-2 mr-1" />
                                {s.title} ({(s.relevance * 100).toFixed(0)}%)
                              </Badge>
                            ))}
                          </div>
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
                {kbSearch.data?.results.map(r => (
                  <Card key={r.id} className="mb-3">
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-medium text-sm">{r.title}</h4>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{r.category}</Badge>
                          <Badge variant="secondary">
                            {(r.relevance * 100).toFixed(0)}% match
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {r.content}
                      </p>
                    </CardContent>
                  </Card>
                ))}
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
                              .replace(/_/g, " ")
                              .toUpperCase()}
                          </Badge>
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
                          {complianceCheck.data.requirements.map((r, i) => (
                            <li
                              key={i}
                              className="text-xs text-muted-foreground flex items-center gap-2"
                            >
                              <CheckCircle className="h-3 w-3 text-green-500" />{" "}
                              {r}
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
            {sessions.data?.sessions.map(s => (
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
                      {new Date(s.lastActivity).toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(!sessions.data || sessions.data.total === 0) && (
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
