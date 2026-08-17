/**
 * UserNotifSettings — End-user page to customize per-category notification delivery channels
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";


export default function UserNotifSettings() {
  // F-12 (wave-4b): no notification-preference store exists — the
  // categories procedure is phantom and every preference procedure is
  // fail-loud NOT_IMPLEMENTED. The page renders an honest unavailable state.
  const { isError } = trpc.userNotifPrefs.getPreferences.useQuery(
    {},
    { retry: false }
  );


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
            {isError && (
              <p className="text-xs text-muted-foreground">
                (backend reports preference storage as not implemented)
              </p>
            )}
        </div>

        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            — notification preferences are not delivered on this platform (no
            preference store)
          </CardContent>
        </Card>

        <p className="text-[10px] text-muted-foreground text-center">
          Last updated: {new Date(prefs.updatedAt).toLocaleString()}
        </p>
      </div>
    </DashboardLayout>
  );
}
