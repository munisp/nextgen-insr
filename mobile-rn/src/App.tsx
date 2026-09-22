/**
 * InsurePortal Nigerian Remittance — React Native App Entry
 * Full navigation setup with all 40 screens registered.
 *
 * 2026-09-19 (P-wave perf):
 *  - Screens are registered lazily via `getComponent` so each screen module
 *    (and its dependency tree) is evaluated on first navigation instead of
 *    during cold start. Previously ~40 screens + deps were imported eagerly
 *    at module load, dominating JS parse/exec time on mid-range devices.
 *  - PERF-BLOCKER: 25 of the routes referenced below import screens that DO
 *    NOT EXIST in mobile-rn/src/screens (LoginScreen, RegisterScreen,
 *    OnboardingScreen, DashboardScreen, WalletScreen, TransactionsScreen,
 *    TransactionDetailScreen, ProfileScreen, NotificationsScreen,
 *    HelpScreen, SupportScreen, ReceiveMoneyScreen, ExchangeRatesScreen,
 *    RateCalculatorScreen, BeneficiariesScreen, BeneficiaryListScreen,
 *    BeneficiaryManagementScreen, CardsScreen, KYCScreen,
 *    AgentPerformanceScreen, CustomerWalletScreen,
 *    NotificationPreferencesScreen, MultiCurrencyScreen,
 *    ComplianceSchedulingScreen, AuditExportScreen). Any reference to them —
 *    even a lazy require — fails the Metro bundle, so those routes are NOT
 *    registered. They must be restored/implemented before this app can ship;
 *    until then the app boots into MissingModuleScreen (honest placeholder,
 *    not a fabricated feature). Only the 19 screens that exist are
 *    registered below.
 */
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { ActivityIndicator, View, Text, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Type definitions ──────────────────────────────────────────────────────────
// (Routes for not-yet-implemented screens are kept as types only — types are
// erased at compile time and cost nothing at runtime.)
export type RootStackParamList = {
  Onboarding: undefined;
  Login: undefined;
  Register: undefined;
  PinSetup: { isReset?: boolean };
  BiometricSetup: undefined;
  BiometricAuth: { onSuccess: () => void };
  Dashboard: undefined;
  Wallet: undefined;
  Transactions: undefined;
  TransactionHistory: undefined;
  TransactionDetail: { transactionId: string };
  TransactionDetails: { transactionId: string };
  TransferTracking: { transactionId: string };
  Profile: undefined;
  Settings: undefined;
  Notifications: undefined;
  Help: undefined;
  Support: undefined;
  SendMoney: { beneficiaryId?: string };
  ReceiveMoney: undefined;
  QRCodeScanner: { onScan?: (data: string) => void };
  ExchangeRates: undefined;
  RateCalculator: undefined;
  RateLock: { fromCurrency: string; toCurrency: string; amount: number };
  PaymentMethods: undefined;
  PaymentRetry: { transactionId: string };
  Beneficiaries: undefined;
  BeneficiaryList: undefined;
  BeneficiaryManagement: undefined;
  AddBeneficiary: undefined;
  Cards: undefined;
  VirtualCard: { cardId?: string };
  SavingsGoals: undefined;
  RecurringPayments: undefined;
  ReferralProgram: undefined;
  KYC: undefined;
  KYCVerification: { documentType: string };
  SecuritySettings: undefined;
  AgentPerformance: undefined;
  CustomerWallet: undefined;
  NotificationPreferences: undefined;
  MultiCurrency: undefined;
  ComplianceScheduling: undefined;
  AuditExport: undefined;
  Boot: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

const AUTH_TOKEN_KEY = 'jwt_token';

// ── Loading screen ────────────────────────────────────────────────────────────
function SplashScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' }}>
      <ActivityIndicator size="large" color="#3b82f6" />
    </View>
  );
}

// ── Honest placeholder for the not-yet-implemented auth/dashboard flow ──────
// The Login/Onboarding/Dashboard screens are absent from the repo (see the
// PERF-BLOCKER note above); rather than fabricate them, the app says so.
function MissingModuleScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a', padding: 32 }}>
      <Text style={{ color: '#f8fafc', fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 12 }}>
        InsurePortal Remittance
      </Text>
      <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center' }}>
        This build is incomplete: the onboarding, login and dashboard modules
        are missing from the repository. Please restore those screens before
        shipping.
      </Text>
    </View>
  );
}

// ── Root navigator ────────────────────────────────────────────────────────────
export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
      setIsAuthenticated(!!token);
    } catch {
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <SplashScreen />;

  // The previous initial routes (Dashboard / Onboarding) reference screens
  // that do not exist; authenticated users land on TransactionHistory (an
  // existing screen) until the missing modules are restored.
  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <Stack.Navigator
        initialRouteName={isAuthenticated ? 'TransactionHistory' : 'Boot'}
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#f8fafc',
          headerTitleStyle: { fontWeight: '600' },
          cardStyle: { backgroundColor: '#0f172a' },
        }}
      >
        <Stack.Screen name="Boot" component={MissingModuleScreen} options={{ headerShown: false }} />

        {/* ── Existing screens, lazily registered (module eval deferred) ── */}
        <Stack.Screen name="PinSetup" getComponent={() => require('./screens/PinSetupScreen').default} options={{ title: 'Set PIN' }} />
        <Stack.Screen name="BiometricSetup" getComponent={() => require('./screens/BiometricSetupScreen').default} options={{ title: 'Enable Biometrics' }} />
        <Stack.Screen name="BiometricAuth" getComponent={() => require('./screens/BiometricAuthScreen').default} options={{ headerShown: false }} />
        <Stack.Screen name="TransactionHistory" getComponent={() => require('./screens/TransactionHistoryScreen').default} options={{ title: 'History' }} />
        <Stack.Screen name="TransactionDetails" getComponent={() => require('./screens/TransactionDetailsScreen').default} options={{ title: 'Details' }} />
        <Stack.Screen name="TransferTracking" getComponent={() => require('./screens/TransferTrackingScreen').default} options={{ title: 'Track Transfer' }} />
        <Stack.Screen name="Settings" getComponent={() => require('./screens/SettingsScreen').default} options={{ title: 'Settings' }} />
        <Stack.Screen name="SendMoney" getComponent={() => require('./screens/SendMoneyScreen').default} options={{ title: 'Send Money' }} />
        <Stack.Screen name="QRCodeScanner" getComponent={() => require('./screens/QRCodeScannerScreen').default} options={{ title: 'Scan QR' }} />
        <Stack.Screen name="RateLock" getComponent={() => require('./screens/RateLockScreen').default} options={{ title: 'Lock Rate' }} />
        <Stack.Screen name="PaymentMethods" getComponent={() => require('./screens/PaymentMethodsScreen').default} options={{ title: 'Payment Methods' }} />
        <Stack.Screen name="PaymentRetry" getComponent={() => require('./screens/PaymentRetryScreen').default} options={{ title: 'Retry Payment' }} />
        <Stack.Screen name="AddBeneficiary" getComponent={() => require('./screens/AddBeneficiaryScreen').default} options={{ title: 'Add Beneficiary' }} />
        <Stack.Screen name="VirtualCard" getComponent={() => require('./screens/VirtualCardScreen').default} options={{ title: 'Virtual Card' }} />
        <Stack.Screen name="SavingsGoals" getComponent={() => require('./screens/SavingsGoalsScreen').default} options={{ title: 'Savings Goals' }} />
        <Stack.Screen name="RecurringPayments" getComponent={() => require('./screens/RecurringPaymentsScreen').default} options={{ title: 'Recurring Payments' }} />
        <Stack.Screen name="ReferralProgram" getComponent={() => require('./screens/ReferralProgramScreen').default} options={{ title: 'Refer & Earn' }} />
        <Stack.Screen name="KYCVerification" getComponent={() => require('./screens/KYCVerificationScreen').default} options={{ title: 'Document Verification' }} />
        <Stack.Screen name="SecuritySettings" getComponent={() => require('./screens/SecuritySettingsScreen').default} options={{ title: 'Security' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
