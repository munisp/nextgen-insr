// React Native API Client with Security
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AnalyticsService } from '../services/AnalyticsService';

export class APIClient {
  // Base URL points to the InsurePortal platform-shell backend REST bridge.
  // Development: http://10.0.2.2:3000/api/v1  (Android emulator)
  //              http://localhost:3000/api/v1   (iOS simulator)
  // Production:  set REACT_NATIVE_API_BASE_URL env var or update below.
  private baseURL: string = (process.env.REACT_NATIVE_API_BASE_URL as string) ?? 'https://api.insureportal.io/v1';

  async get(endpoint: string): Promise<any> {
    return this.request('GET', endpoint);
  }

  async post(endpoint: string, data: any): Promise<any> {
    return this.request('POST', endpoint, data);
  }

  async put(endpoint: string, data: any): Promise<any> {
    return this.request('PUT', endpoint, data);
  }

  async delete(endpoint: string): Promise<any> {
    return this.request('DELETE', endpoint);
  }

  private async request(method: string, endpoint: string, data?: any): Promise<any> {
    const token = await AsyncStorage.getItem('auth_token');
    const deviceId = await this.getDeviceId();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Device-ID': deviceId,
      'X-Request-ID': this.generateRequestId(),
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const config: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };

    if (data && method !== 'GET') {
      config.body = JSON.stringify(data);
    }

    try {
      const startTime = Date.now();
      const response = await fetch(`${this.baseURL}${endpoint}`, config);
      const endTime = Date.now();

      AnalyticsService.trackPerformance(`api_${method.toLowerCase()}_${endpoint}`, endTime - startTime, 'ms');

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const responseData = await response.json();
      return { data: responseData, status: response.status };
    } catch (error) {
      AnalyticsService.trackError('api_request_failed', error);
      throw error;
    }
  }

  private async getDeviceId(): Promise<string> {
    let deviceId = await AsyncStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await AsyncStorage.setItem('device_id', deviceId);
    }
    return deviceId;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ── Domain-specific API client ───────────────────────────────────────────────
// Extends the base APIClient with typed methods for all InsurePortal features.

export class POSInsurePortalAPIClient extends APIClient {
  // Auth
  async login(phone: string, pin: string) { return this.post('/auth/login', { phone, pin }); }
  async register(data: { phone: string; bvn: string; nin: string; firstName: string; lastName: string }) { return this.post('/auth/register', data); }
  async verifyOTP(phone: string, otp: string) { return this.post('/auth/verify-otp', { phone, otp }); }
  async refreshToken() { return this.post('/auth/refresh', {}); }
  async logout() { return this.post('/auth/logout', {}); }

  // Transactions
  async cashIn(data: { amount: number; customerPhone: string; reference: string }) { return this.post('/transactions/cash-in', data); }
  async cashOut(data: { amount: number; customerPhone: string; reference: string }) { return this.post('/transactions/cash-out', data); }
  async transfer(data: { amount: number; toAccount: string; bankCode: string; narration: string }) { return this.post('/transactions/transfer', data); }
  async initiateTransfer(data: { beneficiaryId: string; accountNumber: string; bankCode: string; amount: number; narration: string }) { return this.post('/transactions/initiate-transfer', data); }
  async getTransactionHistory(page = 1, limit = 20) { return this.get(`/transactions?page=${page}&limit=${limit}`); }
  async getTransactionDetail(id: string) { return this.get(`/transactions/${id}`); }
  async reverseTransaction(id: string, reason: string) { return this.post(`/transactions/${id}/reverse`, { reason }); }

  // Float
  async getFloatBalance() { return this.get('/float/balance'); }
  async requestFloatTopUp(amount: number, note?: string) { return this.post('/float/topup-request', { amount, note }); }

  // Airtime & Bills
  async buyAirtime(data: { network: string; phone: string; amount: number }) { return this.post('/bills/airtime', data); }
  async payBill(data: { billerId: string; customerRef: string; amount: number; category: string }) { return this.post('/bills/pay', data); }
  async validateBillCustomer(billerId: string, customerRef: string) { return this.get(`/bills/validate?billerId=${billerId}&customerRef=${encodeURIComponent(customerRef)}`); }

  // Beneficiaries
  async getBeneficiaries() { return this.get('/beneficiaries'); }
  async addBeneficiary(data: { name: string; accountNumber: string; bankCode: string; nickname?: string }) { return this.post('/beneficiaries', data); }
  async deleteBeneficiary(id: string) { return this.delete(`/beneficiaries/${id}`); }

  // Recurring Payments
  async getRecurringPayments() { return this.get('/recurring-payments'); }
  async createRecurringPayment(data: { beneficiaryId: string; amount: number; frequency: string; startDate: string }) { return this.post('/recurring-payments', data); }
  async cancelRecurringPayment(id: string) { return this.delete(`/recurring-payments/${id}`); }

  // Exchange Rates
  async getExchangeRates(baseCurrency = 'NGN') { return this.get(`/rates?base=${baseCurrency}`); }
  async lockRate(data: { fromCurrency: string; toCurrency: string; amount: number }) { return this.post('/rates/lock', data); }
  async getRateLock(lockId: string) { return this.get(`/rates/lock/${lockId}`); }

  // KYC
  async getKYCStatus() { return this.get('/kyc/status'); }
  async submitKYCDocument(data: { type: string; documentUrl: string; selfieUrl?: string }) { return this.post('/kyc/submit', data); }

  // Wallet & Virtual Cards
  async getWalletBalance() { return this.get('/wallet/balance'); }
  async getVirtualCards() { return this.get('/wallet/virtual-cards'); }
  async createVirtualCard(currency: string) { return this.post('/wallet/virtual-cards', { currency }); }
  async freezeVirtualCard(cardId: string) { return this.post(`/wallet/virtual-cards/${cardId}/freeze`, {}); }

  // Savings
  async getSavingsGoals() { return this.get('/savings/goals'); }
  async createSavingsGoal(data: { name: string; targetAmount: number; targetDate: string }) { return this.post('/savings/goals', data); }
  async contributeToGoal(goalId: string, amount: number) { return this.post(`/savings/goals/${goalId}/contribute`, { amount }); }

  // Profile
  async getProfile() { return this.get('/profile'); }
  async updateProfile(data: { firstName?: string; lastName?: string; email?: string }) { return this.put('/profile', data); }
  async changePin(data: { currentPin: string; newPin: string }) { return this.post('/profile/change-pin', data); }

  // Notifications
  async getNotifications(page = 1) { return this.get(`/notifications?page=${page}`); }
  async markNotificationRead(id: string) { return this.put(`/notifications/${id}/read`, {}); }
  async markAllNotificationsRead() { return this.post('/notifications/mark-all-read', {}); }
  async registerPushToken(token: string, platform: 'ios' | 'android') { return this.post('/notifications/push-token', { token, platform }); }

  // Referrals
  async getReferralInfo() { return this.get('/referrals/info'); }
  async getReferralHistory() { return this.get('/referrals/history'); }

  // Support
  async createSupportTicket(data: { subject: string; message: string; category: string }) { return this.post('/support/tickets', data); }
  async getSupportTickets() { return this.get('/support/tickets'); }
  async sendChatMessage(ticketId: string, message: string) { return this.post(`/support/tickets/${ticketId}/messages`, { message }); }
}

export const apiClient = new POSInsurePortalAPIClient();
