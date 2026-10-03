/**
 * jest.setup.js — 2026-10-01 (W9-B3)
 * Jest harness for the mobile app. Mocks here are at NATIVE-MODULE
 * boundaries only (react-native-app-auth performs the OIDC flow in the
 * system browser; AsyncStorage is the device key-value store) — no
 * application logic is mocked on production paths.
 */

// AsyncStorage ships an in-memory jest mock — real storage semantics.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// react-native-app-auth is a native bridge; in tests we control its
// authorize/refresh/revoke results per-test.
jest.mock('react-native-app-auth', () => ({
  authorize: jest.fn(),
  refresh: jest.fn(),
  revoke: jest.fn(),
}));

// react-native-biometrics is a native bridge (keystore/Secure Enclave).
jest.mock('react-native-biometrics', () => {
  return jest.fn().mockImplementation(() => ({
    isSensorAvailable: jest.fn().mockResolvedValue({ available: false, biometryType: null }),
    simplePrompt: jest.fn().mockResolvedValue({ success: false }),
    createKeys: jest.fn().mockResolvedValue({ publicKey: 'test-key' }),
    deleteKeys: jest.fn().mockResolvedValue({ keysDeleted: true }),
    createSignature: jest.fn().mockResolvedValue({ success: false }),
  }));
});

// 2026-10-03 (W9-B6): additional NATIVE-MODULE boundary mocks so the screen
// smoke suites can run under jest. Still no application logic mocked here.
// @react-native-community/netinfo is the OS connectivity bridge.
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
    fetch: jest.fn(async () => ({ isConnected: true, type: 'wifi', isInternetReachable: true, details: null })),
  },
}));

// react-native-geolocation-service is the OS location bridge. Suites control
// getCurrentPosition behavior per-test via the exported jest.fn.
jest.mock('react-native-geolocation-service', () => ({
  __esModule: true,
  default: {
    getCurrentPosition: jest.fn(),
    watchPosition: jest.fn(() => 0),
    clearWatch: jest.fn(),
  },
}));

// react-native-image-picker is the OS camera/gallery bridge.
jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));

// Other native modules not exercised by the current test suites are left
// unmocked; suites that need them declare their own mocks at the boundary.
