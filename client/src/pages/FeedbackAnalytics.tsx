/**
 * FeedbackAnalytics — Dashboard for tracking guide section feedback
 *
 * Shows:
 * - Overall satisfaction metrics
 * - Per-section ratings with bar charts
 * - Most/least helpful sections
 * - Recent feedback entries
 * - Trends over time
 */
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BarChart2,
  ThumbsUp,
  ThumbsDown,
  TrendingUp,
  TrendingDown,
  Star,
  MessageSquare,
  ArrowUp,
  ArrowDown,
  Award,
  AlertTriangle,
  Eye,
  Clock,
  Filter,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Section display names
const sectionNames: Record<string, string> = {
  "getting-started": "Getting Started",
  "pos-terminal": "Service Node Operations",
  "agent-management": "Agent Management",
  transactions: "Transaction Processing",
  "fraud-detection": "Fraud Detection & Alerts",
  "kyc-verification": "KYC Verification",
  "reports-analytics": "Reports & Analytics",
  "settings-config": "Settings & Configuration",
  troubleshooting: "Troubleshooting",
  faq: "FAQ",
};

interface FeedbackEntry {
  id: string;
  sectionId: string;
  subsectionId?: string;
  rating: "up" | "down";
  comment?: string;
  userId?: string;
  createdAt: string;
}

export default function FeedbackAnalytics() {
  const [filterSection, setFilterSection] = useState<string>("all");
  const [filterRating, setFilterRating] = useState<string>("all");

  // Fetch feedback data
  const { data: summaryData } = trpc.guideFeedback.summary.useQuery();
  const { data: feedbackList } = trpc.guideFeedback.list.useQuery({
    limit: 100,
  });
  const utils = trpc.useUtils();

  // Calculate analytics from feedback list
  const analytics = useMemo(() => {
    // @ts-ignore Sprint 85
    if (!feedbackList?.items) return null;

    // @ts-ignore Sprint 85
    const entries = feedbackList.items as unknown as FeedbackEntry[];
    const totalFeedback = entries.length;
    const helpfulCount = entries.filter(f => f.rating === "up").length;
    const notHelpfulCount = entries.filter(f => f.rating === "down").length;
    const overallSatisfaction =
      totalFeedback > 0 ? Math.round((helpfulCount / totalFeedback) * 100) : 0;
    const withComments = entries.filter(f => f.comment).length;

    // Per-section breakdown
    const sectionMap = new Map<
      string,
      { helpful: number; notHelpful: number; total: number; comments: string[] }
    >();
    entries.forEach(entry => {
      const sec = entry.sectionId;
      if (!sectionMap.has(sec)) {
        sectionMap.set(sec, {
          helpful: 0,
          notHelpful: 0,
          total: 0,
          comments: [],
        });
      }
      const s = sectionMap.get(sec)!;
      s.total++;
      if (entry.rating === "up") s.helpful++;
      else s.notHelpful++;
      if (entry.comment) s.comments.push(entry.comment);
    });

    const sections = Array.from(sectionMap.entries()).map(([id, data]) => ({
      id,
      name: sectionNames[id] || id,
      ...data,
      satisfaction:
        data.total > 0 ? Math.round((data.helpful / data.total) * 100) : 0,
    }));

    // Sort by satisfaction
    const mostHelpful = [...sections].sort(
      (a: any, b: any) => b.satisfaction - a.satisfaction
    );
    const leastHelpful = [...sections].sort(
      (a: any, b: any) => a.satisfaction - b.satisfaction
    );

    return {
      totalFeedback,
      helpfulCount,
      notHelpfulCount,
      overallSatisfaction,
      withComments,
      sections,
      mostHelpful: mostHelpful.slice(0, 3),
      leastHelpful: leastHelpful.slice(0, 3),
    };
  }, [feedbackList]);

  // Filter feedback entries
  const filteredFeedback = useMemo(() => {
    // @ts-ignore Sprint 85
    if (!feedbackList?.items) return [];
    // @ts-ignore Sprint 85
    let entries = feedbackList.items as unknown as FeedbackEntry[];
    if (filterSection !== "all")
      entries = entries.filter(f => f.sectionId === filterSection);
    if (filterRating === "helpful")
      entries = entries.filter(f => f.rating === "up");
    else if (filterRating === "not_helpful")
      entries = entries.filter(f => f.rating === "down");
    return entries;
  }, [feedbackList, filterSection, filterRating]);

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-primary" />
              Feedback Analytics
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Track which guide sections are most and least helpful to users
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => utils.guideFeedback.invalidate()}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Total Feedback
              </span>
            </div>
            <p className="text-2xl font-bold">
              {analytics?.totalFeedback || 0}
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <ThumbsUp className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Helpful</span>
            </div>
            <p className="text-2xl font-bold text-green-500">
              {analytics?.helpfulCount || 0}
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <ThumbsDown className="h-4 w-4 text-red-500" />
              <span className="text-xs text-muted-foreground">Not Helpful</span>
            </div>
            <p className="text-2xl font-bold text-red-500">
              {analytics?.notHelpfulCount || 0}
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <Star className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">
                Satisfaction
              </span>
            </div>
            <p className="text-2xl font-bold">
              {analytics?.overallSatisfaction || 0}%
            </p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <div className="flex items-center gap-2 mb-2">
              <Eye className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">
                With Comments
              </span>
            </div>
            <p className="text-2xl font-bold">{analytics?.withComments || 0}</p>
          </div>
        </div>

        {/* Most / Least Helpful */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Most Helpful */}
          <div className="rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <Award className="h-4 w-4 text-green-500" />
              Most Helpful Sections
            </h3>
            <div className="space-y-3">
              {analytics?.mostHelpful.map((section, i) => (
                <div key={section.id} className="flex items-center gap-3">
                  <span className="text-lg font-bold text-muted-foreground w-6">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {section.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-green-500 transition-all"
                          style={{ width: `${section.satisfaction}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-green-500">
                        {section.satisfaction}%
                      </span>
                    </div>
                  </div>
                  <TrendingUp className="h-4 w-4 text-green-500 flex-shrink-0" />
                </div>
              ))}
              {(!analytics?.mostHelpful ||
                analytics.mostHelpful.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No feedback data yet
                </p>
              )}
            </div>
          </div>

          {/* Least Helpful */}
          <div className="rounded-xl border border-border p-5">
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-4">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Needs Improvement
            </h3>
            <div className="space-y-3">
              {analytics?.leastHelpful.map((section, i) => (
                <div key={section.id} className="flex items-center gap-3">
                  <span className="text-lg font-bold text-muted-foreground w-6">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {section.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-all"
                          style={{ width: `${section.satisfaction}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-amber-500">
                        {section.satisfaction}%
                      </span>
                    </div>
                  </div>
                  <TrendingDown className="h-4 w-4 text-amber-500 flex-shrink-0" />
                </div>
              ))}
              {(!analytics?.leastHelpful ||
                analytics.leastHelpful.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No feedback data yet
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Per-Section Breakdown */}
        <div className="rounded-xl border border-border p-5">
          <h3 className="text-sm font-semibold mb-4">
            Section-by-Section Breakdown
          </h3>
          <div className="space-y-3">
            {analytics?.sections.map(section => (
              <div key={section.id} className="flex items-center gap-4">
                <div className="w-40 truncate text-sm">{section.name}</div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-6 rounded-md bg-muted overflow-hidden flex">
                    <div
                      className="h-full bg-green-500/80 flex items-center justify-center"
                      style={{ width: `${section.satisfaction}%` }}
                    >
                      {section.satisfaction > 15 && (
                        <span className="text-[10px] text-white font-medium">
                          {section.helpful}
                        </span>
                      )}
                    </div>
                    <div
                      className="h-full bg-red-500/80 flex items-center justify-center"
                      style={{ width: `${100 - section.satisfaction}%` }}
                    >
                      {100 - section.satisfaction > 15 && (
                        <span className="text-[10px] text-white font-medium">
                          {section.notHelpful}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-medium w-12 text-right">
                    {section.satisfaction}%
                  </span>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {section.total} votes
                </Badge>
              </div>
            ))}
            {(!analytics?.sections || analytics.sections.length === 0) && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No feedback data available
              </p>
            )}
          </div>
        </div>

        {/* Recent Feedback */}
        <div className="rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Recent Feedback</h3>
            <div className="flex items-center gap-2">
              <select
                value={filterSection}
                onChange={e => setFilterSection(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="all">All Sections</option>
                {Object.entries(sectionNames).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={filterRating}
                onChange={e => setFilterRating(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="all">All Ratings</option>
                <option value="helpful">Helpful</option>
                <option value="not_helpful">Not Helpful</option>
              </select>
            </div>
          </div>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {filteredFeedback.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/30"
                >
                  {entry.rating === "up" ? (
                    <ThumbsUp className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <ThumbsDown className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {sectionNames[entry.sectionId] || entry.sectionId}
                      </Badge>
                      {entry.subsectionId && (
                        <span className="text-[10px] text-muted-foreground">
                          {entry.subsectionId}
                        </span>
                      )}
                    </div>
                    {entry.comment && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {entry.comment}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      <Clock className="h-3 w-3 inline mr-1" />
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
              {filteredFeedback.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No feedback entries match your filters
                </p>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </DashboardLayout>
  );
}
