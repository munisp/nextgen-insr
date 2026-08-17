import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PlatformChangelog() {
  const changelogQ = trpc.changelog.list.useQuery({});

  const typeColor: Record<string, string> = {
    feature: "bg-blue-600",
    improvement: "bg-green-600",
    bugfix: "bg-orange-600",
    security: "bg-red-600",
  };
  const typeIcon: Record<string, string> = {
    feature: "✨",
    improvement: "⚡",
    bugfix: "🐛",
    security: "🔒",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Platform Changelog</h1>
            <p className="text-gray-400">Release notes and version history</p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        <div className="relative">
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-800" />
          <div className="space-y-6">
            {changelogQ.data?.entries.map(entry => (
              <div key={entry.id} className="relative pl-14">
                <div className="absolute left-4 top-4 w-4 h-4 rounded-full bg-gray-800 border-2 border-gray-600 z-10" />
                <Card className="bg-gray-900 border-gray-800">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="text-lg">{typeIcon[entry.type]}</span>
                        <CardTitle className="text-lg text-white">
                          {entry.title}
                        </CardTitle>
                        <Badge className="text-white font-mono text-xs bg-gray-700">
                          v{entry.version}
                        </Badge>
                        <Badge
                          className={`${typeColor[entry.type]} text-white text-xs`}
                        >
                          {entry.type}
                        </Badge>
                      </div>
                      <span className="text-sm text-gray-500">
                        {entry.date}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-300 mb-3">
                      {entry.description}
                    </p>
                    <div className="space-y-1">
                      {entry.highlights.map((h, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 text-sm text-gray-400"
                        >
                          <span className="text-green-500 mt-0.5">•</span>
                          <span>{h}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
