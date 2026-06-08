# mTLS Certificate Setup Guide

This guide covers generating development/staging certificates and wiring them into the POS Shell server.

## Quick Start (Development — Self-Signed)

```bash
# 1. Create a local CA
mkdir -p /etc/insureportal/certs && cd /etc/insureportal/certs

openssl genrsa -out ca.key 4096
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
  -subj "/CN=InsurePortal Dev CA/O=InsurePortal/C=NG"

# 2. Generate POS Shell certificate
openssl genrsa -out tls.key 2048
openssl req -new -key tls.key -out tls.csr \
  -subj "/CN=agent-dashboard.svc.insureportal.internal/O=InsurePortal/C=NG"
openssl x509 -req -days 30 -in tls.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out tls.crt

# 3. Set environment variable
export MTLS_CERT_DIR=/etc/insureportal/certs
```

## Production (cert-manager)

See `docs/mtls-microservices.md` for the full cert-manager `Certificate` resource and CA hierarchy.

## Environment Variables

| Variable        | Default             | Description                                   |
| --------------- | ------------------- | --------------------------------------------- |
| `MTLS_CERT_DIR` | `/etc/insureportal/certs` | Directory with `tls.crt`, `tls.key`, `ca.crt` |
| `MTLS_ENABLED`  | `true`              | Set `false` to bypass mTLS (dev only)         |

## Wiring into platformClient.ts

```typescript
import { getMtlsAgent } from "../lib/mtlsAgent";

// Pass agent to fetch calls
const res = await fetch(url, {
  method: "POST",
  body: JSON.stringify(payload),
  // @ts-expect-error — Node fetch agent
  agent: getMtlsAgent(),
});
```

See `docs/mtls-microservices.md` for the full `getMtlsAgent()` implementation.
