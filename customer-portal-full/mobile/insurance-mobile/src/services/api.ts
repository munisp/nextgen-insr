import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = process.env.API_URL || 'https://api.insureportal.ng';
const TOKEN_KEY = '@insureportal/auth_token';
const REFRESH_KEY = '@insureportal/refresh_token';

// ── In-memory token cache (P-wave, 2026-09-19) ──────────────────────────────
// Previously every request awaited AsyncStorage.getItem(TOKEN_KEY) in the
// request interceptor — a disk/bridge round-trip on EVERY API call. Tokens
// are now cached in memory (undefined = not yet loaded from storage) and
// synchronously invalidated on logout / refresh / 401-recovery.
// AsyncStorage remains the persistent source of truth across restarts.
let cachedToken: string | null | undefined;
let cachedRefreshToken: string | null | undefined;

export function setCachedTokens(accessToken: string | null, refreshToken?: string | null) {
  cachedToken = accessToken;
  if (refreshToken !== undefined) cachedRefreshToken = refreshToken;
}

export function clearCachedTokens() {
  cachedToken = null;
  cachedRefreshToken = null;
}

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  if (cachedToken === undefined) {
    cachedToken = await AsyncStorage.getItem(TOKEN_KEY); // one-time hydrate
  }
  if (cachedToken && config.headers) {
    config.headers.Authorization = `Bearer ${cachedToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !('_retry' in original)) {
      (original as Record<string, unknown>)._retry = true;
      try {
        if (cachedRefreshToken === undefined) {
          cachedRefreshToken = await AsyncStorage.getItem(REFRESH_KEY);
        }
        const { data } = await axios.post(`${API_BASE}/api/v1/auth/refresh`, { refreshToken: cachedRefreshToken });
        await AsyncStorage.setItem(TOKEN_KEY, data.accessToken);
        await AsyncStorage.setItem(REFRESH_KEY, data.refreshToken);
        setCachedTokens(data.accessToken, data.refreshToken);
        if (original.headers) original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY]);
        clearCachedTokens();
      }
    }
    return Promise.reject(error);
  }
);

export const policyApi = {
  list: () => api.get('/api/v1/policies'),
  getById: (id: string) => api.get(`/api/v1/policies/${id}`),
  renew: (id: string) => api.post(`/api/v1/policies/${id}/renew`),
  getDocuments: (id: string) => api.get(`/api/v1/policies/${id}/documents`),
};

export const claimsApi = {
  list: () => api.get('/api/v1/claims'),
  getById: (id: string) => api.get(`/api/v1/claims/${id}`),
  file: (data: FormData) => api.post('/api/v1/claims', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  addEvidence: (id: string, data: FormData) => api.post(`/api/v1/claims/${id}/evidence`, data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  getTimeline: (id: string) => api.get(`/api/v1/claims/${id}/timeline`),
};

export const premiumApi = {
  calculate: (params: Record<string, unknown>) => api.post('/api/v1/premiums/calculate', params),
  pay: (policyId: string, data: Record<string, unknown>) => api.post(`/api/v1/premiums/${policyId}/pay`, data),
  history: (policyId: string) => api.get(`/api/v1/premiums/${policyId}/history`),
};

export const agentApi = {
  findNearby: (lat: number, lng: number, radius: number) =>
    api.get(`/api/v1/agents/nearby?lat=${lat}&lng=${lng}&radius=${radius}`),
  getProfile: (id: string) => api.get(`/api/v1/agents/${id}`),
};

export const authApi = {
  login: (email: string, password: string) => api.post('/api/v1/auth/login', { email, password }),
  signup: (data: { fullName: string; phone: string; email: string; password: string }) => api.post('/api/v1/auth/register', data),
  loginBiometric: (biometricToken: string) => api.post('/api/v1/auth/biometric', { biometricToken }),
  register: (data: Record<string, string>) => api.post('/api/v1/auth/register', data),
  forgotPassword: (email: string) => api.post('/api/v1/auth/forgot-password', { email }),
  resetPassword: (email: string, otp: string, newPassword: string) => api.post('/api/v1/auth/reset-password', { email, otp, newPassword }),
  validate2FA: (email: string, code: string) => api.post('/api/v1/auth/validate-2fa', { email, code }),
  setup2FA: (userId: string) => api.post('/api/v1/auth/setup-2fa', { userId }),
  getProfile: () => api.get('/api/v1/auth/profile'),
};

// ── Q4 health & retention wave (2026-09-25) ─────────────────────────────────
// tRPC-over-HTTP bindings for the care-app retention layer + claims CX
// upgrades (server: appRouter mounted at /api/trpc, superjson transformer).
// The shared axios instance attaches the member JWT, so these calls run under
// the same member auth as the web portal. Errors propagate honestly — the UI
// must render its error/empty state, never fabricated content.
interface TrpcEnvelope<T> {
  result?: { data?: { json?: T } };
  error?: { message?: string };
}

function unwrap<T>(env: TrpcEnvelope<T>): T {
  if (env.error) throw new Error(env.error.message ?? 'Request failed');
  return env.result?.data?.json as T;
}

export interface WellnessFeedItem {
  id: number;
  title: string;
  body: string;
  category: string;
  locale: string;
  publishedAt: string | null;
}

export const wellnessApi = {
  feed: async (params?: { locale?: string; category?: string; limit?: number; offset?: number }) => {
    const input = encodeURIComponent(JSON.stringify({ json: { locale: 'en', ...params } }));
    const res = await api.get<TrpcEnvelope<{ items: WellnessFeedItem[]; total: number; locale: string }>>(
      `/api/trpc/careRetention.wellnessFeed?input=${input}`,
    );
    return unwrap(res.data);
  },
};

export interface PresignedUpload {
  uploadUrl: string;
  fileKey: string;
  bucket: string;
  expiresIn: number;
  instructions: string;
}

export interface ReimbursementSubmitResult {
  id: number;
  status: string;
  claimId: number | null;
  ocrStatus: string;
  // Disclosed fallback notice when no OCR provider is configured — surface
  // this to the user verbatim; it is NOT an OCR result.
  ocrDisclosure: string | null;
}

export const reimbursementApi = {
  // Step 1 of the EXISTING P-wave presigned flow: authorize + sign only.
  requestUploadUrl: async (input: { fileName: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; fileSize: number }) => {
    const res = await api.post<TrpcEnvelope<PresignedUpload>>(
      '/api/trpc/documentManagement.requestUploadUrl',
      { json: { ...input, purpose: 'claim_document' } },
    );
    return unwrap(res.data);
  },
  // Step 2: PUT bytes directly to object storage at the presigned URL.
  uploadBytes: async (uploadUrl: string, blob: Blob, mimeType: string) => {
    const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: blob });
    if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);
  },
  // Step 3: submit the reimbursement request with the issued file keys.
  submit: async (input: { claimId?: number; documentRefs: string[]; amount: number; description?: string }) => {
    const res = await api.post<TrpcEnvelope<ReimbursementSubmitResult>>(
      '/api/trpc/careRetention.photoReimbursementSubmit',
      { json: input },
    );
    return unwrap(res.data);
  },
};
