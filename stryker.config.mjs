// @ts-check
/**
 * Stryker mutation testing configuration — billing-critical routers (Sprint 85, L5).
 *
 * Run: npx stryker run
 * Real config: mutates the billing routers whose behavior is covered by the
 * vitest suite; test files are excluded from mutation.
 */
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: 'pnpm',
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.ts',
  },
  mutate: [
    'server/routers/billingLedger.ts',
    'server/routers/billingInvoice.ts',
    'server/routers/billingRbac.ts',
    'server/routers/billingAudit.ts',
    'server/routers/revenueReconciliation.ts',
    '!**/*.test.ts',
    '!**/*.spec.ts',
  ],
  reporters: ['html', 'json', 'clear-text'],
  htmlReporter: {
    fileName: 'reports/mutation/mutation-report.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation-report.json',
  },
  thresholds: { high: 90, low: 70, break: 60 },
  timeoutMS: 120000,
  concurrency: 2,
};
