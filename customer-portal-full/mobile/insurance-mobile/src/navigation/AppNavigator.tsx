import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../store/authStore';
import { DashboardScreen } from '../screens/DashboardScreen';
import { PoliciesScreen } from '../screens/PoliciesScreen';
import { PolicyDetailScreen } from '../screens/PolicyDetailScreen';
import { ClaimsScreen } from '../screens/ClaimsScreen';
import { FileClaimScreen } from '../screens/FileClaimScreen';
import { ClaimDetailScreen } from '../screens/ClaimDetailScreen';
import { PaymentsScreen } from '../screens/PaymentsScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { SignupScreen } from '../screens/SignupScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { TwoFactorScreen } from '../screens/TwoFactorScreen';
import { KYCScreen } from '../screens/KYCScreen';
import { AgentLocatorScreen } from '../screens/AgentLocatorScreen';
import { EmergencyScreen } from '../screens/EmergencyScreen';
import { InsuranceMarketplaceScreen } from '../screens/InsuranceMarketplaceScreen';
import { SecuritySettingsScreen } from '../screens/SecuritySettingsScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import WalletScreen from '../screens/WalletScreen';
import SupportScreen from '../screens/SupportScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import ReferralScreen from '../screens/ReferralScreen';
import DocumentsScreen from '../screens/DocumentsScreen';
import ChatbotScreen from '../screens/ChatbotScreen';
import ClaimsTrackerScreen from '../screens/ClaimsTrackerScreen';
import QuoteScreen from '../screens/QuoteScreen';
import BeneficiariesScreen from '../screens/BeneficiariesScreen';
import RenewPolicyScreen from '../screens/RenewPolicyScreen';
import CommunicationScreen from '../screens/CommunicationScreen';
import InsuranceScoreScreen from '../screens/InsuranceScoreScreen';
import NearbyHospitalsScreen from '../screens/NearbyHospitalsScreen';
import RewardsScreen from '../screens/RewardsScreen';
import { OfflineIndicator } from '../components/OfflineIndicator';
import { View } from 'react-native';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function PoliciesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PoliciesList" component={PoliciesScreen} />
      <Stack.Screen name="PolicyDetail" component={PolicyDetailScreen} />
    </Stack.Navigator>
  );
}

function ClaimsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ClaimsList" component={ClaimsScreen} />
      <Stack.Screen name="FileClaim" component={FileClaimScreen} />
      <Stack.Screen name="ClaimDetail" component={ClaimDetailScreen} />
    </Stack.Navigator>
  );
}

function MainTabs() {
  return (
    <View style={{ flex: 1 }}>
      <OfflineIndicator />
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#2563eb',
          tabBarInactiveTintColor: '#94a3b8',
          tabBarStyle: { paddingBottom: 8, paddingTop: 4, height: 60, borderTopColor: '#e2e8f0' },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        }}
      >
        <Tab.Screen name="Home" component={DashboardScreen} options={{ tabBarLabel: 'Home' }} />
        <Tab.Screen name="Policies" component={PoliciesStack} options={{ tabBarLabel: 'Policies' }} />
        <Tab.Screen name="Marketplace" component={InsuranceMarketplaceScreen} options={{ tabBarLabel: 'Products' }} />
        <Tab.Screen name="Claims" component={ClaimsStack} options={{ tabBarLabel: 'Claims' }} />
        <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
      </Tab.Navigator>
    </View>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <Stack.Screen name="TwoFactor" component={TwoFactorScreen} />
    </Stack.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated, kycPassed } = useAuth();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        kycPassed ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="AgentLocator" component={AgentLocatorScreen} />
            <Stack.Screen name="Emergency" component={EmergencyScreen} />
            <Stack.Screen name="Payments" component={PaymentsScreen} />
            <Stack.Screen name="SecuritySettings" component={SecuritySettingsScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="Wallet" component={WalletScreen} />
            <Stack.Screen name="Support" component={SupportScreen} />
            <Stack.Screen name="Analytics" component={AnalyticsScreen} />
            <Stack.Screen name="Referral" component={ReferralScreen} />
            <Stack.Screen name="Documents" component={DocumentsScreen} />
            <Stack.Screen name="Chatbot" component={ChatbotScreen} />
            <Stack.Screen name="ClaimsTracker" component={ClaimsTrackerScreen} />
            <Stack.Screen name="Quote" component={QuoteScreen} />
            <Stack.Screen name="Beneficiaries" component={BeneficiariesScreen} />
            <Stack.Screen name="RenewPolicy" component={RenewPolicyScreen} />
            <Stack.Screen name="Communication" component={CommunicationScreen} />
            <Stack.Screen name="InsuranceScore" component={InsuranceScoreScreen} />
            <Stack.Screen name="NearbyHospitals" component={NearbyHospitalsScreen} />
            <Stack.Screen name="Rewards" component={RewardsScreen} />
          </>
        ) : (
          <Stack.Screen name="KYC" component={KYCScreen} />
        )
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
}
