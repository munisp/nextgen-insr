import axios, { AxiosInstance, AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage'; // Common storage for RN

// --- Configuration ---
const API_BASE_URL = 'https://api.insureportal.io/cdp/v1';
const AUTH_TOKEN_KEY = '@CdpAuth:Token';
const REFRESH_TOKEN_KEY = '@CdpAuth:RefreshToken';

// --- Type Definitions for Request/Response Payloads ---

/**
 * Interface for the stored authentication tokens.
 */
interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Interface for a successful API response.
 * @template T The type of the data payload.
 */
interface ApiResponse<T> {
  success: true;
  data: T;
}

/**
 * Interface for an error API response.
 */
interface ApiErrorResponse {
  success: false;
  message: string;
  code?: string;
  details?: any;
}

/**
 * Type for all possible API responses.
 * @template T The type of the data payload for success.
 */
type ServiceResponse<T> = ApiResponse<T> | ApiErrorResponse;

// --- Authentication Payloads ---

interface SendOtpRequest {
  email: string;
}

interface VerifyOtpRequest {
  email: string;
  otp: string;
}

interface AuthSuccessResponse {
  accessToken: string;
  refreshToken: string;
  userId: string;
  walletCreated: boolean;
}

interface WalletCreationResponse {
  walletId: string;
  message: string;
}

// --- CDP Authentication Service Class ---

/**
 * A production-ready service class for handling all CDP authentication,
 * session management, and wallet creation logic in a React Native application.
 * It uses Axios for HTTP requests and AsyncStorage for secure token storage.
 */
export class CdpAuthService {
  private api: AxiosInstance;

  constructor() {
    // 1. Initialize Axios instance with base URL and interceptors
    this.api = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 15000, // 15 seconds timeout
    });

    // 2. Setup request interceptor to attach access token
    this.api.interceptors.request.use(
      async (config) => {
        const tokens = await this.getTokens();
        if (tokens?.accessToken) {
          config.headers.Authorization = `Bearer ${tokens.accessToken}`;
        }
        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // 3. Setup response interceptor for automatic token refresh
    this.api.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config;
        // Check for 401 Unauthorized and ensure it's not a refresh token request loop
        if (error.response?.status === 401 && originalRequest && !(originalRequest as any)._retry) {
          (originalRequest as any)._retry = true; // Mark request as retried
          try {
            const newTokens = await this.refreshSession();
            if (newTokens) {
              // Update the Authorization header for the original request
              originalRequest.headers.Authorization = `Bearer ${newTokens.accessToken}`;
              // Re-run the original request with the new token
              return this.api(originalRequest);
            }
          } catch (refreshError) {
            // If refresh fails, clear session and force logout
            console.error('Token refresh failed, logging out:', refreshError);
            await this.clearSession();
            // Optionally, emit an event to notify the app to navigate to login screen
            // E.g., EventBus.emit('sessionExpired');
            return Promise.reject(refreshError);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // --- Utility Methods for Token Storage ---

  /**
   * Securely stores the access and refresh tokens.
   * @param tokens The tokens to store.
   */
  private async saveTokens(tokens: AuthTokens): Promise<void> {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, tokens.accessToken);
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  }

  /**
   * Retrieves the stored access and refresh tokens.
   * @returns A promise that resolves to the tokens or null if not found.
   */
  public async getTokens(): Promise<AuthTokens | null> {
    const accessToken = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
    const refreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
    if (accessToken && refreshToken) {
      return { accessToken, refreshToken };
    }
    return null;
  }

  /**
   * Clears all stored session tokens.
   */
  public async clearSession(): Promise<void> {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  /**
   * Checks if a user is currently logged in (has valid tokens).
   * @returns A promise that resolves to true if logged in, false otherwise.
   */
  public async isLoggedIn(): Promise<boolean> {
    const tokens = await this.getTokens();
    // In a real app, you might also want to check token expiry here
    return !!tokens?.accessToken;
  }

  // --- Core Authentication Methods ---

  /**
   * Sends an OTP to the user's email for login or registration.
   * @param email The user's email address.
   * @returns A service response indicating success or failure.
   */
  public async sendOtp(email: string): Promise<ServiceResponse<{ message: string }>> {
    if (!email) {
      return { success: false, message: 'Email is required for OTP request.' };
    }
    try {
      const response = await this.api.post<ApiResponse<{ message: string }>>('/auth/otp/send', { email } as SendOtpRequest);
      return response.data;
    } catch (error) {
      return this.handleApiError(error, 'Failed to send OTP.');
    }
  }

  /**
   * Verifies the OTP and completes the login/registration process.
   * On success, it saves the session tokens.
   * @param email The user's email address.
   * @param otp The one-time password received by the user.
   * @returns A service response with auth details on success.
   */
  public async verifyOtp(email: string, otp: string): Promise<ServiceResponse<AuthSuccessResponse>> {
    if (!email || !otp) {
      return { success: false, message: 'Email and OTP are required for verification.' };
    }
    try {
      const response = await this.api.post<ApiResponse<AuthSuccessResponse>>('/auth/otp/verify', { email, otp } as VerifyOtpRequest);
      
      // Save the new tokens for session management
      await this.saveTokens({
        accessToken: response.data.data.accessToken,
        refreshToken: response.data.data.refreshToken,
      });

      return response.data;
    } catch (error) {
      return this.handleApiError(error, 'OTP verification failed.');
    }
  }

  /**
   * Logs the user out by invalidating the session on the server and clearing local storage.
   * @returns A service response indicating success or failure.
   */
  public async logout(): Promise<ServiceResponse<{ message: string }>> {
    try {
      // Attempt to invalidate session on the backend
      await this.api.post('/auth/logout');
      // Clear local storage regardless of backend success for a clean client state
      await this.clearSession();
      return { success: true, data: { message: 'Logged out successfully.' } };
    } catch (error) {
      // Even if the backend call fails (e.g., token already expired), we clear local storage
      await this.clearSession();
      // We can still return a success for the client-side action
      return { success: true, data: { message: 'Logged out successfully (server response ignored).' } };
    }
  }

  /**
   * Attempts to refresh the access token using the stored refresh token.
   * This is typically called by the interceptor on a 401 error.
   * @returns A promise that resolves to the new tokens or null on failure.
   */
  private async refreshSession(): Promise<AuthTokens | null> {
    const tokens = await this.getTokens();
    if (!tokens?.refreshToken) {
      return null;
    }

    try {
      const response = await this.api.post<ApiResponse<AuthSuccessResponse>>('/auth/token/refresh', {
        refreshToken: tokens.refreshToken,
      });

      const newTokens: AuthTokens = {
        accessToken: response.data.data.accessToken,
        refreshToken: response.data.data.refreshToken,
      };

      await this.saveTokens(newTokens);
      return newTokens;
    } catch (error) {
      // Refresh failed, clear session and return null to trigger logout flow
      await this.clearSession();
      return null;
    }
  }

  // --- Wallet Management Method ---

  /**
   * Creates a new wallet for the authenticated user.
   * Requires a valid access token to be present in the session.
   * @returns A service response with wallet details on success.
   */
  public async createWallet(): Promise<ServiceResponse<WalletCreationResponse>> {
    if (!(await this.isLoggedIn())) {
      return { success: false, message: 'User not authenticated. Please log in first.' };
    }
    try {
      const response = await this.api.post<ApiResponse<WalletCreationResponse>>('/wallet/create', {});
      return response.data;
    } catch (error) {
      return this.handleApiError(error, 'Failed to create wallet.');
    }
  }

  // --- Error Handling Utility ---

  /**
   * Standardized error handler for Axios errors.
   * @param error The error object from the Axios call.
   * @param defaultMessage A fallback message if the error structure is unexpected.
   * @returns A standardized ApiErrorResponse object.
   */
  private handleApiError(error: unknown, defaultMessage: string): ApiErrorResponse {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status;
      const data = error.response.data as any;

      // Check for a standardized error response from the backend
      if (data && data.message) {
        return {
          success: false,
          message: data.message,
          code: data.code,
          details: data.details,
        };
      }

      // Handle common HTTP error statuses
      switch (status) {
        case 400:
          return { success: false, message: data.message || 'Bad Request: Invalid input data.' };
        case 401:
          return { success: false, message: 'Unauthorized: Invalid or expired token.' };
        case 403:
          return { success: false, message: 'Forbidden: You do not have permission to perform this action.' };
        case 404:
          return { success: false, message: 'Not Found: The requested resource does not exist.' };
        case 500:
          return { success: false, message: 'Server Error: An unexpected error occurred on the server.' };
        default:
          return { success: false, message: `API Error (${status}): ${data.message || defaultMessage}` };
      }
    } else if (axios.isAxiosError(error) && error.request) {
      // The request was made but no response was received (e.g., network error, timeout)
      return { success: false, message: 'Network Error: Could not connect to the server.' };
    } else if (error instanceof Error) {
      // A non-Axios error (e.g., in token storage)
      return { success: false, message: `Local Error: ${error.message}` };
    } else {
      // Unknown error
      return { success: false, message: defaultMessage };
    }
  }
}

// --- Example Usage (for demonstration, not part of the service class) ---
/*
// To use this service:
// 1. Install dependencies:
//    pnpm add axios @react-native-async-storage/async-storage
// 2. Import and instantiate:
//    const cdpAuthService = new CdpAuthService();

// Example flow:
async function handleLogin() {
  // 1. Send OTP
  const sendResult = await cdpAuthService.sendOtp('agent@insureportal.io');
  if (!sendResult.success) {
    console.error('Send OTP failed:', sendResult.message);
    return;
  }
  console.log('OTP sent successfully.');

  // 2. Verify OTP (assuming user enters '123456')
  const verifyResult = await cdpAuthService.verifyOtp('agent@insureportal.io', '123456');
  if (!verifyResult.success) {
    console.error('Verify OTP failed:', verifyResult.message);
    return;
  }
  console.log('Login successful. User ID:', verifyResult.data.userId);

  // 3. Check if wallet needs creation
  if (!verifyResult.data.walletCreated) {
    console.log('Wallet not found, creating...');
    const walletResult = await cdpAuthService.createWallet();
    if (walletResult.success) {
      console.log('Wallet created:', walletResult.data.walletId);
    } else {
      console.error('Wallet creation failed:', walletResult.message);
    }
  }

  // 4. Logout
  // await cdpAuthService.logout();
}
*/