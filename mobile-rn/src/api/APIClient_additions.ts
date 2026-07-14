/**
 * API Client Additions for 12 New Mobile Parity Screens
 * Merge these methods into POSInsurePortalAPIClient class in APIClient.ts
 */

// ── Agent Performance ──────────────────────────────────────────────────────────
export const agentPerformanceMethods = {
  getAgentLeaderboard: async function(this: any, days = 30, sortBy = 'points', page = 1, limit = 20) {
    return this.get(`/analytics/agent-leaderboard?days=${days}&sortBy=${sortBy}&page=${page}&limit=${limit}`);
  },
};

// ── Customer Wallet ────────────────────────────────────────────────────────────
export const customerWalletMethods = {
  getCustomerWallet: async function(this: any) { return this.get('/customer/wallet'); },
  getCustomerTransactions: async function(this: any, page = 1, limit = 20) {
    return this.get(`/customer/transactions?page=${page}&limit=${limit}`);
  },
  topUpCustomerWallet: async function(this: any, amount: number) {
    return this.post('/customer/wallet/topup', { amount });
  },
  freezeCustomerWallet: async function(this: any) { return this.post('/customer/wallet/freeze', {}); },
};

// ── Notification Preferences ───────────────────────────────────────────────────
export const notificationPrefMethods = {
  getNotificationPreferences: async function(this: any) { return this.get('/notifications/preferences'); },
  updateNotificationPreferences: async function(this: any, data: any) {
    return this.put('/notifications/preferences', data);
  },
  sendTestNotification: async function(this: any) { return this.post('/notifications/test', {}); },
};

// ── Multi-Currency ─────────────────────────────────────────────────────────────
export const multiCurrencyMethods = {
  getCurrencyRates: async function(this: any, base = 'NGN') { return this.get(`/rates?base=${base}`); },
  convertCurrency: async function(this: any, from: string, to: string, amount: number) {
    return this.post('/rates/convert', { from, to, amount });
  },
};

// ── Compliance Scheduling ──────────────────────────────────────────────────────
export const complianceSchedulingMethods = {
  getComplianceSchedules: async function(this: any) { return this.get('/compliance/schedules'); },
  createComplianceSchedule: async function(this: any, data: any) {
    return this.post('/compliance/schedules', data);
  },
  updateComplianceSchedule: async function(this: any, id: string, data: any) {
    return this.put(`/compliance/schedules/${id}`, data);
  },
};

// ── Audit Export ───────────────────────────────────────────────────────────────
export const auditExportMethods = {
  getAuditExportPreview: async function(this: any, filters: any) {
    return this.post('/audit/export-preview', filters);
  },
  exportAuditLog: async function(this: any, format: string, filters: any) {
    return this.post('/audit/export', { format, ...filters });
  },
  getRecentExports: async function(this: any) { return this.get('/audit/exports'); },
};
