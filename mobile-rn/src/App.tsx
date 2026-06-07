/**
 * InsurePortal Nigerian Remittance — React Native App Entry
 * Full navigation setup with all 40 screens registered.
 */
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { ActivityIndicator, View, StatusBar } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Auth Screens ──────────────────────────────────────────────────────────────
import LoginScreen from './screens/LoginScreen';
import RegisterScreen from './screens/RegisterScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import PinSetupScreen from './screens/PinSetupScreen';
import BiometricSetupScreen from './screens/BiometricSetupScreen';
import BiometricAuthScreen from './screens/BiometricAuthScreen';

// ── Main Screens ──────────────────────────────────────────────────────────────
import DashboardScreen from './screens/DashboardScreen';
import WalletScreen from './screens/WalletScreen';
import TransactionsScreen from './screens/TransactionsScreen';
import TransactionHistoryScreen from './screens/TransactionHistoryScreen';
import TransactionDetailScreen from './screens/TransactionDetailScreen';
import TransactionDetailsScreen from './screens/TransactionDetailsScreen';
import TransferTrackingScreen from './screens/TransferTrackingScreen';
import ProfileScreen from './screens/ProfileScreen';
import SettingsScreen from './screens/SettingsScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import HelpScreen from './screens/HelpScreen';
import SupportScreen from './screens/SupportScreen';

// ── Money Movement ────────────────────────────────────────────────────────────
import SendMoneyScreen from './screens/SendMoneyScreen';
import ReceiveMoneyScreen from './screens/ReceiveMoneyScreen';
import QRCodeScannerScreen from './screens/QRCodeScannerScreen';
import ExchangeRatesScreen from './screens/ExchangeRatesScreen';
import RateCalculatorScreen from './screens/RateCalculatorScreen';
import RateLockScreen from './screens/RateLockScreen';
import PaymentMethodsScreen from './screens/PaymentMethodsScreen';
import PaymentRetryScreen from './screens/PaymentRetryScreen';

// ── Beneficiaries ─────────────────────────────────────────────────────────────
import BeneficiariesScreen from './screens/BeneficiariesScreen';
import BeneficiaryListScreen from './screens/BeneficiaryListScreen';
import BeneficiaryManagementScreen from './screens/BeneficiaryManagementScreen';
import AddBeneficiaryScreen from './screens/AddBeneficiaryScreen';

// ── Financial Products ────────────────────────────────────────────────────────
import CardsScreen from './screens/CardsScreen';
import VirtualCardScreen from './screens/VirtualCardScreen';
import SavingsGoalsScreen from './screens/SavingsGoalsScreen';
import RecurringPaymentsScreen from './screens/RecurringPaymentsScreen';
import ReferralProgramScreen from './screens/ReferralProgramScreen';

/// ── Compliance ────────────────────────────────────────────────────────────
import KYCScreen from './screens/KYCScreen';
import KYCVerificationScreen from './screens/KYCVerificationScreen';
import SecuritySettingsScreen from './screens/SecuritySettingsScreen';

// ── Mobile Parity (12 new screens) ───────────────────────────────────────
import AgentPerformanceScreen from './screens/AgentPerformanceScreen';
import CustomerWalletScreen from './screens/CustomerWalletScreen';
import NotificationPreferencesScreen from './screens/NotificationPreferencesScreen';
import MultiCurrencyScreen from './screens/MultiCurrencyScreen';
import ComplianceSchedulingScreen from './screens/ComplianceSchedulingScreen';
import AuditExportScreen from './screens/AuditExportScreen';

// ── Type definitions ──────────────────────────────────────────────────────────
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

  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <Stack.Navigator
        initialRouteName={isAuthenticated ? 'Dashboard' : 'Onboarding'}
        screenOptions={{
          headerStyle: { backgroundColor: '#0f172a' },
          headerTintColor: '#f8fafc',
          headerTitleStyle: { fontWeight: '600' },
          cardStyle: { backgroundColor: '#0f172a' },
        }}
      >
        {/* ── Auth flow ─────────────────────────────────────────────────── */}
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Create Account' }} />
        <Stack.Screen name="PinSetup" component={PinSetupScreen} options={{ title: 'Set PIN' }} />
        <Stack.Screen name="BiometricSetup" component={BiometricSetupScreen} options={{ title: 'Enable Biometrics' }} />
        <Stack.Screen name="BiometricAuth" component={BiometricAuthScreen} options={{ headerShown: false }} />

        {/* ── Main app ──────────────────────────────────────────────────── */}
        <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Wallet" component={WalletScreen} options={{ title: 'My Wallet' }} />
        <Stack.Screen name="Transactions" component={TransactionsScreen} options={{ title: 'Transactions' }} />
        <Stack.Screen name="TransactionHistory" component={TransactionHistoryScreen} options={{ title: 'History' }} />
        <Stack.Screen name="TransactionDetail" component={TransactionDetailScreen} options={{ title: 'Transaction' }} />
        <Stack.Screen name="TransactionDetails" component={TransactionDetailsScreen} options={{ title: 'Details' }} />
        <Stack.Screen name="TransferTracking" component={TransferTrackingScreen} options={{ title: 'Track Transfer' }} />
        <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'My Profile' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'Notifications' }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'Help & FAQ' }} />
        <Stack.Screen name="Support" component={SupportScreen} options={{ title: 'Support' }} />

        {/* ── Money movement ────────────────────────────────────────────── */}
        <Stack.Screen name="SendMoney" component={SendMoneyScreen} options={{ title: 'Send Money' }} />
        <Stack.Screen name="ReceiveMoney" component={ReceiveMoneyScreen} options={{ title: 'Receive Money' }} />
        <Stack.Screen name="QRCodeScanner" component={QRCodeScannerScreen} options={{ title: 'Scan QR' }} />
        <Stack.Screen name="ExchangeRates" component={ExchangeRatesScreen} options={{ title: 'Exchange Rates' }} />
        <Stack.Screen name="RateCalculator" component={RateCalculatorScreen} options={{ title: 'Rate Calculator' }} />
        <Stack.Screen name="RateLock" component={RateLockScreen} options={{ title: 'Lock Rate' }} />
        <Stack.Screen name="PaymentMethods" component={PaymentMethodsScreen} options={{ title: 'Payment Methods' }} />
        <Stack.Screen name="PaymentRetry" component={PaymentRetryScreen} options={{ title: 'Retry Payment' }} />

        {/* ── Beneficiaries ─────────────────────────────────────────────── */}
        <Stack.Screen name="Beneficiaries" component={BeneficiariesScreen} options={{ title: 'Beneficiaries' }} />
        <Stack.Screen name="BeneficiaryList" component={BeneficiaryListScreen} options={{ title: 'My Beneficiaries' }} />
        <Stack.Screen name="BeneficiaryManagement" component={BeneficiaryManagementScreen} options={{ title: 'Manage Beneficiaries' }} />
        <Stack.Screen name="AddBeneficiary" component={AddBeneficiaryScreen} options={{ title: 'Add Beneficiary' }} />

        {/* ── Financial products ────────────────────────────────────────── */}
        <Stack.Screen name="Cards" component={CardsScreen} options={{ title: 'My Cards' }} />
        <Stack.Screen name="VirtualCard" component={VirtualCardScreen} options={{ title: 'Virtual Card' }} />
        <Stack.Screen name="SavingsGoals" component={SavingsGoalsScreen} options={{ title: 'Savings Goals' }} />
        <Stack.Screen name="RecurringPayments" component={RecurringPaymentsScreen} options={{ title: 'Recurring Payments' }} />
        <Stack.Screen name="ReferralProgram" component={ReferralProgramScreen} options={{ title: 'Refer & Earn' }} />

        {/* ── Compliance ────────────────────────────────────────────────── */}
        <Stack.Screen name="KYC" component={KYCScreen} options={{ title: 'Verify Identity' }} />
        <Stack.Screen name="KYCVerification" component={KYCVerificationScreen} options={{ title: 'Document Verification' }} />
        <Stack.Screen name="SecuritySettings" component={SecuritySettingsScreen} options={{ title: 'Security' }} />

        {/* ── Mobile Parity ─────────────────────────────────────────────── */}
        <Stack.Screen name="AgentPerformance" component={AgentPerformanceScreen} options={{ title: 'Agent Performance' }} />
        <Stack.Screen name="CustomerWallet" component={CustomerWalletScreen} options={{ title: 'Customer Wallet' }} />
        <Stack.Screen name="NotificationPreferences" component={NotificationPreferencesScreen} options={{ title: 'Notification Preferences' }} />
        <Stack.Screen name="MultiCurrency" component={MultiCurrencyScreen} options={{ title: 'Multi-Currency' }} />
        <Stack.Screen name="ComplianceScheduling" component={ComplianceSchedulingScreen} options={{ title: 'Compliance Scheduling' }} />
        <Stack.Screen name="AuditExport" component={AuditExportScreen} options={{ title: 'Audit Export' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
