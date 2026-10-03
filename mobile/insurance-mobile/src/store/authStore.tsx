import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics from 'react-native-biometrics';
// 2026-10-01 (W9-B3): auth is the real Keycloak OIDC flow now. The old
// authApi.login / loginBiometric / getProfile BFF endpoints never existed
// (insurance-mobile-app/main.go has no /api/v1/auth/* routes — 404).
import { signIn as oidcSignIn, signOut as oidcSignOut, getValidAccessToken, getStoredAccessToken, REFRESH_KEY } from '../services/keycloakAuth';
import { trpcQuery } from '../config';

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
  /** Current Keycloak access token (null when signed out). */
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  biometricEnabled: boolean;
  biometricType: 'fingerprint' | 'face' | 'iris' | null;
}

interface AuthContextType extends AuthState {
  /** Launches the Keycloak login in the system browser (authorization-code
   *  + PKCE). There is no in-app password form by design. */
  login: () => Promise<void>;
  loginWithBiometric: () => Promise<void>;
  logout: () => Promise<void>;
  enableBiometric: () => Promise<boolean>;
  disableBiometric: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

const BIOMETRIC_KEY = '@insureportal/biometric_enabled';
const USER_KEY = '@insureportal/cached_user';

/**
 * 2026-10-01 (W9-B3): map the REAL monolith user row (returned by the
 * mounted auth.me tRPC procedure, server/routers.ts:571) to the mobile User
 * shape. Fields the DB row does not have (phone, kycVerified, profileImage)
 * are left at honest neutral values — never fabricated.
 */
function mapDbUser(dbUser: any): User {
  const fullName: string = typeof dbUser?.name === 'string' ? dbUser.name : '';
  const [firstName, ...rest] = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    id: String(dbUser?.id ?? ''),
    email: dbUser?.email ?? '',
    firstName: firstName ?? '',
    lastName: rest.join(' '),
    phone: dbUser?.phone ?? '',
    role: dbUser?.role === 'admin' || dbUser?.role === 'agent' ? dbUser.role : 'customer',
    kycVerified: dbUser?.kycVerified === true,
    profileImage: dbUser?.profileImage,
  };
}

/** Fetch the signed-in user's profile from the monolith (auth.me). Throws
 *  honestly when the session is not accepted server-side. */
async function fetchProfile(token: string): Promise<User> {
  const dbUser = await trpcQuery<any>('auth.me', null, token);
  if (!dbUser) throw new Error('Session not recognized by the server — please sign in again');
  return mapDbUser(dbUser);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isLoading: true,
    isAuthenticated: false,
    biometricEnabled: false,
    biometricType: null,
  });

  useEffect(() => {
    checkAuth();
    checkBiometricCapability();
  }, []);

  async function checkAuth() {
    try {
      const token = await getStoredAccessToken();
      if (token) {
        // Show the cached profile immediately (real data from a prior
        // session), then revalidate against the server.
        const cachedUser = await AsyncStorage.getItem(USER_KEY);
        if (cachedUser) {
          setState((prev) => ({
            ...prev,
            user: JSON.parse(cachedUser),
            token,
            isAuthenticated: true,
            isLoading: false,
          }));
        }
        try {
          const freshToken = await getValidAccessToken();
          const user = await fetchProfile(freshToken);
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
          setState((prev) => ({ ...prev, user, token: freshToken, isAuthenticated: true, isLoading: false }));
        } catch {
          // 2026-10-01 (W9-B3): if we have no cached user AND the server
          // rejects the session, fail closed — sign the user out rather
          // than presenting a dead session as authenticated.
          if (!cachedUser) {
            setState((prev) => ({ ...prev, user: null, token: null, isAuthenticated: false, isLoading: false }));
          } else {
            setState((prev) => ({ ...prev, isLoading: false }));
          }
        }
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
    if (biometryType === 'FaceID' || (biometryType as string) === 'Face Recognition') type = 'face';
    else if (biometryType === 'TouchID' || biometryType === 'Biometrics') type = 'fingerprint';
    else if (biometryType === 'Iris') type = 'iris';
    setState((prev) => ({ ...prev, biometricEnabled: available && enabled, biometricType: type }));
  }

  const login = useCallback(async () => {
    // Throws honestly on user-cancel or IdP error — the login screen
    // surfaces the message; nothing is swallowed here.
    await oidcSignIn();
    const token = await getValidAccessToken();
    const user = await fetchProfile(token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    setState((prev) => ({ ...prev, user, token, isAuthenticated: true }));
  }, []);

  const loginWithBiometric = useCallback(async () => {
    // 2026-10-01 (W9-B3): the old flow POSTed the biometric signature to a
    // nonexistent BFF endpoint. Biometrics now honestly GATE the local
    // refresh token: a successful biometric prompt unlocks the stored
    // Keycloak session; a server round-trip (auth.me) still revalidates it.
    const refreshToken = await AsyncStorage.getItem(REFRESH_KEY);
    if (!refreshToken) throw new Error('No saved session — sign in with Keycloak first');
    const rnBiometrics = new ReactNativeBiometrics();
    const { success } = await rnBiometrics.simplePrompt({ promptMessage: 'Unlock InsurePortal' });
    if (!success) throw new Error('Biometric authentication failed');
    const token = await getValidAccessToken();
    const user = await fetchProfile(token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    setState((prev) => ({ ...prev, user, token, isAuthenticated: true }));
  }, []);

  const logout = useCallback(async () => {
    await oidcSignOut();
    await AsyncStorage.multiRemove([USER_KEY]);
    setState((prev) => ({ ...prev, user: null, token: null, isAuthenticated: false }));
  }, []);

  const enableBiometric = useCallback(async () => {
    const rnBiometrics = new ReactNativeBiometrics();
    const { available } = await rnBiometrics.isSensorAvailable();
    if (!available) return false;
    await AsyncStorage.setItem(BIOMETRIC_KEY, 'true');
    setState((prev) => ({ ...prev, biometricEnabled: true }));
    return true;
  }, []);

  const disableBiometric = useCallback(async () => {
    await AsyncStorage.setItem(BIOMETRIC_KEY, 'false');
    setState((prev) => ({ ...prev, biometricEnabled: false }));
  }, []);

  const refreshProfile = useCallback(async () => {
    const token = await getValidAccessToken();
    const user = await fetchProfile(token);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    setState((prev) => ({ ...prev, user, token }));
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, loginWithBiometric, logout, enableBiometric, disableBiometric, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
