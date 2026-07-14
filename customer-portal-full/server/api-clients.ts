/**
 * API Client Utilities for Service Integration
 * 
 * This module provides type-safe clients for calling Go microservices
 * and Python services from the customer portal backend.
 */

import { TRPCError } from '@trpc/server';

// ============================================================================
// Configuration
// ============================================================================

const SERVICE_URLS = {
  // Core services
  policy: process.env.POLICY_SERVICE_URL || 'http://localhost:8081',
  claim: process.env.CLAIM_SERVICE_URL || 'http://localhost:8082',
  payment: process.env.PAYMENT_SERVICE_URL || 'http://localhost:8083',
  customer: process.env.CUSTOMER_SERVICE_URL || 'http://localhost:8084',
  verification: process.env.VERIFICATION_SERVICE_URL || 'http://localhost:8085',
  telco: process.env.TELCO_SERVICE_URL || 'http://localhost:8010',
  fraud: process.env.FRAUD_DATABASE_URL || 'http://localhost:8020',
  // Extended microservices
  actuarial: process.env.ACTUARIAL_SERVICE_URL || 'http://localhost:8091',
  bancassurance: process.env.BANCASSURANCE_SERVICE_URL || 'http://localhost:8092',
  groupLife: process.env.GROUP_LIFE_SERVICE_URL || 'http://localhost:8093',
  nmid: process.env.NMID_SERVICE_URL || 'http://localhost:8094',
  pfa: process.env.PFA_SERVICE_URL || 'http://localhost:8095',
  reinsurance: process.env.REINSURANCE_SERVICE_URL || 'http://localhost:8096',
  kyc: process.env.KYC_SERVICE_URL || 'http://localhost:8097',
  analytics: process.env.ANALYTICS_SERVICE_URL || 'http://localhost:8098',
  geospatial: process.env.GEOSPATIAL_SERVICE_URL || 'http://localhost:8099',
  communication: process.env.COMMUNICATION_SERVICE_URL || 'http://localhost:8100',
  document: process.env.DOCUMENT_SERVICE_URL || 'http://localhost:8101',
  underwriting: process.env.UNDERWRITING_SERVICE_URL || 'http://localhost:8102',
  erpnext: process.env.ERPNEXT_SERVICE_URL || 'http://localhost:8103',
  openimis: process.env.OPENIMIS_SERVICE_URL || 'http://localhost:8104',
  etherisc: process.env.ETHERISC_SERVICE_URL || 'http://localhost:8105',
  mojaloop: process.env.MOJALOOP_SERVICE_URL || 'http://localhost:8106',
  gdpr: process.env.GDPR_SERVICE_URL || 'http://localhost:8107',
  ussd: process.env.USSD_SERVICE_URL || 'http://localhost:8108',
  // KYC/KYB World-Class Services
  deepfaceLiveness: process.env.DEEPFACE_LIVENESS_URL || 'http://localhost:8110',
  documentOcr: process.env.DOCUMENT_OCR_URL || 'http://localhost:8111',
  kycOrchestrator: process.env.KYC_ORCHESTRATOR_URL || 'http://localhost:8085',
  identityMatcher: process.env.IDENTITY_MATCHER_URL || 'http://localhost:8112',
  // Middleware services
  kycLedger: process.env.KYC_LEDGER_URL || 'http://localhost:8113',
  kycAnalytics: process.env.KYC_ANALYTICS_URL || 'http://localhost:8114',
  kycStream: process.env.KYC_STREAM_URL || 'http://localhost:8115',
};

const TIMEOUT_MS = 10000; // 10 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// Base HTTP Client with Retry Logic
// ============================================================================

async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok && retries > 0 && response.status >= 500) {
      // Retry on server errors
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return fetchWithRetry(url, options, retries - 1);
    }

    return response;
  } catch (error: any) {
    if (retries > 0 && (error.name === 'AbortError' || error.code === 'ECONNREFUSED')) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw error;
  }
}

async function apiCall<T>(
  serviceName: keyof typeof SERVICE_URLS,
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${SERVICE_URLS[serviceName]}${endpoint}`;

  try {
    const response = await fetchWithRetry(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new TRPCError({
        code: response.status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST',
        message: `${serviceName} service error: ${errorText}`,
      });
    }

    return await response.json();
  } catch (error: any) {
    if (error instanceof TRPCError) throw error;

    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to call ${serviceName} service: ${error.message}`,
    });
  }
}

// ============================================================================
// Policy Service Client
// ============================================================================

export const policyService = {
  async list(customerId: string) {
    return apiCall('policy', `/api/v1/policies/customer/${customerId}`);
  },

  async get(policyId: string) {
    return apiCall('policy', `/api/v1/policies/${policyId}`);
  },

  async create(data: any) {
    return apiCall('policy', '/api/v1/policies', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(policyId: string, data: any) {
    return apiCall('policy', `/api/v1/policies/${policyId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async renew(policyId: string) {
    return apiCall('policy', `/api/v1/policies/${policyId}/renew`, {
      method: 'POST',
    });
  },

  async cancel(policyId: string) {
    return apiCall('policy', `/api/v1/policies/${policyId}/cancel`, {
      method: 'POST',
    });
  },

  async generateQuote(data: any) {
    return apiCall('policy', '/api/v1/quotes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ============================================================================
// Claim Service Client
// ============================================================================

export const claimService = {
  async list(customerId?: string, policyId?: string) {
    const params = new URLSearchParams();
    if (customerId) params.append('customer_id', customerId);
    if (policyId) params.append('policy_id', policyId);
    return apiCall('claim', `/api/v1/claims?${params.toString()}`);
  },

  async get(claimId: string) {
    return apiCall('claim', `/api/v1/claims/${claimId}`);
  },

  async create(data: any) {
    return apiCall('claim', '/api/v1/claims', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(claimId: string, data: any) {
    return apiCall('claim', `/api/v1/claims/${claimId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async approve(claimId: string, approvedAmount: number) {
    return apiCall('claim', `/api/v1/claims/${claimId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approved_amount: approvedAmount }),
    });
  },

  async reject(claimId: string, reason: string) {
    return apiCall('claim', `/api/v1/claims/${claimId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejection_reason: reason }),
    });
  },

  async settle(claimId: string) {
    return apiCall('claim', `/api/v1/claims/${claimId}/settle`, {
      method: 'POST',
    });
  },

  async uploadDocument(claimId: string, documentData: any) {
    return apiCall('claim', `/api/v1/claims/${claimId}/documents`, {
      method: 'POST',
      body: JSON.stringify(documentData),
    });
  },
};

// ============================================================================
// Payment Service Client
// ============================================================================

export const paymentService = {
  async list(customerId?: string, policyId?: string) {
    const params = new URLSearchParams();
    if (customerId) params.append('customer_id', customerId);
    if (policyId) params.append('policy_id', policyId);
    return apiCall('payment', `/api/v1/payments?${params.toString()}`);
  },

  async get(paymentId: string) {
    return apiCall('payment', `/api/v1/payments/${paymentId}`);
  },

  async create(data: any) {
    return apiCall('payment', '/api/v1/payments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async process(paymentId: string, paymentData: any) {
    return apiCall('payment', `/api/v1/payments/${paymentId}/process`, {
      method: 'POST',
      body: JSON.stringify(paymentData),
    });
  },

  async refund(paymentId: string, reason: string) {
    return apiCall('payment', `/api/v1/payments/${paymentId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async addPaymentMethod(customerId: string, methodData: any) {
    return apiCall('payment', '/api/v1/payment-methods', {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId, ...methodData }),
    });
  },

  async getPaymentMethods(customerId: string) {
    return apiCall('payment', `/api/v1/payment-methods/customer/${customerId}`);
  },
};

// ============================================================================
// Customer Service Client
// ============================================================================

export const customerService = {
  async get(customerId: string) {
    return apiCall('customer', `/api/v1/customers/${customerId}`);
  },

  async create(data: any) {
    return apiCall('customer', '/api/v1/customers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async update(customerId: string, data: any) {
    return apiCall('customer', `/api/v1/customers/${customerId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async search(query: string) {
    return apiCall('customer', `/api/v1/customers/search?q=${encodeURIComponent(query)}`);
  },

  async uploadDocument(customerId: string, documentData: any) {
    return apiCall('customer', `/api/v1/customers/${customerId}/documents`, {
      method: 'POST',
      body: JSON.stringify(documentData),
    });
  },

  async getPolicies(customerId: string) {
    return apiCall('customer', `/api/v1/customers/${customerId}/policies`);
  },

  async getClaims(customerId: string) {
    return apiCall('customer', `/api/v1/customers/${customerId}/claims`);
  },
};

// ============================================================================
// Verification Service Client
// ============================================================================

export const verificationService = {
  async verifyNIN(nin: string, firstName: string, lastName: string) {
    return apiCall('verification', '/api/v1/verify/nin', {
      method: 'POST',
      body: JSON.stringify({ nin, first_name: firstName, last_name: lastName }),
    });
  },

  async verifyCAC(rcNumber: string, companyName: string) {
    return apiCall('verification', '/api/v1/verify/cac', {
      method: 'POST',
      body: JSON.stringify({ rc_number: rcNumber, company_name: companyName }),
    });
  },

  async verifyBiometric(customerId: string, biometricData: any) {
    return apiCall('verification', '/api/v1/verify/biometric', {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId, ...biometricData }),
    });
  },

  async verifyPhone(phone: string, otp: string) {
    return apiCall('verification', '/api/v1/verify/phone', {
      method: 'POST',
      body: JSON.stringify({ phone, otp }),
    });
  },

  async get(verificationId: string) {
    return apiCall('verification', `/api/v1/verifications/${verificationId}`);
  },

  async getCustomerVerifications(customerId: string) {
    return apiCall('verification', `/api/v1/verifications/customer/${customerId}`);
  },
};

// ============================================================================
// Telco Service Client
// ============================================================================

export const telcoService = {
  async getCreditScore(customerId: string, phoneNumber: string) {
    return apiCall('telco', '/api/v1/credit-score/calculate', {
      method: 'POST',
      body: JSON.stringify({ customer_id: customerId, phone_number: phoneNumber }),
    });
  },

  async getHybridScore(customerId: string, phoneNumber: string, telcoData: any) {
    return apiCall('telco', '/api/v1/hybrid/score', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        phone_number: phoneNumber,
        telco_data: telcoData,
        use_dynamic_weighting: true,
      }),
    });
  },

  async recordLoanApplication(customerId: string, phoneNumber: string, creditScore: number, loanAmount: number) {
    return apiCall('telco', '/api/v1/data-collection/loan-applications', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        phone_number: phoneNumber,
        credit_score: creditScore,
        loan_amount: loanAmount,
      }),
    });
  },
};

// ============================================================================
// Fraud Database Client
// ============================================================================

export const fraudService = {
  async checkCustomer(nin: string, companyId: string) {
    return apiCall('fraud', '/api/v1/fraud/check', {
      method: 'POST',
      body: JSON.stringify({ nin, company_id: companyId }),
    });
  },

  async reportFraud(data: any) {
    return apiCall('fraud', '/api/v1/fraud/report', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getStatistics(companyId: string) {
    return apiCall('fraud', `/api/v1/analytics/statistics?company_id=${companyId}`);
  },
};

// ============================================================================
// Health Check Utilities
// ============================================================================

export async function checkServiceHealth(serviceName: keyof typeof SERVICE_URLS): Promise<boolean> {
  try {
    const response = await fetch(`${SERVICE_URLS[serviceName]}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch (err) {
    console.error(`[api-clients] health check failed for ${serviceName}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

// ============================================================================
// DeepFace Liveness Service Client
// ============================================================================

export const deepfaceLivenessService = {
  async detectLiveness(imageBase64: string, sessionId: string) {
    return apiCall<any>('deepfaceLiveness', '/api/v1/liveness/detect', {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64, session_id: sessionId }),
    });
  },

  async startChallenge(sessionId: string, challengeType: string) {
    return apiCall<any>('deepfaceLiveness', '/api/v1/liveness/challenge/start', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, challenge_type: challengeType }),
    });
  },

  async submitChallengeFrame(sessionId: string, frameBase64: string) {
    return apiCall<any>('deepfaceLiveness', '/api/v1/liveness/challenge/frame', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, frame_base64: frameBase64 }),
    });
  },

  async completeChallenge(sessionId: string) {
    return apiCall<any>('deepfaceLiveness', '/api/v1/liveness/challenge/complete', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    });
  },

  async verifyFaces(sourceBase64: string, targetBase64: string, sessionId: string) {
    return apiCall<any>('deepfaceLiveness', '/api/v1/face/verify', {
      method: 'POST',
      body: JSON.stringify({ source_image_base64: sourceBase64, target_image_base64: targetBase64, session_id: sessionId }),
    });
  },

  async analyzeFace(imageBase64: string, sessionId: string) {
    return apiCall<any>('deepfaceLiveness', '/api/v1/face/analyze', {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64, session_id: sessionId }),
    });
  },

  async generateEmbedding(imageBase64: string, sessionId: string) {
    return apiCall<any>('deepfaceLiveness', '/api/v1/face/embedding', {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64, session_id: sessionId }),
    });
  },
};

// ============================================================================
// Document OCR Service Client
// ============================================================================

export const documentOcrService = {
  async extractText(imageBase64: string, sessionId: string, documentType?: string) {
    return apiCall<any>('documentOcr', '/api/v1/ocr/extract', {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64, session_id: sessionId, document_type: documentType }),
    });
  },

  async classifyDocument(imageBase64: string, sessionId: string) {
    return apiCall<any>('documentOcr', '/api/v1/document/classify', {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64, session_id: sessionId }),
    });
  },

  async validateDocument(imageBase64: string, sessionId: string, documentType: string) {
    return apiCall<any>('documentOcr', '/api/v1/document/validate', {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64, session_id: sessionId, document_type: documentType }),
    });
  },

  async extractAndValidate(imageBase64: string, sessionId: string, documentType?: string) {
    return apiCall<any>('documentOcr', '/api/v1/ocr/extract-and-validate', {
      method: 'POST',
      body: JSON.stringify({ image_base64: imageBase64, session_id: sessionId, document_type: documentType }),
    });
  },

  async parseDocument(documentBase64: string, sessionId: string) {
    return apiCall<any>('documentOcr', '/api/v1/document/parse', {
      method: 'POST',
      body: JSON.stringify({ document_base64: documentBase64, session_id: sessionId }),
    });
  },
};

// ============================================================================
// KYC Orchestrator Service Client (Go)
// ============================================================================

export const kycOrchestratorService = {
  async startVerification(userId: string, verificationType: string, documentType?: string, targetLevel?: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyc/start', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, verification_type: verificationType, document_type: documentType, target_level: targetLevel }),
    });
  },

  async getSession(sessionId: string) {
    return apiCall<any>('kycOrchestrator', `/api/v1/kyc/session/${sessionId}`);
  },

  async getUserVerifications(userId: string) {
    return apiCall<any>('kycOrchestrator', `/api/v1/kyc/user/${userId}`);
  },

  async submitDocument(sessionId: string, documentType: string, documentBase64: string, documentNumber?: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyc/document', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, document_type: documentType, document_base64: documentBase64, document_number: documentNumber }),
    });
  },

  async submitSelfie(sessionId: string, imageBase64: string, challengeType?: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyc/selfie', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, image_base64: imageBase64, challenge_type: challengeType }),
    });
  },

  async verifyNIN(sessionId: string, nin: string, firstName: string, lastName: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyc/verify/nin', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, nin, first_name: firstName, last_name: lastName }),
    });
  },

  async verifyBVN(sessionId: string, bvn: string, firstName: string, lastName: string, dob?: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyc/verify/bvn', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, bvn, first_name: firstName, last_name: lastName, dob }),
    });
  },

  async verifyPhone(sessionId: string, phone: string, otp: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyc/verify/phone', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, phone, otp }),
    });
  },

  async reviewDecision(sessionId: string, reviewerId: string, decision: string, notes?: string, reason?: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyc/review', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, reviewer_id: reviewerId, decision, notes, reason }),
    });
  },

  async getEvents(sessionId: string) {
    return apiCall<any>('kycOrchestrator', `/api/v1/kyc/events/${sessionId}`);
  },

  async screenAML(sessionId: string, fullName: string, dob?: string, country?: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyc/aml/screen', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, full_name: fullName, dob, country }),
    });
  },

  async assessRisk(sessionId: string) {
    return apiCall<any>('kycOrchestrator', `/api/v1/kyc/risk/${sessionId}`);
  },

  // KYB endpoints
  async startKYB(businessId: string, companyName: string, rcNumber: string, tin?: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyb/start', {
      method: 'POST',
      body: JSON.stringify({ business_id: businessId, company_name: companyName, rc_number: rcNumber, tin }),
    });
  },

  async getKYBSession(sessionId: string) {
    return apiCall<any>('kycOrchestrator', `/api/v1/kyb/session/${sessionId}`);
  },

  async verifyCAC(sessionId: string) {
    return apiCall<any>('kycOrchestrator', `/api/v1/kyb/verify/cac/${sessionId}`, { method: 'POST' });
  },

  async verifyTIN(sessionId: string) {
    return apiCall<any>('kycOrchestrator', `/api/v1/kyb/verify/tin/${sessionId}`, { method: 'POST' });
  },

  async addDirector(sessionId: string, name: string, nin: string, bvn: string, position: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyb/director', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, name, nin, bvn, position }),
    });
  },

  async addUBO(sessionId: string, name: string, ownershipPct: number, nin: string) {
    return apiCall<any>('kycOrchestrator', '/api/v1/kyb/ubo', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, name, ownership_pct: ownershipPct, nin }),
    });
  },
};

// ============================================================================
// Identity Matching Engine Client (Rust)
// ============================================================================

export const identityMatcherService = {
  async matchFaces(sourceEmbedding: number[], targetEmbedding: number[], sessionId: string, threshold?: number) {
    return apiCall<any>('identityMatcher', '/api/v1/match', {
      method: 'POST',
      body: JSON.stringify({ source_embedding: sourceEmbedding, target_embedding: targetEmbedding, session_id: sessionId, threshold }),
    });
  },

  async batchMatch(probeEmbedding: number[], candidates: Array<{ id: string; embedding: number[] }>, sessionId: string) {
    return apiCall<any>('identityMatcher', '/api/v1/match/batch', {
      method: 'POST',
      body: JSON.stringify({ probe_embedding: probeEmbedding, candidates, session_id: sessionId }),
    });
  },

  async storeEmbedding(identityId: string, embedding: number[]) {
    return apiCall<any>('identityMatcher', '/api/v1/embedding/store', {
      method: 'POST',
      body: JSON.stringify({ identity_id: identityId, embedding }),
    });
  },

  async searchEmbedding(probeEmbedding: number[], sessionId: string, threshold?: number, topK?: number) {
    return apiCall<any>('identityMatcher', '/api/v1/embedding/search', {
      method: 'POST',
      body: JSON.stringify({ probe_embedding: probeEmbedding, session_id: sessionId, threshold, top_k: topK }),
    });
  },

  async fraudCheck(sessionId: string, identityId: string, embedding?: number[], ipAddress?: string, deviceFingerprint?: string) {
    return apiCall<any>('identityMatcher', '/api/v1/fraud/check', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, identity_id: identityId, embedding, ip_address: ipAddress, device_fingerprint: deviceFingerprint }),
    });
  },

  async duplicateCheck(embedding: number[], sessionId: string) {
    return apiCall<any>('identityMatcher', '/api/v1/duplicate/check', {
      method: 'POST',
      body: JSON.stringify({ embedding, session_id: sessionId }),
    });
  },
};

// ============================================================================
// KYC Ledger Service Client (Rust — TigerBeetle + Dapr)
// ============================================================================

export const kycLedgerService = {
  async createEntry(entry: {
    debit_account: string; credit_account: string; amount: number; currency: string;
    ledger_type: string; user_id: string; description: string;
    kyc_session_id?: string; kyc_level?: number; metadata?: Record<string, unknown>;
  }) {
    return apiCall<any>('kycLedger', '/api/v1/ledger/entry', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
  },

  async getEntry(id: string) {
    return apiCall<any>('kycLedger', `/api/v1/ledger/entry/${id}`);
  },

  async getUserEntries(userId: string) {
    return apiCall<any>('kycLedger', `/api/v1/ledger/user/${userId}`);
  },

  async getAccountBalance(accountId: string) {
    return apiCall<any>('kycLedger', `/api/v1/ledger/balance/${accountId}`);
  },

  async validateTransfer(userId: string, amount: number, kycLevel: number) {
    return apiCall<any>('kycLedger', '/api/v1/ledger/validate-transfer', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, amount, kyc_level: kycLevel }),
    });
  },

  async getStats() {
    return apiCall<any>('kycLedger', '/api/v1/ledger/stats');
  },
};

// ============================================================================
// KYC Analytics Service Client (Python — Lakehouse)
// ============================================================================

export const kycAnalyticsService = {
  async generateComplianceReport(period: string, country: string = 'NG') {
    return apiCall<any>('kycAnalytics', '/api/v1/analytics/compliance-report', {
      method: 'POST',
      body: JSON.stringify({ period, country }),
    });
  },

  async getMetrics(period: string = 'monthly') {
    return apiCall<any>('kycAnalytics', `/api/v1/analytics/metrics?period=${period}`);
  },

  async getRiskAnalysis() {
    return apiCall<any>('kycAnalytics', '/api/v1/analytics/risk-analysis');
  },

  async ingestData(table: string, data: Record<string, unknown>) {
    return apiCall<any>('kycAnalytics', '/api/v1/analytics/ingest', {
      method: 'POST',
      body: JSON.stringify({ table, data }),
    });
  },

  async getNDPRReport() {
    return apiCall<any>('kycAnalytics', '/api/v1/analytics/ndpr-report');
  },

  async getTableStats() {
    return apiCall<any>('kycAnalytics', '/api/v1/analytics/tables');
  },
};

// ============================================================================
// KYC Stream Processor Client (Python — Fluvio)
// ============================================================================

export const kycStreamService = {
  async publishEvent(event: {
    id: string; event_type: string; session_id: string;
    user_id: string; timestamp: string; data: Record<string, unknown>;
  }) {
    return apiCall<any>('kycStream', '/api/v1/stream/publish', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  },

  async consumeEvents(topic: string, offset: number = 0, limit: number = 100) {
    return apiCall<any>('kycStream', `/api/v1/stream/consume/${topic}?offset=${offset}&limit=${limit}`);
  },

  async listTopics() {
    return apiCall<any>('kycStream', '/api/v1/stream/topics');
  },

  async getStats() {
    return apiCall<any>('kycStream', '/api/v1/stream/stats');
  },
};

// ============================================================================
// KYC Gate Helper — Platform-wide enforcement
// ============================================================================

export async function checkKYCGate(userId: string, requiredLevel: number = 1): Promise<{
  allowed: boolean; level: number; reason: string;
}> {
  try {
    const result = await apiCall<any>('kycOrchestrator', `/api/v1/kyc/gate/${userId}`);
    const allowed = result.allowed && result.level >= requiredLevel;
    return {
      allowed,
      level: result.level || 0,
      reason: allowed
        ? `KYC Level ${result.level} meets minimum ${requiredLevel}`
        : `KYC Level ${result.level || 0} below required ${requiredLevel}`,
    };
  } catch (err) {
    console.error('[api-clients] KYC gate check failed:', err instanceof Error ? err.message : err);
    return { allowed: false, level: 0, reason: 'KYC gate check unavailable' };
  }
}

export async function checkAllServicesHealth(): Promise<Record<string, boolean>> {
  const services = Object.keys(SERVICE_URLS) as Array<keyof typeof SERVICE_URLS>;
  const results = await Promise.all(
    services.map(async service => ({
      service,
      healthy: await checkServiceHealth(service),
    }))
  );

  return Object.fromEntries(results.map(r => [r.service, r.healthy]));
}
