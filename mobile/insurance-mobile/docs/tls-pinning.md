# TLS Certificate Pinning — Deployment-Time Scaffolding (W10-B6, 2026-10-05)

**Status: NOT ACTIVE.** This package has no `android/` or `ios/` native
projects (see `BUILD.md` — Expo managed/payload-source state). Certificate
pinning cannot be enabled from JavaScript; everything below is exact,
ready-to-apply configuration for the moment native projects are generated
(`npx expo prebuild` or bare workflow eject). Do not represent the JS
domain allowlist (`src/services/domainAllowlist.ts`) as TLS pinning — it
is a fail-closed egress allowlist only.

## Pin set

Pin **SPKI SHA-256 hashes** (not leaf certificates) for:

- `api.insureportal.ng`
- `auth.insureportal.ng`
- `api.54link.ng`
- `staging.54link.ng` (staging builds only)

For each host pin **two** hashes: the current SPKI and a **backup pin**
(next/rotation key or the intermediate CA SPKI). A single pin with no
backup will brick the app at certificate rotation.

Obtain the current SPKI hash:

```sh
openssl s_client -connect api.insureportal.ng:443 -servername api.insureportal.ng \
  </dev/null 2>/dev/null | openssl x509 -pubkey -noout \
  | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64
```

Record every pin, its source host, and the retrieval date in the deploy
runbook before shipping.

## Android (`android/app/src/main/res/xml/network_security_config.xml`)

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <domain-config cleartextTrafficPermitted="false">
    <domain includeSubdomains="false">api.insureportal.ng</domain>
    <domain includeSubdomains="false">auth.insureportal.ng</domain>
    <domain includeSubdomains="false">api.54link.ng</domain>
    <pin-set expiration="2027-10-01">
      <!-- CURRENT_SPKI_B64 / BACKUP_SPKI_B64 per host are the same pin-set;
           replace before the expiration date or the app fails closed. -->
      <pin digest="SHA-256">CURRENT_SPKI_B64</pin>
      <pin digest="SHA-256">BACKUP_SPKI_B64</pin>
    </pin-set>
  </domain-config>
</network-security-config>
```

Reference it from `android/app/src/main/AndroidManifest.xml`:

```xml
<application android:networkSecurityConfig="@xml/network_security_config" ...>
```

Because React Native's fetch/WebSocket traffic rides OkHttp, the manifest
config covers it. If any native module constructs its own OkHttpClient,
it must also get:

```java
CertificatePinner pinner = new CertificatePinner.Builder()
    .add("api.insureportal.ng", "sha256/CURRENT_SPKI_B64")
    .add("api.insureportal.ng", "sha256/BACKUP_SPKI_B64")
    .build();
```

## iOS (TrustKit via `Info.plist`)

```xml
<key>TSKConfiguration</key>
<dict>
  <key>TSKPinnedDomains</key>
  <dict>
    <key>api.insureportal.ng</key>
    <dict>
      <key>TSKPublicKeyHashes</key>
      <array>
        <string>CURRENT_SPKI_B64</string>
        <string>BACKUP_SPKI_B64</string>
      </array>
      <key>TSKIncludeSubdomains</key><false/>
      <key>TSKDisableDefaultReportUri</key><true/>
    </dict>
  </dict>
</dict>
```

Repeat per host. TrustKit must be initialised in the app delegate for
RN networking to route through it; alternatively use
`react-native-ssl-pinning` for the fetch layer — either way, ONE mechanism,
verified with a hostile proxy test.

## OIDC / system-browser boundary

`react-native-app-auth` completes the Keycloak flow in the system browser
(ASWebAuthenticationSession / Custom Tab). Pinning does not apply there —
that traffic is protected by the OS trust store plus the authorization-code
+ PKCE exchange. Pin the API host; rely on PKCE for the auth host in the
browser, and keep `auth.insureportal.ng` pinned for the in-app token
exchange/refresh calls that go through the RN networking stack.

## Verification gate before release

1. `mitmproxy`/Charles with a trusted-on-device CA: all allowlisted API
   calls MUST fail (handshake abort). Any success = pinning broken, block
   release.
2. Rotate to a cert whose SPKI is NOT in the pin-set on staging: app must
   fail closed.
3. Confirm the backup pin works by serving the backup-keyed cert on
   staging.

Fail-closed by design: a pin mismatch must be a hard network error, never
a bypassable warning.
