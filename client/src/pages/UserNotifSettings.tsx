/**
 * UserNotifSettings — End-user page to customize per-category notification delivery channels
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

const CHANNEL_LABELS = {
  email: "Email",
  sms: "SMS",
  push: "Push",
  inApp: "In-App",
} as const;
type Channel = keyof typeof CHANNEL_LABELS;

export default function UserNotifSettings() {
  const utils = trpc.useUtils();
  const { data: catData } = trpc.userNotifPrefs.categories.useQuery();
  const { data: prefs, isLoading } =
    trpc.userNotifPrefs.getPreferences.useQuery({});

  const updateCategory = trpc.userNotifPrefs.updateCategory.useMutation({
    onSuccess: () => utils.userNotifPrefs.getPreferences.invalidate(),
  });
  const updateQuietHours = trpc.userNotifPrefs.updateQuietHours.useMutation({
    onSuccess: () => {
      utils.userNotifPrefs.getPreferences.invalidate();
      toast.success("Quiet hours updated");
    },
  });
  const updateDigest = trpc.userNotifPrefs.updateDigestMode.useMutation({
    onSuccess: () => {
      utils.userNotifPrefs.getPreferences.invalidate();
      toast.success("Digest mode updated");
    },
  });
  const resetDefaults = trpc.userNotifPrefs.resetToDefaults.useMutation({
    onSuccess: () => {
      utils.userNotifPrefs.getPreferences.invalidate();
      toast.success("Reset to defaults");
    },
  });
  const enableAll = trpc.userNotifPrefs.enableAllForChannel.useMutation({
    onSuccess: () => {
      utils.userNotifPrefs.getPreferences.invalidate();
      toast.success("Channel updated for all categories");
    },
  });

  const [quietStart, setQuietStart] = useState(
    prefs?.quietHours.start ?? "22:00"
  );
  const [quietEnd, setQuietEnd] = useState(prefs?.quietHours.end ?? "07:00");

  const handleToggle = (
    categoryId: string,
    channel: Channel,
    value: boolean
  ) => {
    updateCategory.mutate({ categoryId, channels: { [channel]: value } });
  };

  if (isLoading || !catData || !prefs) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-muted-foreground">
          Loading preferences...
        </div>
      </DashboardLayout>
    );
  }

  const groups = catData.groups;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[1000px] mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Notification Settings</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Choose how you want to be notified for each category
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetDefaults.mutate({})}
          >
            Reset to Defaults
          </Button>
        </div>

        <Tabs defaultValue="categories">
          <TabsList>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="schedule">Schedule</TabsTrigger>
            <TabsTrigger value="channels">Channels</TabsTrigger>
          </TabsList>

          {/* ─── Categories Tab ─── */}
          <TabsContent value="categories" className="space-y-6 mt-4">
            {Object.entries(groups).map(([groupName, cats]) => (
              <Card key={groupName}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{groupName}</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_repeat(4,80px)] gap-2 mb-3 pb-2 border-b">
                    <div className="text-xs text-muted-foreground font-medium">
                      Category
                    </div>
                    {(Object.keys(CHANNEL_LABELS) as Channel[]).map(
                      (ch: any) => (
                        <div
                          key={ch}
                          className="text-xs text-muted-foreground font-medium text-center"
                        >
                          {CHANNEL_LABELS[ch]}
                        </div>
                      )
                    )}
                  </div>
                  {/* Category rows */}
                  {(cats as any[]).map((cat: any) => {
                    const catPrefs = prefs.categories[cat.id];
                    if (!catPrefs) return null;
                    return (
                      <div
                        key={cat.id}
                        className="grid grid-cols-[1fr_repeat(4,80px)] gap-2 items-center py-2 hover:bg-muted/30 rounded px-1"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{cat.icon}</span>
                          <div>
                            <p className="text-sm font-medium">{cat.name}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {cat.description}
                            </p>
                          </div>
                        </div>
                        {(Object.keys(CHANNEL_LABELS) as Channel[]).map(
                          (ch: any) => (
                            <div key={ch} className="flex justify-center">
                              <Switch
                                checked={catPrefs[ch]}
                                onCheckedChange={val =>
                                  handleToggle(cat.id, ch, val)
                                }
                                className="scale-75"
                              />
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ─── Schedule Tab ─── */}
          <TabsContent value="schedule" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Quiet Hours</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Switch
                    checked={prefs.quietHours.enabled}
                    onCheckedChange={val =>
                      updateQuietHours.mutate({
                        enabled: val,
                        start: quietStart,
                        end: quietEnd,
                      })
                    }
                  />
                  <Label>
                    Enable quiet hours (no notifications during this window)
                  </Label>
                </div>
                {prefs.quietHours.enabled && (
                  <div className="flex items-center gap-4 ml-8">
                    <div>
                      <Label className="text-xs">Start</Label>
                      <Input
                        type="time"
                        value={quietStart}
                        onChange={e => setQuietStart(e.target.value)}
                        className="w-32"
                      />
                    </div>
                    <span className="mt-5 text-muted-foreground">to</span>
                    <div>
                      <Label className="text-xs">End</Label>
                      <Input
                        type="time"
                        value={quietEnd}
                        onChange={e => setQuietEnd(e.target.value)}
                        className="w-32"
                      />
                    </div>
                    <Button
                      size="sm"
                      className="mt-5"
                      onClick={() =>
                        updateQuietHours.mutate({
                          enabled: true,
                          start: quietStart,
                          end: quietEnd,
                        })
                      }
                    >
                      Save
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Digest Mode</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Choose how often you receive notification digests
                </p>
                <Select
                  value={prefs.digestMode}
                  onValueChange={(v: any) => updateDigest.mutate({ mode: v })}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instant">Instant (real-time)</SelectItem>
                    <SelectItem value="hourly">Hourly digest</SelectItem>
                    <SelectItem value="daily">Daily digest</SelectItem>
                    <SelectItem value="weekly">Weekly digest</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── Channels Tab ─── */}
          <TabsContent value="channels" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">
              Quickly enable or disable an entire channel across all categories
            </p>
            <div className="grid grid-cols-2 gap-4">
              {(Object.keys(CHANNEL_LABELS) as Channel[]).map((ch: any) => {
                const allEnabled = Object.values(prefs.categories).every(
                  (c: any) => c[ch]
                );
                const someEnabled = Object.values(prefs.categories).some(
                  (c: any) => c[ch]
                );
                return (
                  <Card key={ch}>
                    <CardContent className="p-4 flex items-center justify-between">
                      <div>
                        <p className="font-medium">{CHANNEL_LABELS[ch]}</p>
                        <p className="text-xs text-muted-foreground">
                          {allEnabled
                            ? "All categories enabled"
                            : someEnabled
                              ? "Some categories enabled"
                              : "All categories disabled"}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant={allEnabled ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() =>
                            enableAll.mutate({ channel: ch, enabled: true })
                          }
                        >
                          Enable All
                        </Button>
                        <Button
                          size="sm"
                          variant={!someEnabled ? "default" : "outline"}
                          className="h-7 text-xs"
                          onClick={() =>
                            enableAll.mutate({ channel: ch, enabled: false })
                          }
                        >
                          Disable All
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>

        <p className="text-[10px] text-muted-foreground text-center">
          Last updated: {new Date(prefs.updatedAt).toLocaleString()}
        </p>
      </div>
    </DashboardLayout>
  );
}
