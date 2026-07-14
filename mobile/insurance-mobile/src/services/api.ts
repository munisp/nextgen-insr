import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE = process.env.API_URL || 'https://api.insureportal.ng';
const TOKEN_KEY = '@insureportal/auth_token';
const REFRESH_KEY = '@insureportal/refresh_token';

// Certificate pinning domains — all production endpoints must be pinned.
// The native module (react-native-ssl-pinning or TrustKit) must be configured
// in the native iOS/Android projects with SHA-256 leaf certificate hashes for:
//   - api.insureportal.ng
//   - auth.insureportal.ng
//   - api.54link.ng
//   - staging.54link.ng
// Pin rotation: include both current and next certificate hashes.
export const PINNED_DOMAINS = [
  'api.insureportal.ng',
  'auth.insureportal.ng',
  'api.54link.ng',
  'staging.54link.ng',
] as const;

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
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
        const refreshToken = await AsyncStorage.getItem(REFRESH_KEY);
        const { data } = await axios.post(`${API_BASE}/api/v1/auth/refresh`, { refreshToken });
        await AsyncStorage.setItem(TOKEN_KEY, data.accessToken);
        await AsyncStorage.setItem(REFRESH_KEY, data.refreshToken);
        if (original.headers) original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY]);
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
  loginBiometric: (biometricToken: string) => api.post('/api/v1/auth/biometric', { biometricToken }),
  register: (data: Record<string, string>) => api.post('/api/v1/auth/register', data),
  forgotPassword: (email: string) => api.post('/api/v1/auth/forgot-password', { email }),
  getProfile: () => api.get('/api/v1/auth/profile'),
};
