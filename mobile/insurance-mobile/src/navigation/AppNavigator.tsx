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
// 2026-10-03 (W9-B5 wave 1): quotes / endorsements / renewals member
// screens (memberQuotes/memberEndorsements/memberRenewals routers).
import { QuotesScreen } from '../screens/QuotesScreen';
import { EndorsementsScreen } from '../screens/EndorsementsScreen';
import { RenewalsScreen } from '../screens/RenewalsScreen';
// 2026-10-03 (W9-B5 wave 2): savings / loyalty / referrals / disputes member
// screens (memberSavings/memberLoyalty/memberReferrals/memberDisputes routers).
import { SavingsScreen } from '../screens/SavingsScreen';
import { LoyaltyScreen } from '../screens/LoyaltyScreen';
import { ReferralsScreen } from '../screens/ReferralsScreen';
import { DisputesScreen } from '../screens/DisputesScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
// 2026-10-03 (W9-B5 wave 3): bills / airtime+momo / FX / parametric member
// screens (memberBillPayments/memberAirtime/memberMobileMoney/memberFxRates/
// parametricMember routers — all read-only, no funds mutations exist).
import { BillsScreen } from '../screens/BillsScreen';
import { AirtimeScreen } from '../screens/AirtimeScreen';
import { FxScreen } from '../screens/FxScreen';
import { ParametricScreen } from '../screens/ParametricScreen';
// Phone OTP verification (memberPhone router) — Profile stack (identity).
import { PhoneVerificationScreen } from '../screens/PhoneVerificationScreen';
// 2026-10-04 (W10-B4b): KYC document submission (memberIdentity.submitKyc,
// W10-B3) — same Profile/identity stack as PhoneVerification.
import { KycSubmitScreen } from '../screens/KycSubmitScreen';
import { ComplianceScreen } from '../screens/ComplianceScreen';
import { AnalyticsScreen } from '../screens/AnalyticsScreen';
import { SupportScreen } from '../screens/SupportScreen';
import GeospatialMapScreen from '../screens/GeospatialMapScreen';
// 2026-10-01 (R1c): Telematics/Wellness called real monolith procedures but
// were unreachable — now registered.
import TelematicsScreen from '../screens/TelematicsScreen';
import WellnessScreen from '../screens/WellnessScreen';
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
      {/* 2026-10-03 (W9-B5 wave 1) */}
      <Stack.Screen name="Quotes" component={QuotesScreen} />
      <Stack.Screen name="Endorsements" component={EndorsementsScreen} />
      <Stack.Screen name="Renewals" component={RenewalsScreen} />
      {/* 2026-10-03 (W9-B5 wave 2) */}
      <Stack.Screen name="Savings" component={SavingsScreen} />
      <Stack.Screen name="Loyalty" component={LoyaltyScreen} />
      <Stack.Screen name="Referrals" component={ReferralsScreen} />
      <Stack.Screen name="Disputes" component={DisputesScreen} />
      {/* 2026-10-03 (W9-B5 wave 3) */}
      <Stack.Screen name="Bills" component={BillsScreen} />
      <Stack.Screen name="Airtime" component={AirtimeScreen} />
      <Stack.Screen name="Fx" component={FxScreen} />
      <Stack.Screen name="Parametric" component={ParametricScreen} />
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
      {/* 2026-10-03 (W9-B5 wave 3): PhoneVerification was imported and targeted
          by the Dashboard "Verify Phone" tile but never registered — dead-end. */}
      <Stack.Screen name="PhoneVerification" component={PhoneVerificationScreen} />
      {/* 2026-10-04 (W10-B4b): NIN/BVN submission + open-session status panel. */}
      <Stack.Screen name="KycSubmit" component={KycSubmitScreen} />
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
          <Stack.Screen name="Telematics" component={TelematicsScreen} />
          <Stack.Screen name="Wellness" component={WellnessScreen} />
        </>
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
}
