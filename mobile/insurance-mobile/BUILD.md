# Mobile Build Reality — 2026-10-03 (W9-B6)

Honest statement of what exists and what does not. Nothing in this document
claims a runnable native build that has not been produced.

## What this package is

`mobile/insurance-mobile` is a **bare React Native 0.73.4** JavaScript
project. There are **no `ios/` or `android/` native projects committed**,
and this repository does not contain a generated/native shell for this app.

## Expo reality check (performed 2026-10-03)

- `package.json` has **no `expo` dependency** — this is not an Expo project
  today, so `npx expo prebuild` is not currently an available step.
- The dependency set is native-heavy: `react-native-app-auth` (OIDC in the
  system browser), `react-native-sqlite-storage`, `react-native-biometrics`,
  `react-native-camera`, `react-native-push-notification`,
  `react-native-background-fetch`. These are **NOT compatible with Expo Go**.
  They *could* work under an Expo **prebuild / development-client** workflow,
  but several (e.g. `react-native-app-auth`, `react-native-background-fetch`)
  require config plugins or manual native configuration that do not exist in
  this repo. Adopting Expo would be a migration (add `expo`, write/verify
  config plugins, regenerate with `npx expo prebuild`), not a config flag —
  and it has NOT been done or verified here. We do not claim it works.

## What is actually required to build

1. Generate or restore the native shells (one of):
   - scaffold a bare RN 0.73 app (`npx react-native@0.73 init`) and copy
     `App.tsx`, `src/`, and the dependency native configuration into it; or
   - perform the Expo migration above and run `npx expo prebuild`
     (unverified — see reality check).
2. Install native deps (`cd ios && pod install`; Android via Gradle).
3. Provide the required build-time env (`API_URL`, `MONOLITH_API_URL`,
   `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_REDIRECT_URI`) — the JS
   layer fails closed without them in production (`src/config.ts`,
   `src/services/keycloakAuth.ts`).
4. `npm run android` / `npm run ios`.

The `android`/`ios` npm scripts assume those native projects exist; running
them from this tree as-is will fail. That is the truth, not a bug we hid.

## JS-layer verification that DOES work today

From this directory:

```sh
npm ci --legacy-peer-deps   # installs cleanly from the committed lockfile
npm test                    # jest: full suite green (see W9-B6 report)
npx tsc --noEmit            # type-check clean
```

## Residual security item — TLS certificate pinning

The JS layer now enforces the `PINNED_DOMAINS` **domain allowlist**
(`src/services/domainAllowlist.ts`) on every network egress path
(fail-closed, before any network I/O). This is **domain-allowlisting, NOT
certificate pinning**. True TLS pinning (SHA-256 SPKI hashes, with rotation
pins, for `api.insureportal.ng`, `auth.insureportal.ng`, `api.54link.ng`,
`staging.54link.ng`) must be configured in the native layer once native
projects exist — e.g. TrustKit (iOS) and `network_security_config` + OkHttp
`CertificatePinner` (Android), plus a trust-decision path for the OIDC
system-browser traffic. Recorded here as an open residual; do not represent
the JS allowlist as TLS pinning.
