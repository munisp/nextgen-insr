/**
 * screens-lifecycle.test.tsx — 2026-10-03 (W9-B5 wave 1)
 * Harness tests for the new Quotes / Endorsements / Renewals screens.
 * The network boundary (fetch) is mocked with the REAL superjson envelope
 * `{result:{data:{json:<payload>}}}` (see harness.tsx header); the screens,
 * services (api.ts wrappers), memberTrpc auth and config transport are all
 * production code. Mutation tests assert the exact procedure name and input
 * body — no client-computed amounts, matching the server zod schemas
 * (server/routers/memberQuotes.ts / memberEndorsements.ts / memberRenewals.ts).
 */
import React from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react-native';
import {
  mockFetchSequence, renderScreen, resetHarness, mockNavigation,
} from './harness';

// 2026-10-03 (W9-B6): see screens-data.test.tsx — first-test transform
// warm-up under worker contention can exceed jest's 5s default.
jest.setTimeout(20000);

import { QuotesScreen } from '../src/screens/QuotesScreen';
import { EndorsementsScreen } from '../src/screens/EndorsementsScreen';
import { RenewalsScreen } from '../src/screens/RenewalsScreen';

const QUOTE_ROW = {
  id: 11, productId: 3, productName: 'Motor Comprehensive', productType: 'motor',
  sumInsured: '5000000', premiumAmount: '125000', stampDuty: '50',
  totalPayable: '125050', durationMonths: 12, coverageType: null,
  status: 'pending', validUntil: '2026-10-04', createdAt: '2026-10-03',
};

const PRODUCT_ROW = {
  id: 3, name: 'Motor Comprehensive', description: 'Full motor cover',
  coverageType: 'motor', minPremium: '5000', maxCoverageAmount: '2000000', isActive: true,
};

const POLICY_ROW = {
  id: 1, policyNumber: 'POL-2026-001', status: 'active', coverageType: 'motor',
  sumInsured: '5000000', annualPremium: '120000', startDate: '2026-01-01',
  endDate: '2027-01-01', productId: 3, productName: 'Motor Comprehensive', currency: 'NGN',
};

/** Find the fetch call to a mutation procedure and parse its real body. */
function mutationInput(fetchMock: jest.Mock, procedure: string): any {
  const call = fetchMock.mock.calls.find(
    ([url, opts]: any[]) => String(url).endsWith(`/${procedure}`) && opts?.method === 'POST',
  );
  expect(call).toBeTruthy();
  return JSON.parse((call as any[])[1].body).json;
}

beforeEach(resetHarness);
afterEach(() => { delete (global as any).fetch; });

describe('QuotesScreen', () => {
  it('renders the real quote cart from memberQuotes.myQuoteCart + quoteSummary', async () => {
    mockFetchSequence({
      'memberQuotes.myQuoteCart': () => ({
        items: [QUOTE_ROW], subTotal: 125000, totalPremium: 125000, count: 1, currency: 'NGN',
      }),
      'memberQuotes.quoteSummary': () => ({ count: 1, totalPremium: 125000, currency: 'NGN' }),
      'insuranceProductCatalog.listProducts': () => ({ data: [PRODUCT_ROW], total: 1 }),
    });
    renderScreen(<QuotesScreen navigation={mockNavigation} />);
    expect(screen.getByText(/Loading your quote cart/i)).toBeTruthy();
    // Cart row AND product picker chip both render the real product name.
    expect((await screen.findAllByText('Motor Comprehensive')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('₦125,050')).toBeTruthy();
    expect(screen.getByText(/1 item\(s\) — total premium ₦125,000 NGN/)).toBeTruthy();
  });

  it('shows the honest empty cart state', async () => {
    mockFetchSequence({
      'memberQuotes.myQuoteCart': () => ({ items: [], subTotal: 0, totalPremium: 0, count: 0, currency: 'NGN' }),
      'memberQuotes.quoteSummary': () => ({ count: 0, totalPremium: 0, currency: 'NGN' }),
      'insuranceProductCatalog.listProducts': () => ({ data: [PRODUCT_ROW], total: 1 }),
    });
    renderScreen(<QuotesScreen navigation={mockNavigation} />);
    expect(await screen.findByText(/quote cart is empty/i)).toBeTruthy();
  });

  it('surfaces the server error verbatim instead of fabricated rows', async () => {
    mockFetchSequence({
      'memberQuotes.myQuoteCart': () => new Error('DB unavailable'),
      'insuranceProductCatalog.listProducts': () => ({ data: [PRODUCT_ROW], total: 1 }),
    });
    renderScreen(<QuotesScreen navigation={mockNavigation} />);
    expect(await screen.findByText('DB unavailable')).toBeTruthy();
    expect(screen.queryByText('Motor Comprehensive')).toBeTruthy(); // picker still honest
    expect(screen.queryByText('₦125,050')).toBeNull();
  });

  it('addToQuoteCart sends the exact server input (NO premium) and shows the server-priced premium', async () => {
    const fetchMock = mockFetchSequence({
      'memberQuotes.myQuoteCart': () => ({ items: [], subTotal: 0, totalPremium: 0, count: 0, currency: 'NGN' }),
      'memberQuotes.quoteSummary': () => ({ count: 0, totalPremium: 0, currency: 'NGN' }),
      'insuranceProductCatalog.listProducts': () => ({ data: [PRODUCT_ROW], total: 1 }),
      'memberQuotes.addToQuoteCart': () => ({
        quote: QUOTE_ROW, premiumAmount: 125000, stampDuty: 50, totalPayable: 125050, currency: 'NGN',
      }),
    });
    renderScreen(<QuotesScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText('Motor Comprehensive'));
    fireEvent.changeText(screen.getByLabelText('Sum insured'), '5000000');
    fireEvent.press(screen.getByText('Add to quote cart'));
    expect(await screen.findByText(/Quote added — premium ₦125,000 \(NGN\)/)).toBeTruthy();
    const input = mutationInput(fetchMock, 'memberQuotes.addToQuoteCart');
    // Server zod schema exactly — the premium is NEVER sent or computed.
    expect(input).toEqual({ productId: 3, sumInsured: 5000000, durationMonths: 12 });
  });

  it('surfaces PRECONDITION_FAILED honestly — no quote fabricated', async () => {
    const fetchMock = mockFetchSequence({
      'memberQuotes.myQuoteCart': () => ({ items: [], subTotal: 0, totalPremium: 0, count: 0, currency: 'NGN' }),
      'memberQuotes.quoteSummary': () => ({ count: 0, totalPremium: 0, currency: 'NGN' }),
      'insuranceProductCatalog.listProducts': () => ({ data: [PRODUCT_ROW], total: 1 }),
      'memberQuotes.addToQuoteCart': () => new Error('No active rating table covers this product'),
    });
    renderScreen(<QuotesScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText('Motor Comprehensive'));
    fireEvent.changeText(screen.getByLabelText('Sum insured'), '5000000');
    fireEvent.press(screen.getByText('Add to quote cart'));
    expect(await screen.findByText('No active rating table covers this product')).toBeTruthy();
    expect(screen.queryByText(/Quote added/)).toBeNull();
  });

  it('removeQuoteItem cancels a pending quote with the real quoteId', async () => {
    const fetchMock = mockFetchSequence({
      'memberQuotes.myQuoteCart': () => ({
        items: [QUOTE_ROW], subTotal: 125000, totalPremium: 125000, count: 1, currency: 'NGN',
      }),
      'memberQuotes.quoteSummary': () => ({ count: 1, totalPremium: 125000, currency: 'NGN' }),
      'insuranceProductCatalog.listProducts': () => ({ data: [PRODUCT_ROW], total: 1 }),
      'memberQuotes.removeQuoteItem': () => ({ removed: true, quoteId: 11 }),
    });
    renderScreen(<QuotesScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByLabelText('Remove quote 11'));
    await waitFor(() => {
      expect(mutationInput(fetchMock, 'memberQuotes.removeQuoteItem')).toEqual({ quoteId: 11 });
    });
  });
});

describe('EndorsementsScreen', () => {
  const ENDORSEMENT_ROW = {
    id: 5, endorsementNumber: 'END-1727812800000-1', policyId: 1, policyNumber: 'POL-2026-001',
    type: 'modification', effectiveDate: '2026-11-01', description: 'Add driver',
    premiumAdjustment: '5000', sumInsuredAdjustment: '0', approvedAt: null, createdAt: '2026-10-03', currency: 'NGN',
  };

  it('renders the real endorsement list from memberEndorsements.myEndorsements', async () => {
    mockFetchSequence({
      'memberEndorsements.myEndorsements': () => ({ endorsements: [ENDORSEMENT_ROW], count: 1 }),
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
    });
    renderScreen(<EndorsementsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('END-1727812800000-1')).toBeTruthy();
    // Badge + type-picker chip both render the real type label.
    expect(screen.getAllByText('modification').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('₦5,000')).toBeTruthy();
    expect(screen.getByText(/1 endorsement on your account/)).toBeTruthy();
  });

  it('shows the honest empty state', async () => {
    mockFetchSequence({
      'memberEndorsements.myEndorsements': () => ({ endorsements: [], count: 0 }),
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
    });
    renderScreen(<EndorsementsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('You have no endorsements yet.')).toBeTruthy();
  });

  it('surfaces the server error verbatim instead of fabricated rows', async () => {
    mockFetchSequence({
      'memberEndorsements.myEndorsements': () => new Error('DB unavailable'),
      'memberPolicies.myPolicies': () => ({ policies: [], count: 0 }),
    });
    renderScreen(<EndorsementsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('DB unavailable')).toBeTruthy();
  });

  it('requestEndorsement sends the exact server input (proposed adjustments optional, never charges)', async () => {
    const fetchMock = mockFetchSequence({
      'memberEndorsements.myEndorsements': () => ({ endorsements: [], count: 0 }),
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
      'memberEndorsements.requestEndorsement': () => ({
        endorsement: { id: 6 }, endorsementNumber: 'END-1727812800001-1',
      }),
    });
    renderScreen(<EndorsementsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText(/POL-2026-001/));
    fireEvent.press(screen.getByText('addition'));
    fireEvent.changeText(screen.getByLabelText('Effective date'), '2026-11-01');
    fireEvent.changeText(screen.getByLabelText('Description'), 'Add my spouse as a named driver');
    fireEvent.press(screen.getByText('Request endorsement'));
    expect(await screen.findByText(/Endorsement requested \(END-1727812800001-1\)/)).toBeTruthy();
    // Blank optional adjustments are omitted — input = server zod schema exactly.
    expect(mutationInput(fetchMock, 'memberEndorsements.requestEndorsement')).toEqual({
      policyId: 1,
      type: 'addition',
      effectiveDate: '2026-11-01',
      description: 'Add my spouse as a named driver',
    });
  });

  it('sends proposed adjustments only when provided, and surfaces server errors verbatim', async () => {
    const fetchMock = mockFetchSequence({
      'memberEndorsements.myEndorsements': () => ({ endorsements: [], count: 0 }),
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
      'memberEndorsements.requestEndorsement': () => new Error('Policy not found'),
    });
    renderScreen(<EndorsementsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText(/POL-2026-001/));
    fireEvent.press(screen.getByText('reduction'));
    fireEvent.changeText(screen.getByLabelText('Effective date'), '2026-12-01');
    fireEvent.changeText(screen.getByLabelText('Description'), 'Reduce cover');
    fireEvent.changeText(screen.getByLabelText('Proposed premium adjustment'), '-2000');
    fireEvent.press(screen.getByText('Request endorsement'));
    expect(await screen.findByText('Policy not found')).toBeTruthy();
    expect(mutationInput(fetchMock, 'memberEndorsements.requestEndorsement')).toEqual({
      policyId: 1,
      type: 'reduction',
      effectiveDate: '2026-12-01',
      description: 'Reduce cover',
      premiumAdjustment: -2000,
    });
    expect(screen.queryByText(/Endorsement requested/)).toBeNull();
  });
});

describe('RenewalsScreen', () => {
  const RENEWAL_ROW = {
    id: 7, originalPolicyId: 1, policyNumber: 'POL-2026-001', status: 'pending',
    renewalDueDate: '2027-01-01', renewalPremium: '120000', isAutoRenewal: false,
    completedAt: null, createdAt: '2026-10-03', currency: 'NGN',
  };

  it('renders the real renewal list from memberRenewals.myRenewals', async () => {
    mockFetchSequence({
      'memberRenewals.myRenewals': () => ({ renewals: [RENEWAL_ROW], count: 1 }),
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
    });
    renderScreen(<RenewalsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('POL-2026-001')).toBeTruthy();
    expect(screen.getByText('₦120,000')).toBeTruthy();
    expect(screen.getByText(/1 renewal on your account/)).toBeTruthy();
  });

  it('shows the honest empty state', async () => {
    mockFetchSequence({
      'memberRenewals.myRenewals': () => ({ renewals: [], count: 0 }),
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
    });
    renderScreen(<RenewalsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('You have no renewals yet.')).toBeTruthy();
  });

  it('surfaces the server error verbatim instead of fabricated rows', async () => {
    mockFetchSequence({
      'memberRenewals.myRenewals': () => new Error('DB unavailable'),
      'memberPolicies.myPolicies': () => ({ policies: [], count: 0 }),
    });
    renderScreen(<RenewalsScreen navigation={mockNavigation} />);
    expect(await screen.findByText('DB unavailable')).toBeTruthy();
  });

  it('requestRenewal sends the exact server input {policyId, isAutoRenewal}', async () => {
    const fetchMock = mockFetchSequence({
      'memberRenewals.myRenewals': () => ({ renewals: [], count: 0 }),
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
      'memberRenewals.requestRenewal': () => ({ renewal: RENEWAL_ROW }),
    });
    renderScreen(<RenewalsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText(/POL-2026-001 —/));
    fireEvent.press(screen.getByText('Request renewal'));
    expect(await screen.findByText(/Renewal requested/)).toBeTruthy();
    expect(mutationInput(fetchMock, 'memberRenewals.requestRenewal')).toEqual({
      policyId: 1, isAutoRenewal: false,
    });
  });

  it('surfaces the server duplicate-guard error verbatim — no fake success', async () => {
    const fetchMock = mockFetchSequence({
      'memberRenewals.myRenewals': () => ({ renewals: [], count: 0 }),
      'memberPolicies.myPolicies': () => ({ policies: [POLICY_ROW], count: 1 }),
      'memberRenewals.requestRenewal': () => new Error('An open renewal already exists for this policy'),
    });
    renderScreen(<RenewalsScreen navigation={mockNavigation} />);
    fireEvent.press(await screen.findByText(/POL-2026-001 —/));
    fireEvent.press(screen.getByText('Request renewal'));
    expect(await screen.findByText('An open renewal already exists for this policy')).toBeTruthy();
    expect(screen.queryByText(/Renewal requested/)).toBeNull();
  });
});
