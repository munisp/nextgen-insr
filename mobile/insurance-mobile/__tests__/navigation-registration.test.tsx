/**
 * navigation-registration.test.tsx — 2026-10-03 (W9-B5 wave 3 round 2)
 *
 * Regression test for the dead-end navigation finding: PhoneVerificationScreen
 * was imported in AppNavigator.tsx and the Dashboard "Verify Phone" tile
 * navigated to Profile > PhoneVerification, but no Stack.Screen was registered
 * in ProfileStack — the tile dead-ended at runtime. The screen harness tests
 * (screens-money.test.tsx) render screens with a mock navigation object and
 * therefore can never catch a missing registration.
 *
 * This test closes that gap by statically cross-checking the two REAL source
 * files (fail-closed: it reads production source, no mocks, no fabrication):
 *
 *   1. Every Dashboard quick-action navigation target
 *      (navigation.navigate(screen, params)) is extracted from
 *      src/screens/DashboardScreen.tsx.
 *   2. Every Stack.Screen / Tab.Screen registration is extracted from
 *      src/navigation/AppNavigator.tsx, grouped by the navigator function
 *      (PoliciesStack / ClaimsStack / ProfileStack / MainTabs / AppNavigator).
 *   3. Each quick-action target must resolve: tab targets with a nested
 *      `params.screen` must be registered inside the stack mounted on that
 *      tab; bare targets must be a tab or a top-level authenticated screen.
 *
 * It covers ALL waves' screens (Quotes/Endorsements/Renewals/Savings/Loyalty/
 * Referrals/Disputes/Bills/Airtime/Fx/Parametric/PhoneVerification) plus the
 * pre-wave actions (FileClaim/Payments/AgentLocator/Emergency). Verified
 * non-vacuous: deleting the PhoneVerification registration from AppNavigator
 * makes this test fail with a missing-registration error.
 *
 * 2026-10-06 (W10-B5): the memberFundsIntent capture panels now navigate to
 * the 'PaystackCheckout' WebView screen — a cross-check asserts every
 * navigation.navigate target inside src/screens/memberFundsIntent.tsx is
 * registered in PoliciesStack (the stack hosting Bills/Airtime). Verified
 * non-vacuous: deleting the PaystackCheckout registration fails that check.
 */
import * as fs from 'fs';
import * as path from 'path';

const NAVIGATOR_PATH = path.join(__dirname, '..', 'src', 'navigation', 'AppNavigator.tsx');
const DASHBOARD_PATH = path.join(__dirname, '..', 'src', 'screens', 'DashboardScreen.tsx');
const FUNDS_INTENT_PATH = path.join(__dirname, '..', 'src', 'screens', 'memberFundsIntent.tsx');

/** Registered screen names per navigator component (order-independent). */
function extractRegistrations(source: string): Record<string, string[]> {
  const registrations: Record<string, string[]> = {};
  // Match `function X() { return ( <X.Navigator ...> ... </X.Navigator> ); }`
  // blocks and the JSX children of AppNavigator's conditional render.
  const funcRegex = /function (\w+)\(\) \{([\s\S]*?)\n\}/g;
  let m: RegExpExecArray | null;
  while ((m = funcRegex.exec(source)) !== null) {
    const [, name, body] = m;
    const screens: string[] = [];
    const screenRegex = /(?:Stack|Tab)\.Screen name="(\w+)"/g;
    let s: RegExpExecArray | null;
    while ((s = screenRegex.exec(body)) !== null) screens.push(s[1]);
    registrations[name] = screens;
  }
  return registrations;
}

interface QuickAction { screen: string; nested?: string }

/** Every `navigation.navigate('X', ...)` target in an arbitrary source file. */
function extractNavigateTargets(source: string): string[] {
  const targets: string[] = [];
  const navRegex = /navigate\('(\w+)'/g;
  let m: RegExpExecArray | null;
  while ((m = navRegex.exec(source)) !== null) targets.push(m[1]);
  return targets;
}

/** Every `navigation.navigate('X', ...)` quick-action target in the Dashboard. */
function extractDashboardTargets(source: string): QuickAction[] {
  const targets: QuickAction[] = [];
  const actionRegex = /\{ label: '([^']+)', icon: '[^']*', screen: '(\w+)'(?:, params: \{ screen: '(\w+)' \})? \}/g;
  let m: RegExpExecArray | null;
  while ((m = actionRegex.exec(source)) !== null) {
    targets.push({ screen: m[2], nested: m[3] });
  }
  return targets;
}

describe('navigation registration (real AppNavigator vs real Dashboard targets)', () => {
  const navSource = fs.readFileSync(NAVIGATOR_PATH, 'utf8');
  const dashSource = fs.readFileSync(DASHBOARD_PATH, 'utf8');
  const registrations = extractRegistrations(navSource);
  const targets = extractDashboardTargets(dashSource);

  // Tab name -> the stack function mounted on that tab (from MainTabs JSX).
  const tabToStack: Record<string, string> = {
    Policies: 'PoliciesStack',
    Claims: 'ClaimsStack',
    Profile: 'ProfileStack',
  };
  // Tabs that host a single screen directly (no nested stack).
  const directTabs = ['Home', 'Payments'];

  it('parses a non-trivial set of registrations and targets (guard against vacuous regex)', () => {
    expect(registrations.PoliciesStack?.length).toBeGreaterThanOrEqual(13);
    expect(registrations.ProfileStack?.length).toBeGreaterThanOrEqual(8);
    expect(registrations.ClaimsStack?.length).toBeGreaterThanOrEqual(3);
    expect(registrations.MainTabs).toEqual(
      expect.arrayContaining(['Home', 'Policies', 'Claims', 'Payments', 'Profile']),
    );
    expect(targets.length).toBeGreaterThanOrEqual(16);
  });

  it('every Dashboard quick-action target resolves to a real registered screen', () => {
    const topLevel = registrations.AppNavigator ?? [];
    const failures: string[] = [];
    for (const target of targets) {
      const stackName = tabToStack[target.screen];
      if (stackName) {
        const stackScreens = registrations[stackName] ?? [];
        if (target.nested) {
          if (!stackScreens.includes(target.nested)) {
            failures.push(
              `Dashboard -> ${target.screen} > ${target.nested}: "${target.nested}" is NOT registered in ${stackName} (registered: ${stackScreens.join(', ')})`,
            );
          }
        } else if (!stackScreens.length) {
          failures.push(`Dashboard -> ${target.screen}: ${stackName} has no registered screens`);
        }
      } else if (directTabs.includes(target.screen)) {
        // Direct tab with a single screen — nested params would be meaningless.
        if (target.nested) {
          failures.push(`Dashboard -> ${target.screen} > ${target.nested}: ${target.screen} tab has no nested stack`);
        }
      } else if (!topLevel.includes(target.screen)) {
        failures.push(
          `Dashboard -> ${target.screen}: not a tab and NOT a registered top-level screen (registered: ${topLevel.join(', ')})`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  it('specifically covers all W9-B5 wave screens plus the PhoneVerification regression', () => {
    const policies = registrations.PoliciesStack ?? [];
    for (const name of [
      'Quotes', 'Endorsements', 'Renewals',           // wave 1
      'Savings', 'Loyalty', 'Referrals', 'Disputes',  // wave 2
      'Bills', 'Airtime', 'Fx', 'Parametric',         // wave 3
    ]) {
      expect(policies).toContain(name);
    }
    // The exact regression: Dashboard targets Profile > PhoneVerification.
    expect(registrations.ProfileStack ?? []).toContain('PhoneVerification');
    expect(targets).toContainEqual({ screen: 'Profile', nested: 'PhoneVerification' });
  });

  it('every memberFundsIntent checkout navigation target is registered in PoliciesStack (W10-B5)', () => {
    const intentSource = fs.readFileSync(FUNDS_INTENT_PATH, 'utf8');
    const intentTargets = extractNavigateTargets(intentSource);
    // Guard against vacuous regex: the W10-B5 handoff MUST be detected.
    expect(intentTargets).toContain('PaystackCheckout');
    const policies = registrations.PoliciesStack ?? [];
    const failures = intentTargets.filter((t) => !policies.includes(t));
    expect(failures).toEqual([]);
  });
});
