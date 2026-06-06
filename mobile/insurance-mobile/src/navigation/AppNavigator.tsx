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
import { AgentLocatorScreen } from '../screens/AgentLocatorScreen';
import { EmergencyScreen } from '../screens/EmergencyScreen';
import { KYCVerificationScreen } from '../screens/KYCVerificationScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { DigitalWalletScreen } from '../screens/DigitalWalletScreen';
import { ProductBrowserScreen } from '../screens/ProductBrowserScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { ComplianceScreen } from '../screens/ComplianceScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { SupportScreen } from '../screens/SupportScreen';
import GeospatialMapScreen from '../screens/GeospatialMapScreen';
import { OfflineIndicator } from '../components/OfflineIndicator';
import { View } from 'react-native';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

function PoliciesStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="PoliciesList" component={PoliciesScreen} />
      <Stack.Screen name="PolicyDetail" component={PolicyDetailScreen} />
      <Stack.Screen name="ProductBrowser" component={ProductBrowserScreen} />
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

function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="KYCVerification" component={KYCVerificationScreen} />
      <Stack.Screen name="DigitalWallet" component={DigitalWalletScreen} />
      <Stack.Screen name="Analytics" component={AnalyticsScreen} />
      <Stack.Screen name="Compliance" component={ComplianceScreen} />
      <Stack.Screen name="Support" component={SupportScreen} />
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
        <Tab.Screen name="Claims" component={ClaimsStack} options={{ tabBarLabel: 'Claims' }} />
        <Tab.Screen name="Payments" component={PaymentsScreen} options={{ tabBarLabel: 'Pay' }} />
        <Tab.Screen name="Profile" component={ProfileStack} options={{ tabBarLabel: 'More' }} />
      </Tab.Navigator>
    </View>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}

export function AppNavigator() {
  const { isAuthenticated } = useAuth();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="AgentLocator" component={AgentLocatorScreen} />
          <Stack.Screen name="Emergency" component={EmergencyScreen} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} />
          <Stack.Screen name="GeospatialMap" component={GeospatialMapScreen} />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
}
