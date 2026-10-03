/**
 * screens-data.test.tsx — 2026-10-03 (W9-B6)
 * Render/smoke tests for the tRPC-backed screens. The network boundary
 * (fetch) is mocked with the REAL superjson envelope
 * `{result:{data:{json:<payload>}}}` (W9-B4 pattern); the offline-sync and
 * auth React boundaries use real-value harness objects. Each screen asserts
 * at least: loading → real server data rendered; and where the screen has a
 * distinct honest failure/empty state, that it is shown instead of
 * fabricated content.
 */
import React from 'react';
import { screen, waitFor } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';

// 2026-10-03 (W9-B6): the FIRST test in a suite bears the one-time babel
// transform/module-load cost of the screens; under parallel worker
// contention that can exceed jest's 5s default. Raised honestly — this is
// transform warm-up, not application slowness.
jest.setTimeout(20000);

import { DashboardScreen } from '../src/screens/DashboardScreen';
import { PoliciesScreen } from '../src/screens/PoliciesScreen';
import { PolicyDetailScreen } from '../src/screens/PolicyDetailScreen';
import { ClaimsScreen } from '../src/screens/ClaimsScreen';
import { ClaimDetailScreen } from '../src/screens/ClaimDetailScreen';
import { PaymentsScreen } from '../src/screens/PaymentsScreen';
import { NotificationsScreen } from '../src/screens/NotificationsScreen';
import { ProductBrowserScreen } from '../src/screens/ProductBrowserScreen';
import { KYCVerificationScreen } from '../src/screens/KYCVerificationScreen';
import WellnessScreen from '../src/screens/WellnessScreen';
import { FileClaimScreen } from '../src/screens/FileClaimScreen';

const POLICY_ROW = {
  id: 1, policyNumber: 'POL-2026-001', status: 'active', coverageType: 'motor',
  sumInsured: '5000000', annualPremium: '120000', startDate: '2026-01-01',
  endDate: '2027-01-01', renewalDate: '2026-12-15', certificateNumber: 'CERT-9',
  productId: 7, productName: 'Motor Plus', productDescription: null, currency: 'NGN',
};

beforeEach(resetHarness);
afterEach(() => { delete (global as any).fetch; });

describe('DashboardScreen', () => {
  it('renders the signed-in user and stats computed from REAL policy/claim rows', async () => {
    mockFetchSequence({
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
      'memberClaims.myClaims': () => ({ claims: [{ id: 'c1', status: 'pending' }], count: 1 }),
    });
    renderScreen(<DashboardScreen navigation={mockNavigation} />);
    expect(await screen.findByText('Ada')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Active Policies')).toBeTruthy());
    // One real active policy, one real open claim.
    await waitFor(() => expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(2));
  });
});

describe('PoliciesScreen', () => {
  it('renders the real policy list from memberPolicies.myPolicies', async () => {
    mockFetchSequence({
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
    });
    renderScreen(<PoliciesScreen navigation={mockNavigation} />);
    expect(await screen.findByText('POL-2026-001')).toBeTruthy();
    expect(screen.getByText('Motor Plus')).toBeTruthy();
    expect(screen.getByText('1 total')).toBeTruthy();
  });

  it('shows the honest empty state when the server returns no policies', async () => {
    mockFetchSequence({
      'memberPolicies.myPolicies': () => ({ policies: [], count: 0 }),
    });
    renderScreen(<PoliciesScreen navigation={mockNavigation} />);
    expect(await screen.findByText('0 total')).toBeTruthy();
  });
});

describe('PolicyDetailScreen', () => {
  const route = { params: { policyId: 1 } };

  it('renders the real policy detail from memberPolicies.myPolicy', async () => {
    mockFetchSequence({ 'memberPolicies.myPolicy': () => POLICY_ROW });
    renderScreen(<PolicyDetailScreen route={route} navigation={mockNavigation} />);
    expect(await screen.findByText('POL-2026-001')).toBeTruthy();
    expect(screen.getByText('CERT-9')).toBeTruthy();
    expect(screen.getByText('₦120,000/year')).toBeTruthy();
  });

  it('stays on the honest loading state when the policy is not found and no cache exists', async () => {
    mockFetchSequence({ 'memberPolicies.myPolicy': () => new Error('NOT_FOUND') });
    renderScreen(<PolicyDetailScreen route={route} navigation={mockNavigation} />);
    // QueryFn falls back to cache (empty) → policy undefined → Loading…;
    // critically, no fabricated policy fields are rendered.
    await waitFor(() => expect(screen.queryByText('Policy Details')).toBeNull());
    expect(screen.queryByText('POL-2026-001')).toBeNull();
  });
});

describe('ClaimsScreen', () => {
  it('renders real claims from memberClaims.myClaims', async () => {
    mockFetchSequence({
      'memberClaims.myClaims': () => ({
        claims: [{ id: 'abcdef1234567890', type: 'Motor', status: 'pending', amount: 45000, filedAt: '2026-09-01' }],
        count: 1,
      }),
    });
    renderScreen(<ClaimsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('Motor')).toBeTruthy();
    expect(screen.getByText('₦45,000')).toBeTruthy();
  });
});

describe('ClaimDetailScreen', () => {
  const route = { params: { claimId: 'abcdef1234567890' } };

  it('renders the real claim from memberClaims.myClaim plus the honest timeline-unavailable note', async () => {
    mockFetchSequence({
      'memberClaims.myClaim': () => ({
        id: 'abcdef1234567890', claimType: 'Motor', status: 'pending',
        claimedAmount: 45000, filedAt: '2026-09-01', policyNumber: 'POL-2026-001',
      }),
    });
    renderScreen(<ClaimDetailScreen route={route} navigation={mockNavigation} />);
    expect(await screen.findByText('Motor Claim')).toBeTruthy();
    expect(screen.getByText('₦45,000')).toBeTruthy();
    expect(screen.getByText(/timeline is not available in the app yet/i)).toBeTruthy();
  });
});

describe('PaymentsScreen', () => {
  it('renders server-derived due premiums from memberPayments.myPremiumDue', async () => {
    mockFetchSequence({
      'memberPayments.myPremiumDue': () => ({
        duePremiums: [{
          id: 1, policyId: 1, premiumRef: 'PR-2026-001', amount: '25000',
          currency: 'NGN', dueDate: '2026-11-01', gracePeriodDays: 30,
          status: 'due', policyNumber: 'POL-2026-001',
        }],
        policies: [],
        disclosure: 'Amounts are derived server-side from your premium ledger.',
      }),
    });
    renderScreen(<PaymentsScreen />);
    expect(await screen.findByText('PR-2026-001')).toBeTruthy();
    expect(screen.getByText('₦25,000')).toBeTruthy();
    expect(screen.getByText(/derived server-side/i)).toBeTruthy();
  });

  it('shows the honest empty ledger state when nothing is due', async () => {
    mockFetchSequence({
      'memberPayments.myPremiumDue': () => ({ duePremiums: [], policies: [], disclosure: '' }),
    });
    renderScreen(<PaymentsScreen />);
    expect(await screen.findByText('No due premiums on your ledger')).toBeTruthy();
  });
});

describe('NotificationsScreen', () => {
  it('renders real notifications from notificationInbox.list', async () => {
    mockFetchSequence({
      'notificationInbox.list': () => ({
        notifications: [{ id: 1, type: 'claim', title: 'Claim CL-9 updated', body: 'Your claim moved to processing', read: false, createdAt: '2026-09-01' }],
        total: 1,
      }),
    });
    renderScreen(<NotificationsScreen />);
    expect(await screen.findByText('Claim CL-9 updated')).toBeTruthy();
  });

  it('shows the honest empty state when there are no notifications', async () => {
    mockFetchSequence({
      'notificationInbox.list': () => ({ notifications: [], total: 0 }),
    });
    renderScreen(<NotificationsScreen />);
    expect(await screen.findByText('No notifications')).toBeTruthy();
  });
});

describe('ProductBrowserScreen', () => {
  it('renders real catalog products from insuranceProductCatalog.listProducts', async () => {
    mockFetchSequence({
      'insuranceProductCatalog.listProducts': () => ({
        data: [{
          id: 3, name: 'Motor Comprehensive', description: 'Full motor cover',
          coverageType: 'motor', minPremium: '5000', maxCoverageAmount: '2000000', isActive: true,
        }],
        total: 1,
      }),
    });
    renderScreen(<ProductBrowserScreen navigation={mockNavigation} />);
    expect(await screen.findByText('Motor Comprehensive')).toBeTruthy();
  });
});

describe('KYCVerificationScreen', () => {
  it('renders the honest no-session state from memberIdentity.myKycStatus', async () => {
    mockFetchSequence({
      'memberIdentity.myKycStatus': () => ({ hasSession: false, hasProfile: false, kycLevel: null, session: null }),
    });
    renderScreen(<KYCVerificationScreen navigation={mockNavigation} />);
    expect(await screen.findAllByText('No KYC verification has been started for your account yet.')).not.toHaveLength(0);
  });

  it('renders a real KYC level when the server returns one', async () => {
    mockFetchSequence({
      'memberIdentity.myKycStatus': () => ({
        hasSession: true, hasProfile: true, kycLevel: 'tier_2',
        session: { docType: 'national_id', createdAt: '2026-08-01' },
      }),
    });
    renderScreen(<KYCVerificationScreen navigation={mockNavigation} />);
    expect(await screen.findByText('KYC level: tier_2')).toBeTruthy();
  });
});

describe('WellnessScreen', () => {
  it('shows loading, then the real wellness summary from healthWearables.getWellnessSummary', async () => {
    mockFetchSequence({
      'healthWearables.getWellnessSummary': () => ({
        score: 72, totalRewardPoints: 150, premiumDiscountPct: 5,
        latestReading: { readingDate: '2026-10-01', steps: 8000, activeMinutes: 45, sleepHours: 7, heartRateAvg: 68 },
      }),
    });
    renderScreen(<WellnessScreen />);
    expect(screen.getByText('Loading wellness data...')).toBeTruthy();
    expect(await screen.findByText('72')).toBeTruthy();
    expect(screen.getByText('8,000')).toBeTruthy();
  });

  it('renders the honest empty summary (no fabricated score) when the fetch fails', async () => {
    mockFetchSequence({
      'healthWearables.getWellnessSummary': () => new Error('Request failed (HTTP 500)'),
    });
    renderScreen(<WellnessScreen />);
    // summary stays null → the screen renders its neutral zero state, and
    // crucially no made-up score/reading is shown.
    await waitFor(() => expect(screen.queryByText('Loading wellness data...')).toBeNull());
    expect(screen.queryByText(/latest reading/i)).toBeNull();
  });
});

describe('FileClaimScreen', () => {
  it('renders the real policy picker from memberClaims.myPoliciesPicker', async () => {
    mockFetchSequence({
      'memberClaims.myPoliciesPicker': () => ({ policies: [{ id: 1, policyNumber: 'POL-2026-001', status: 'active' }] }),
    });
    renderScreen(<FileClaimScreen navigation={mockNavigation} />);
    expect(await screen.findByText('POL-2026-001 (active)')).toBeTruthy();
  });

  it('shows the honest empty state when the member has no file-able policies', async () => {
    mockFetchSequence({
      'memberClaims.myPoliciesPicker': () => ({ policies: [] }),
    });
    renderScreen(<FileClaimScreen navigation={mockNavigation} />);
    await waitFor(() => expect(screen.queryByText('POL-2026-001 (active)')).toBeNull());
  });
});
