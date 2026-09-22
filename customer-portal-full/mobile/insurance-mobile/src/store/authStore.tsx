import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics from 'react-native-biometrics';
import { authApi, setCachedTokens, clearCachedTokens } from '../services/api';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: 'customer' | 'agent' | 'admin';
  kycVerified: boolean;
  profileImage?: string;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  biometricEnabled: boolean;
  biometricType: 'fingerprint' | 'face' | 'iris' | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  signup: (data: { fullName: string; phone: string; email: string; password: string }) => Promise<void>;
  verify2FA: (email: string, code: string) => Promise<void>;
  loginWithBiometric: () => Promise<void>;
  logout: () => Promise<void>;
  enableBiometric: () => Promise<boolean>;
  disableBiometric: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  kycPassed: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = '@insureportal/auth_token';
const REFRESH_KEY = '@insureportal/refresh_token';
const BIOMETRIC_KEY = '@insureportal/biometric_enabled';
const USER_KEY = '@insureportal/cached_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    biometricEnabled: false,
    biometricType: null,
  });

  useEffect(() => {
    checkAuth();
    // Biometric sensor check deferred: it must not gate first paint.
    // (P-wave, 2026-09-19)
    checkBiometricCapability();
  }, []);

  async function checkAuth() {
    try {
      // 2026-09-19 (P-wave): parallel storage reads instead of a sequential
      // waterfall, and first paint is gated ONLY on local storage — the
      // profile refresh runs in the background and never holds up isLoading.
      const [token, cachedUser] = await Promise.all([
        AsyncStorage.getItem(TOKEN_KEY),
        AsyncStorage.getItem(USER_KEY),
      ]);
      setCachedTokens(token);
      if (token) {
        const user = cachedUser ? JSON.parse(cachedUser) : null;
        // Render the cached user immediately; refresh in background.
        setState((prev) => ({
          ...prev,
          user,
          isAuthenticated: true,
          isLoading: false,
        }));
        authApi.getProfile()
          .then(async ({ data }) => {
            await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
            setState((prev) => ({ ...prev, user: data.user, isAuthenticated: true }));
          })
          .catch(() => { /* offline/stale profile: cached user stays */ });
      } else {
        setState((prev) => ({ ...prev, isLoading: false }));
      }
    } catch {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }

  async function checkBiometricCapability() {
    const rnBiometrics = new ReactNativeBiometrics();
    const { available, biometryType } = await rnBiometrics.isSensorAvailable();
    const enabled = (await AsyncStorage.getItem(BIOMETRIC_KEY)) === 'true';
    let type: AuthState['biometricType'] = null;
    if (biometryType === 'FaceID' || biometryType === 'Face Recognition') type = 'face';
    else if (biometryType === 'TouchID' || biometryType === 'Biometrics') type = 'fingerprint';
    else if (biometryType === 'Iris') type = 'iris';
    setState((prev) => ({ ...prev, biometricEnabled: available && enabled, biometricType: type }));
  }

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await authApi.login(email, password);
    await AsyncStorage.setItem(TOKEN_KEY, data.accessToken);
    await AsyncStorage.setItem(REFRESH_KEY, data.refreshToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setCachedTokens(data.accessToken, data.refreshToken);
    setState((prev) => ({ ...prev, user: data.user, isAuthenticated: true }));
  }, []);

  const loginWithBiometric = useCallback(async () => {
    const rnBiometrics = new ReactNativeBiometrics();
    const { success, signature } = await rnBiometrics.createSignature({
      promptMessage: 'Sign in to InsurePortal',
      // J-wave (2026-09): auth payload was bare ms — CSPRNG body.
      payload: `insureportal-auth-${Date.now().toString(36).toUpperCase()}-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`,
    });
    if (!success) throw new Error('Biometric authentication failed');
    const { data } = await authApi.loginBiometric(signature);
    await AsyncStorage.setItem(TOKEN_KEY, data.accessToken);
    await AsyncStorage.setItem(REFRESH_KEY, data.refreshToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setCachedTokens(data.accessToken, data.refreshToken);
    setState((prev) => ({ ...prev, user: data.user, isAuthenticated: true }));
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, REFRESH_KEY, USER_KEY]);
    clearCachedTokens();
    setState((prev) => ({ ...prev, user: null, isAuthenticated: false }));
  }, []);

  const enableBiometric = useCallback(async () => {
    const rnBiometrics = new ReactNativeBiometrics();
    const { publicKey } = await rnBiometrics.createKeys();
    if (!publicKey) return false;
    await AsyncStorage.setItem(BIOMETRIC_KEY, 'true');
    setState((prev) => ({ ...prev, biometricEnabled: true }));
    return true;
  }, []);

  const disableBiometric = useCallback(async () => {
    const rnBiometrics = new ReactNativeBiometrics();
    await rnBiometrics.deleteKeys();
    await AsyncStorage.setItem(BIOMETRIC_KEY, 'false');
    setState((prev) => ({ ...prev, biometricEnabled: false }));
  }, []);

  const signup = useCallback(async (input: { fullName: string; phone: string; email: string; password: string }) => {
    const { data } = await authApi.signup(input);
    if (data.error) throw new Error(data.error);
    await AsyncStorage.setItem(TOKEN_KEY, data.token || data.accessToken);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data));
    setCachedTokens(data.token || data.accessToken);
    setState((prev) => ({ ...prev, user: data, isAuthenticated: true }));
  }, []);

  const verify2FA = useCallback(async (email: string, code: string) => {
    const { data } = await authApi.validate2FA(email, code);
    if (data.error) throw new Error(data.error);
    // After 2FA validation, complete login
    setState((prev) => ({ ...prev, isAuthenticated: true }));
  }, []);

  const refreshProfile = useCallback(async () => {
    const { data } = await authApi.getProfile();
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setState((prev) => ({ ...prev, user: data.user }));
  }, []);

  const kycPassed = state.user?.kycVerified ?? (state.user as any)?.kycPassed ?? true;

  // 2026-09-19 (P-wave): memoize the context value. Previously a fresh
  // object every render re-rendered every consumer (the whole app tree) on
  // any auth-state tick.
  const value = useMemo<AuthContextType>(() => ({
    ...state,
    login,
    signup,
    verify2FA,
    loginWithBiometric,
    logout,
    enableBiometric,
    disableBiometric,
    refreshProfile,
    kycPassed,
  }), [state, login, signup, verify2FA, loginWithBiometric, logout, enableBiometric, disableBiometric, refreshProfile, kycPassed]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
