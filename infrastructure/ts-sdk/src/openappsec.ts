/**
 * OpenAppSec WAF client with policy management, threat logs, and security dashboard.
 */

export class OpenAppSecClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async ping(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/v1/health`);
    if (resp.status >= 500) throw new Error(`OpenAppSec unhealthy: ${resp.status}`);
  }

  async applyPolicy(policy: Record<string, unknown>): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/v1/policies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(policy),
    });
    if (!resp.ok) throw new Error(`Policy apply failed (${resp.status})`);
  }

  async applyPlatformPolicy(): Promise<void> {
    await this.applyPolicy({
      name: 'ngapp-insurance-waf', mode: 'prevent',
      rules: [
        { name: 'block-sqli', type: 'sql-injection', action: 'block', severity: 'critical' },
        { name: 'block-xss', type: 'cross-site-scripting', action: 'block', severity: 'high' },
        { name: 'block-path-traversal', type: 'path-traversal', action: 'block', severity: 'high' },
        { name: 'block-cmd-injection', type: 'command-injection', action: 'block', severity: 'critical' },
        { name: 'block-xxe', type: 'xml-external-entity', action: 'block', severity: 'high' },
        { name: 'block-ssrf', type: 'server-side-request-forgery', action: 'block', severity: 'critical' },
        { name: 'rate-limit-api', type: 'rate-limit', action: 'throttle', config: { requests_per_second: 100, burst: 50 } },
        { name: 'geo-restrict', type: 'geo-restriction', action: 'block', config: { blocked_countries: ['KP', 'IR', 'SY'] } },
      ],
    });
  }

  async getThreatLog(limit: number = 100, severity?: string): Promise<unknown[]> {
    let url = `${this.baseUrl}/api/v1/threats?limit=${limit}`;
    if (severity) url += `&severity=${severity}`;
    const resp = await fetch(url);
    if (!resp.ok) return [];
    const data = await resp.json() as Record<string, unknown>;
    return (data.threats as unknown[]) || [];
  }

  async getSecurityDashboard(): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}/api/v1/dashboard`);
    if (!resp.ok) return { threats_blocked: 0, attacks_prevented: 0 };
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
