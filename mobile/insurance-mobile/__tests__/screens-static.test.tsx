/**
 * screens-static.test.tsx — 2026-10-03 (W9-B6)
 * Render/smoke tests for screens that do NOT depend on a tRPC data query:
 * honest unavailable states (Analytics, Compliance, GeospatialMap,
 * Telematics), contact/action screens (Emergency, Support), the geolocation
 * boundary (AgentLocator), and the auth-store boundary screens (Login,
 * Profile, Settings).
 *
 * Assertions pin HONEST states only: real rendered copy, real error
 * surfacing, no fabricated content. Boundary mocks (fetch envelope,
 * useOfflineSync, useAuth, geolocation) — see harness.tsx header.
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react-native';
import Geolocation from 'react-native-geolocation-service';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation, mockAuth,
} from './harness';

// 2026-10-03 (W9-B6): see screens-data.test.tsx — first-test transform
// warm-up under worker contention can exceed jest's 5s default.
jest.setTimeout(20000);

import { AnalyticsScreen } from '../src/screens/AnalyticsScreen';
import { ComplianceScreen } from '../src/screens/ComplianceScreen';
import { EmergencyScreen } from '../src/screens/EmergencyScreen';
import GeospatialMapScreen from '../src/screens/GeospatialMapScreen';
import TelematicsScreen from '../src/screens/TelematicsScreen';
import { SupportScreen } from '../src/screens/SupportScreen';
import { AgentLocatorScreen } from '../src/screens/AgentLocatorScreen';
import { LoginScreen } from '../src/screens/LoginScreen';
import { ProfileScreen } from '../src/screens/ProfileScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';

const mockGeo = Geolocation.getCurrentPosition as jest.Mock;

beforeEach(resetHarness);
afterEach(() => { delete (global as any).fetch; });

describe('AnalyticsScreen', () => {
  it('renders the honest unavailable state — no fabricated metrics', () => {
    renderScreen(<AnalyticsScreen />);
    expect(screen.getByText('Personal analytics unavailable')).toBeTruthy();
    expect(screen.queryByText(/coverage score/i)).toBeNull();
  });
});

describe('ComplianceScreen', () => {
  it('renders the honest unavailable state — no fabricated filings', () => {
    renderScreen(<ComplianceScreen />);
    expect(screen.getByText('Compliance & Regulatory')).toBeTruthy();
    expect(screen.getByText(/not published to customer accounts/i)).toBeTruthy();
  });
});

describe('GeospatialMapScreen', () => {
  it('renders the honest unavailable state — no fabricated risk data', () => {
    renderScreen(<GeospatialMapScreen />);
    expect(screen.getByText('Risk Maps Unavailable')).toBeTruthy();
  });
});

describe('TelematicsScreen', () => {
  it('renders the honest unavailable state — no fabricated driving score', () => {
    renderScreen(<TelematicsScreen />);
    expect(screen.getByText('Telematics Unavailable')).toBeTruthy();
  });
});

describe('EmergencyScreen', () => {
  it('renders the real emergency contacts and navigates to FileClaim', () => {
    renderScreen(<EmergencyScreen navigation={mockNavigation} />);
    expect(screen.getByText('InsurePortal Emergency')).toBeTruthy();
    expect(screen.getByText('Nigeria Police')).toBeTruthy();
    fireEvent.press(screen.getByText('File Emergency Claim'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('Main', expect.objectContaining({ screen: 'Claims' }));
  });
});

describe('SupportScreen', () => {
  it('renders support categories and the real FAQ content', () => {
    renderScreen(<SupportScreen />);
    expect(screen.getByText('Support')).toBeTruthy();
    expect(screen.getByText('How do I file a claim?')).toBeTruthy();
    expect(screen.getByText('Technical Support')).toBeTruthy();
  });
});

describe('AgentLocatorScreen', () => {
  it('surfaces the honest unavailable error when the agent lookup has no endpoint', async () => {
    // Geolocation boundary succeeds; agentApi.findNearby throws its real
    // honest error (no /api/v1/agents route exists — W9-B3).
    mockGeo.mockImplementation((success: any) => success({ coords: { latitude: 6.45, longitude: 3.39 } }));
    renderScreen(<AgentLocatorScreen />);
    await waitFor(() => expect(screen.getByText(/Agent lookup is not available in the app yet/i)).toBeTruthy());
  });

  it('surfaces an honest location error when geolocation fails', async () => {
    mockGeo.mockImplementation((_success: any, error: any) => error(new Error('denied')));
    renderScreen(<AgentLocatorScreen />);
    await waitFor(() => expect(screen.getByText(/Location unavailable/i)).toBeTruthy());
  });
});

describe('LoginScreen', () => {
  it('launches the Keycloak OIDC flow when Sign In is pressed', async () => {
    renderScreen(<LoginScreen />);
    fireEvent.press(screen.getByLabelText('Sign in with Keycloak'));
    await waitFor(() => expect(mockAuth.login).toHaveBeenCalledTimes(1));
  });

  it('shows an honest error when sign-in is cancelled — no fake success', async () => {
    mockAuth.login.mockRejectedValueOnce(new Error('User cancelled flow'));
    renderScreen(<LoginScreen />);
    fireEvent.press(screen.getByLabelText('Sign in with Keycloak'));
    await waitFor(() => expect(screen.getByText('Sign-in was cancelled.')).toBeTruthy());
  });
});

describe('ProfileScreen', () => {
  it('renders the signed-in user from the auth store — real session data', () => {
    renderScreen(<ProfileScreen />);
    expect(screen.getByText('Ada Obi')).toBeTruthy();
    expect(screen.getByText('ada@example.ng')).toBeTruthy();
  });
});

describe('SettingsScreen', () => {
  it('renders the settings sections for the signed-in user', () => {
    renderScreen(<SettingsScreen navigation={mockNavigation} />);
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('Logout')).toBeTruthy();
  });
});
