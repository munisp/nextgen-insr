import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../store/authStore';
// 2026-09-19 (P-wave): only boot-critical screens are imported eagerly
// (Dashboard = first tab, Policies = second tab default, Login = auth entry).
// Every other screen is registered via `getComponent` so its module (and its
// dependency tree — maps, camera, chatbot, etc.) is evaluated lazily on
// first navigation instead of during cold start.
import { DashboardScreen } from '../screens/DashboardScreen';
import { PoliciesScreen } from '../screens/PoliciesScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { OfflineIndicator } from '../components/OfflineIndicator';
import { View } from 'react-native';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function PoliciesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PoliciesList" component={PoliciesScreen} />
      <Stack.Screen name="PolicyDetail" getComponent={() => require('../screens/PolicyDetailScreen').PolicyDetailScreen} />
    </Stack.Navigator>
  );
}

function ClaimsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ClaimsList" getComponent={() => require('../screens/ClaimsScreen').ClaimsScreen} />
      <Stack.Screen name="FileClaim" getComponent={() => require('../screens/FileClaimScreen').FileClaimScreen} />
      <Stack.Screen name="ClaimDetail" getComponent={() => require('../screens/ClaimDetailScreen').ClaimDetailScreen} />
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
        <Tab.Screen name="Marketplace" getComponent={() => require('../screens/InsuranceMarketplaceScreen').InsuranceMarketplaceScreen} options={{ tabBarLabel: 'Products' }} />
        <Tab.Screen name="Claims" component={ClaimsStack} options={{ tabBarLabel: 'Claims' }} />
        <Tab.Screen name="Profile" getComponent={() => require('../screens/ProfileScreen').ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
      </Tab.Navigator>
    </View>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Signup" getComponent={() => require('../screens/SignupScreen').SignupScreen} />
      <Stack.Screen name="ForgotPassword" getComponent={() => require('../screens/ForgotPasswordScreen').ForgotPasswordScreen} />
      <Stack.Screen name="TwoFactor" getComponent={() => require('../screens/TwoFactorScreen').TwoFactorScreen} />
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
            <Stack.Screen name="AgentLocator" getComponent={() => require('../screens/AgentLocatorScreen').AgentLocatorScreen} />
            <Stack.Screen name="Emergency" getComponent={() => require('../screens/EmergencyScreen').EmergencyScreen} />
            <Stack.Screen name="Payments" getComponent={() => require('../screens/PaymentsScreen').PaymentsScreen} />
            <Stack.Screen name="SecuritySettings" getComponent={() => require('../screens/SecuritySettingsScreen').SecuritySettingsScreen} />
            <Stack.Screen name="Notifications" getComponent={() => require('../screens/NotificationsScreen').default} />
            <Stack.Screen name="Wallet" getComponent={() => require('../screens/WalletScreen').default} />
            <Stack.Screen name="Support" getComponent={() => require('../screens/SupportScreen').default} />
            <Stack.Screen name="Analytics" getComponent={() => require('../screens/AnalyticsScreen').default} />
            <Stack.Screen name="Referral" getComponent={() => require('../screens/ReferralScreen').default} />
            <Stack.Screen name="Documents" getComponent={() => require('../screens/DocumentsScreen').default} />
            <Stack.Screen name="Chatbot" getComponent={() => require('../screens/ChatbotScreen').default} />
            <Stack.Screen name="ClaimsTracker" getComponent={() => require('../screens/ClaimsTrackerScreen').default} />
            <Stack.Screen name="Quote" getComponent={() => require('../screens/QuoteScreen').default} />
            <Stack.Screen name="Beneficiaries" getComponent={() => require('../screens/BeneficiariesScreen').default} />
            <Stack.Screen name="RenewPolicy" getComponent={() => require('../screens/RenewPolicyScreen').default} />
            <Stack.Screen name="Communication" getComponent={() => require('../screens/CommunicationScreen').default} />
            <Stack.Screen name="InsuranceScore" getComponent={() => require('../screens/InsuranceScoreScreen').default} />
            <Stack.Screen name="NearbyHospitals" getComponent={() => require('../screens/NearbyHospitalsScreen').default} />
            <Stack.Screen name="Rewards" getComponent={() => require('../screens/RewardsScreen').default} />
          </>
        ) : (
          <Stack.Screen name="KYC" getComponent={() => require('../screens/KYCScreen').KYCScreen} />
        )
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
}
