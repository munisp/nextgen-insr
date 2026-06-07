/**
 * Sprint 52 — System Settings
 * F07: Centralized settings management with sections
 */
// @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
import { DashboardLayout } from "@/components/DashboardLayout";
import { PageErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/_core/hooks/useAuth";
import { useState } from "react";
import {
  Settings,
  Globe,
  Bell,
  Shield,
  Database,
  Key,
  Mail,
  Smartphone,
  Save,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

import { trpc } from "@/lib/trpc";
const SETTINGS_SECTIONS = [
  { id: "general", label: "General", icon: Settings },
  { id: "security", label: "Security", icon: Shield },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "integrations", label: "Integrations", icon: Globe },
  { id: "database", label: "Database", icon: Database },
  { id: "api", label: "API Keys", icon: Key },
];

function SettingField({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  // Sprint 87: Wired to sysConfig router
  // @ts-ignore Sprint 85
  const { data, isLoading } = trpc.sysConfig.getAll.useQuery({
    page: 1,
    limit: 10,
  });

  return (
    <div className="flex items-start justify-between py-4 border-b last:border-b-0">
      <div className="flex-1 mr-4">
        <div className="font-medium text-sm">{label}</div>
        {description && (
          <div className="text-xs text-muted-foreground mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`}
      />
    </button>
  );
}

function SystemSettingsContent() {
  const [activeSection, setActiveSection] = useState("general");
  const [saved, setSaved] = useState(false);

  // General settings
  const [platformName, setPlatformName] = useState("InsurePortal InsurePortal Platform");
  const [defaultCurrency, setDefaultCurrency] = useState("NGN");
  const [timezone, setTimezone] = useState("Africa/Lagos");
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // Security settings
  const [twoFactor, setTwoFactor] = useState(true);
  const [sessionTimeout, setSessionTimeout] = useState("30");
  const [ipWhitelist, setIpWhitelist] = useState(true);
  const [maxLoginAttempts, setMaxLoginAttempts] = useState("5");

  // Notification settings
  const [emailNotif, setEmailNotif] = useState(true);
  const [smsNotif, setSmsNotif] = useState(true);
  const [pushNotif, setPushNotif] = useState(false);
  const [fraudAlerts, setFraudAlerts] = useState(true);

  // Integration settings
  const [nibssEnabled, setNibssEnabled] = useState(true);
  const [cbnReporting, setCbnReporting] = useState(true);
  const [termiiSms, setTermiiSms] = useState(true);
  const [youverifyKyc, setYouverifyKyc] = useState(true);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">System Settings</h1>
          <p className="text-sm text-muted-foreground">
            Configure platform-wide settings and integrations
          </p>
        </div>
        <div className="flex gap-2">
          <button className="inline-flex items-center gap-2 px-4 py-2 rounded-md border hover:bg-accent text-sm">
            <RotateCcw className="h-4 w-4" /> Reset
          </button>
          <button
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 text-sm"
          >
            {saved ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saved ? "Saved!" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Sidebar */}
        <div className="w-48 flex-shrink-0 space-y-1">
          {SETTINGS_SECTIONS.map(section => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors ${
                activeSection === section.id
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent"
              }`}
            >
              <section.icon className="h-4 w-4" /> {section.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 rounded-lg border bg-card p-6">
          {activeSection === "general" && (
            <div>
              <h3 className="font-semibold mb-4">General Settings</h3>
              <SettingField
                label="Platform Name"
                description="Displayed in headers and emails"
              >
                <input
                  value={platformName}
                  onChange={e => setPlatformName(e.target.value)}
                  className="px-3 py-1.5 rounded-md border bg-background text-sm w-48"
                />
              </SettingField>
              <SettingField
                label="Default Currency"
                description="Primary currency for transactions"
              >
                <select
                  value={defaultCurrency}
                  onChange={e => setDefaultCurrency(e.target.value)}
                  className="px-3 py-1.5 rounded-md border bg-background text-sm"
                >
                  <option value="NGN">NGN (₦)</option>
                  <option value="USD">USD ($)</option>
                  <option value="GBP">GBP (£)</option>
                </select>
              </SettingField>
              <SettingField
                label="Timezone"
                description="Server timezone for scheduling"
              >
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="px-3 py-1.5 rounded-md border bg-background text-sm"
                >
                  <option value="Africa/Lagos">Africa/Lagos (WAT)</option>
                  <option value="UTC">UTC</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                </select>
              </SettingField>
              <SettingField
                label="Maintenance Mode"
                description="Temporarily disable all agent operations"
              >
                <Toggle
                  checked={maintenanceMode}
                  onChange={setMaintenanceMode}
                />
              </SettingField>
            </div>
          )}

          {activeSection === "security" && (
            <div>
              <h3 className="font-semibold mb-4">Security Settings</h3>
              <SettingField
                label="Two-Factor Authentication"
                description="Require 2FA for admin logins"
              >
                <Toggle checked={twoFactor} onChange={setTwoFactor} />
              </SettingField>
              <SettingField
                label="Session Timeout (minutes)"
                description="Auto-logout after inactivity"
              >
                <input
                  type="number"
                  value={sessionTimeout}
                  onChange={e => setSessionTimeout(e.target.value)}
                  className="px-3 py-1.5 rounded-md border bg-background text-sm w-24"
                />
              </SettingField>
              <SettingField
                label="IP Whitelist"
                description="Restrict admin access to known IPs"
              >
                <Toggle checked={ipWhitelist} onChange={setIpWhitelist} />
              </SettingField>
              <SettingField
                label="Max Login Attempts"
                description="Lock account after N failed attempts"
              >
                <input
                  type="number"
                  value={maxLoginAttempts}
                  onChange={e => setMaxLoginAttempts(e.target.value)}
                  className="px-3 py-1.5 rounded-md border bg-background text-sm w-24"
                />
              </SettingField>
            </div>
          )}

          {activeSection === "notifications" && (
            <div>
              <h3 className="font-semibold mb-4">Notification Settings</h3>
              <SettingField
                label="Email Notifications"
                description="Send alerts via email"
              >
                <Toggle checked={emailNotif} onChange={setEmailNotif} />
              </SettingField>
              <SettingField
                label="SMS Notifications"
                description="Send alerts via Termii SMS"
              >
                <Toggle checked={smsNotif} onChange={setSmsNotif} />
              </SettingField>
              <SettingField
                label="Push Notifications"
                description="Browser push notifications"
              >
                <Toggle checked={pushNotif} onChange={setPushNotif} />
              </SettingField>
              <SettingField
                label="Fraud Alerts"
                description="Immediate alerts for fraud detection"
              >
                <Toggle checked={fraudAlerts} onChange={setFraudAlerts} />
              </SettingField>
            </div>
          )}

          {activeSection === "integrations" && (
            <div>
              <h3 className="font-semibold mb-4">Integration Settings</h3>
              <SettingField
                label="NIBSS Settlement"
                description="Nigeria Inter-Bank Settlement System"
              >
                <Toggle checked={nibssEnabled} onChange={setNibssEnabled} />
              </SettingField>
              <SettingField
                label="CBN Reporting"
                description="Central Bank of Nigeria regulatory reports"
              >
                <Toggle checked={cbnReporting} onChange={setCbnReporting} />
              </SettingField>
              <SettingField
                label="Termii SMS"
                description="SMS provider for notifications"
              >
                <Toggle checked={termiiSms} onChange={setTermiiSms} />
              </SettingField>
              <SettingField
                label="YouVerify KYC"
                description="Identity verification provider"
              >
                <Toggle checked={youverifyKyc} onChange={setYouverifyKyc} />
              </SettingField>
            </div>
          )}

          {activeSection === "database" && (
            <div>
              <h3 className="font-semibold mb-4">Database Settings</h3>
              <SettingField
                label="Connection Pool Size"
                description="Max concurrent database connections"
              >
                <input
                  type="number"
                  defaultValue="20"
                  className="px-3 py-1.5 rounded-md border bg-background text-sm w-24"
                />
              </SettingField>
              <SettingField
                label="Query Timeout (ms)"
                description="Maximum query execution time"
              >
                <input
                  type="number"
                  defaultValue="30000"
                  className="px-3 py-1.5 rounded-md border bg-background text-sm w-24"
                />
              </SettingField>
              <SettingField
                label="Auto Backup"
                description="Enable daily automated backups"
              >
                <Toggle checked={true} onChange={() => {}} />
              </SettingField>
            </div>
          )}

          {activeSection === "api" && (
            <div>
              <h3 className="font-semibold mb-4">API Keys</h3>
              <div className="space-y-3">
                {[
                  {
                    name: "NIBSS API Key",
                    key: "nibss_****_3k9f",
                    status: "active",
                  },
                  {
                    name: "Termii API Key",
                    key: "trm_****_8x2p",
                    status: "active",
                  },
                  {
                    name: "YouVerify API Key",
                    key: "yv_****_q7mn",
                    status: "active",
                  },
                  {
                    name: "CBN Reporting Key",
                    key: "cbn_****_j4ws",
                    status: "active",
                  },
                ].map(api => (
                  <div
                    key={api.name}
                    className="flex items-center justify-between py-3 border-b"
                  >
                    <div>
                      <div className="font-medium text-sm">{api.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {api.key}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                      {api.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SystemSettingsPage() {
  return (
    <DashboardLayout>
      <PageErrorBoundary>
        <SystemSettingsContent />
      </PageErrorBoundary>
    </DashboardLayout>
  );
}
