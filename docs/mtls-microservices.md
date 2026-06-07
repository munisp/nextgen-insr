# mTLS Between InsurePortal Platform and Platform Microservices

## Overview

Mutual TLS (mTLS) ensures that both the InsurePortal Platform server and each downstream microservice authenticate each other before any data is exchanged. This document describes the certificate authority (CA) hierarchy, certificate issuance workflow, and per-service configuration for all InsurePortal platform microservices.

---

## Certificate Authority Hierarchy

```
InsurePortal Root CA  (offline, HSM-protected)
└── InsurePortal Intermediate CA  (online, rotated every 90 days)
    ├── platform-shell.svc.insureportal.internal
    ├── kyc-service.svc.insureportal.internal
    ├── fraud-service.svc.insureportal.internal
    ├── settlement-service.svc.insureportal.internal
    ├── float-service.svc.insureportal.internal
    ├── analytics-service.svc.insureportal.internal
    ├── geofencing-service.svc.insureportal.internal
    └── tigerbeetle-sidecar.svc.insureportal.internal
```

All leaf certificates have a 30-day validity period and are automatically rotated via cert-manager (Kubernetes) or Vault PKI (bare-metal).

---

## Certificate Issuance (cert-manager)

```yaml
# k8s/certs/platform-shell-cert.yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: platform-shell-mtls
  namespace: insureportal
spec:
  secretName: platform-shell-mtls-tls
  duration: 720h # 30 days
  renewBefore: 168h # Renew 7 days before expiry
  subject:
    organizations: ["InsurePortal"]
  commonName: platform-shell.svc.insureportal.internal
  dnsNames:
    - platform-shell.svc.insureportal.internal
    - platform-shell.insureportal.svc.cluster.local
  issuerRef:
    name: insureportal-intermediate-ca
    kind: ClusterIssuer
```

---

## InsurePortal Platform Client Configuration

The InsurePortal Platform Node.js server uses the `https` module (or `node-fetch` with a custom agent) when calling platform microservices. The TLS agent is constructed once at startup and reused across all requests.

```typescript
// server/lib/mtlsAgent.ts
import https from "https";
import fs from "fs";
import path from "path";

const CERT_DIR = process.env.MTLS_CERT_DIR ?? "/etc/insureportal/certs";

let _agent: https.Agent | null = null;

export function getMtlsAgent(): https.Agent {
  if (_agent) return _agent;

  const certPath = path.join(CERT_DIR, "tls.crt");
  const keyPath = path.join(CERT_DIR, "tls.key");
  const caPath = path.join(CERT_DIR, "ca.crt");

  if (
    !fs.existsSync(certPath) ||
    !fs.existsSync(keyPath) ||
    !fs.existsSync(caPath)
  ) {
    console.warn(
      "[mTLS] Certificates not found — falling back to plain HTTPS (dev mode only)"
    );
    return new https.Agent({ rejectUnauthorized: false });
  }

  _agent = new https.Agent({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    ca: fs.readFileSync(caPath),
    rejectUnauthorized: true,
    // Enforce TLS 1.3 minimum
    minVersion: "TLSv1.3",
  });

  console.log("[mTLS] Agent initialised — cert:", certPath);
  return _agent;
}

/** Call on SIGHUP or cert rotation to force re-read of certificates. */
export function resetMtlsAgent(): void {
  _agent = null;
}
```

### Usage in Platform Client Helpers

```typescript
// server/lib/platformClient.ts (excerpt)
import { getMtlsAgent } from "./mtlsAgent";

export async function callPlatformService(
  url: string,
  body: unknown
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // @ts-expect-error — Node 18+ fetch accepts dispatcher; use undici for typed support
    agent: getMtlsAgent(),
  });
  if (!res.ok) throw new Error(`Platform service error: ${res.status}`);
  return res.json();
}
```

---

## Per-Service Configuration

| Service                      | Internal DNS                              | Port | Protocol          | Notes                    |
| ---------------------------- | ----------------------------------------- | ---- | ----------------- | ------------------------ |
| KYC Service (Python FastAPI) | `kyc-service.svc.insureportal.internal`         | 8443 | mTLS              | Liveness + OCR endpoints |
| Fraud Service (Go)           | `fraud-service.svc.insureportal.internal`       | 8443 | mTLS              | Real-time scoring        |
| Settlement Service (Rust)    | `settlement-service.svc.insureportal.internal`  | 8443 | mTLS              | ISO 8583 bridge          |
| Float Service (Go)           | `float-service.svc.insureportal.internal`       | 8443 | mTLS              | Balance + history        |
| Analytics Service (Python)   | `analytics-service.svc.insureportal.internal`   | 8443 | mTLS              | Metrics aggregation      |
| Geofencing Service (Go)      | `geofencing-service.svc.insureportal.internal`  | 8443 | mTLS              | Polygon enforcement      |
| TigerBeetle Sidecar          | `tigerbeetle-sidecar.svc.insureportal.internal` | 3001 | mTLS              | Offline-first ledger     |
| Keycloak                     | `keycloak.svc.insureportal.internal`            | 8443 | TLS (server-only) | OIDC discovery           |
| APISix Gateway               | `apisix.svc.insureportal.internal`              | 9443 | mTLS              | Upstream auth            |

---

## Dapr Sidecar Integration

When running under Dapr, mTLS between services is handled automatically by the Dapr control plane (SPIFFE/SPIRE). The InsurePortal Platform server communicates with Dapr via its local sidecar on `http://localhost:3500`, and Dapr handles certificate rotation transparently.

```yaml
# dapr/components/platform-shell-subscription.yaml
apiVersion: dapr.io/v1alpha1
kind: Subscription
metadata:
  name: platform-shell-events
spec:
  pubsubname: kafka-pubsub
  topic: transaction.created
  route: /api/dapr/transaction-created
  scopes:
    - platform-shell
```

Dapr mTLS is enabled by default in production mode. Verify with:

```bash
dapr mtls status -k
# Expected: mTLS is enabled in your Kubernetes cluster
```

---

## Certificate Rotation Procedure

1. cert-manager automatically renews certificates 7 days before expiry.
2. The new secret is written to the Kubernetes `Secret` object.
3. A `SIGHUP` is sent to the InsurePortal Platform pod via a cert-manager `CertificateRequest` webhook.
4. The InsurePortal Platform server calls `resetMtlsAgent()` on `SIGHUP` to force re-read of the new certificate.
5. In-flight requests complete with the old certificate; new requests use the new certificate.

```typescript
// server/_core/index.ts — add to signal handlers
process.on("SIGHUP", () => {
  console.log("[mTLS] SIGHUP received — reloading certificates");
  resetMtlsAgent();
});
```

---

## Verification

```bash
# Verify InsurePortal Platform certificate
openssl s_client \
  -connect platform-shell.svc.insureportal.internal:8443 \
  -cert /etc/insureportal/certs/tls.crt \
  -key  /etc/insureportal/certs/tls.key \
  -CAfile /etc/insureportal/certs/ca.crt \
  -verify_return_error

# Check certificate expiry
openssl x509 -in /etc/insureportal/certs/tls.crt -noout -dates

# Verify Dapr mTLS
dapr mtls status -k
```

---

## Environment Variables

| Variable                  | Default                 | Description                                         |
| ------------------------- | ----------------------- | --------------------------------------------------- |
| `MTLS_CERT_DIR`           | `/etc/insureportal/certs`     | Directory containing `tls.crt`, `tls.key`, `ca.crt` |
| `MTLS_ENABLED`            | `true` in production    | Set to `false` to bypass mTLS (dev/test only)       |
| `PLATFORM_KYC_URL`        | —                       | Full URL of KYC service including scheme and port   |
| `PLATFORM_FRAUD_URL`      | —                       | Full URL of Fraud service                           |
| `PLATFORM_SETTLEMENT_URL` | —                       | Full URL of Settlement service                      |
| `PLATFORM_FLOAT_URL`      | —                       | Full URL of Float service                           |
| `PLATFORM_ANALYTICS_URL`  | —                       | Full URL of Analytics service                       |
| `PLATFORM_GEOFENCING_URL` | —                       | Full URL of Geofencing service                      |
| `TB_SIDECAR_URL`          | `http://localhost:3001` | TigerBeetle sidecar (local, no mTLS)                |

---

_Last updated: 2026-03-31 — Production Readiness Sprint Phase 94_
