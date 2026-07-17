# Caddy Integration Report — InsurePortal Platform

**Date:** July 2026
**Scope:** Full integration of [Caddy](https://github.com/caddyserver/caddy) as the TLS-terminating edge proxy, OIDC forward-auth layer, WAF integration point, and internal mTLS service mesh for the InsurePortal platform.

---

## 1. What Value Does Caddy Add?

The InsurePortal platform already has a sophisticated API gateway (APISIX), a WAF (OpenAppSec), and an identity provider (Keycloak). The question is whether Caddy adds genuine, non-overlapping value. The answer is **yes, across five distinct dimensions** that none of the existing components address.

### 1.1 Automatic HTTPS with Zero Configuration

APISIX does not manage TLS certificates. The existing platform has no certificate management solution — certificates must be manually provisioned, uploaded to Kubernetes secrets, and manually renewed before expiry. This is a critical operational risk for a financial services platform.

Caddy is the **only web server that manages its own TLS certificates end-to-end**. It provisions certificates from Let's Encrypt or ZeroSSL via the ACME protocol, stores them persistently, and renews them automatically at two-thirds of their lifetime. For the InsurePortal platform, this means:

- The primary domain (`insureportal.ng`) gets a certificate automatically on first startup.
- All broker sub-domains (`broker1.brokers.insureportal.ng`, `broker2.brokers.insureportal.ng`, etc.) get certificates on-demand via Caddy's **On-Demand TLS** feature. This is critical for the multi-tenant broker portal architecture — without it, a new broker onboarding would require a manual certificate provisioning step.
- Caddy's internal PKI (powered by Smallstep libraries) issues certificates for internal service-to-service communication (mTLS), eliminating the need for a separate cert-manager deployment.

### 1.2 HTTP/3 (QUIC) Support

APISIX OSS does not support HTTP/3. Caddy supports HTTP/3 out of the box with a single configuration line. For Nigerian and African users on mobile networks with high packet loss, HTTP/3's QUIC transport provides measurably better performance because QUIC handles packet loss at the transport layer without the head-of-line blocking that affects HTTP/2 over TCP. This directly addresses the platform's goal of serving users on 3G/4G networks across Africa.

### 1.3 Brotli and Zstd Compression

APISIX OSS only supports gzip compression. Caddy supports Brotli and Zstd, which achieve 15–25% better compression ratios than gzip for JSON API responses. For a platform serving users on metered mobile data connections in Nigeria, this reduces data costs for every API call.

### 1.4 Edge-Level OIDC Forward Auth (Before APISIX)

APISIX's `jwt-auth` plugin validates JWT tokens, but it does so **after** the request has already entered the API gateway. This means unauthenticated requests consume APISIX resources and can reach the gateway's routing layer.

Caddy's `forward_auth` directive, combined with the `oauth2-proxy` sidecar (configured against Keycloak), validates tokens **at the edge** — before the request reaches APISIX. This provides:

- A second independent authentication layer (defence in depth).
- Propagation of validated identity headers (`X-Auth-User`, `X-Auth-Email`, `X-Auth-Roles`) downstream to APISIX and all microservices.
- A centralised login redirect for browser-based clients (APISIX returns 401; Caddy redirects to Keycloak login).

### 1.5 Internal mTLS Service Mesh (Without Istio)

The platform has 15+ microservices communicating over plain HTTP internally. This is a significant security gap — any compromised service can impersonate any other. Istio and Linkerd are the standard solutions but add significant operational complexity.

Caddy's internal PKI can act as a lightweight service mesh CA. Each service runs a Caddy sidecar that:
- Issues a client certificate to the service using Caddy's internal CA.
- Requires all inbound connections to present a valid certificate from the same CA.
- Automatically rotates certificates before expiry.

This provides zero-trust mTLS between all services without the overhead of a full service mesh.

---

## 2. Integration Architecture

The following diagram shows how Caddy integrates with the existing platform components:

```
Internet
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  Caddy Edge Proxy (ports 80/443/443-UDP)                    │
│                                                             │
│  ① Automatic HTTPS (ZeroSSL/Let's Encrypt)                  │
│  ② HTTP/3 (QUIC) + Brotli/Zstd compression                 │
│  ③ Security headers (HSTS, CSP, X-Frame-Options)           │
│  ④ Rate limiting (per-zone: auth/payment/api/broker)        │
│  ⑤ forward_auth → OpenAppSec standalone agent (WAF check)  │
│  ⑥ forward_auth → oauth2-proxy → Keycloak (OIDC check)     │
│  ⑦ Passes X-Auth-User/Email/Roles headers downstream       │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP (internal, validated)
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  APISIX API Gateway (port 9080)                             │
│                                                             │
│  - JWT validation (second layer, APISIX jwt-auth plugin)   │
│  - Route matching (83 routes across all services)          │
│  - OpenAppSec WAF attachment (NGINX module on APISIX)      │
│  - Prometheus metrics, rate limiting, circuit breaker      │
└──────────────────────────┬──────────────────────────────────┘
                           │ mTLS (Caddy sidecar per service)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Microservices (mTLS via Caddy sidecar)                      │
│                                                              │
│  insureportal (Node.js)  │  ussd-gateway (Go)               │
│  reinsurance-svc (Go)    │  takaful-engine (Go)              │
│  parametric-engine (Go)  │  python-analytics (Python)        │
│  fraud-detection (Rust)  │  ... 8 more services             │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Files Implemented

The following files were created as part of this integration:

| File | Purpose |
| :--- | :--- |
| `infra/caddy/Caddyfile` | Main Caddy configuration: TLS, HTTP/3, rate limiting, forward-auth, APISIX upstream routing, broker on-demand TLS, sub-domain routing for all services |
| `infra/caddy/Dockerfile` | Multi-stage build producing a custom Caddy binary with 6 plugins: `caddy-ratelimit`, `caddy-security`, `caddy-dns/cloudflare`, `transform-encoder`, `maxmind-geolocation`, `caddy-crowdsec-bouncer` |
| `infra/caddy/docker-compose.caddy.yml` | Docker Compose extension adding Caddy, OpenAppSec standalone agent, and oauth2-proxy (Keycloak forward-auth) as new services |
| `infra/caddy/config/security.json` | `caddy-security` (authcrunch) configuration for native Keycloak OIDC integration |
| `infra/caddy/config/internal-mtls.Caddyfile` | Reusable Caddyfile fragment for service-to-service mTLS using Caddy's internal CA |
| `infra/caddy/config/openappsec-agent.yaml` | OpenAppSec standalone agent configuration for Caddy WAF integration |
| `infra/caddy/config/keycloak-caddy-client.json` | Keycloak client definition for the `caddy-edge` OIDC client, with role mappers for `X-Auth-Roles` header propagation |
| `infra/caddy/scripts/caddy-admin.sh` | Admin API management script: reload, add/remove broker sub-domains, list certs, force renewal, fetch metrics |
| `infra/helm/caddy/Chart.yaml` | Helm chart metadata |
| `infra/helm/caddy/values.yaml` | Helm values: replicas, HPA, PDB, topology spread, network policy, resource limits, secrets references |
| `infra/helm/caddy/templates/deployment.yaml` | Kubernetes Deployment with security context, probes, and volume mounts |
| `infra/helm/caddy/templates/service.yaml` | LoadBalancer service (HTTP/HTTPS/QUIC) + ClusterIP admin service |
| `infra/helm/caddy/templates/configmap.yaml` | ConfigMap, PDB, and HPA templates |
| `infra/helm/caddy/templates/_helpers.tpl` | Helm template helpers |
| `.github/workflows/caddy-build.yml` | GitHub Actions workflow: Caddyfile validation, multi-arch Docker build, Helm lint |

---

## 4. How Caddy Integrates with Each Platform Component

### 4.1 Caddy ↔ APISIX

Caddy sits **in front of** APISIX. APISIX listens on port 9080 (HTTP only, internal). Caddy handles all TLS termination, then forwards validated requests to APISIX over plain HTTP on the internal network. This is the standard pattern for separating TLS concerns from API gateway routing concerns.

APISIX's existing `openappsec` plugin continues to operate as a NGINX module attachment on APISIX — this provides WAF protection for requests that bypass Caddy (e.g., internal service-to-service calls that go directly to APISIX). Caddy's OpenAppSec standalone agent provides an additional WAF check at the edge.

The `X-Caddy-Authenticated: true` header is added by Caddy to all requests that have passed OIDC validation. APISIX can use this header to skip redundant JWT validation for already-authenticated requests, reducing latency.

### 4.2 Caddy ↔ Keycloak

The integration uses a two-component pattern:

1. **oauth2-proxy** (a Keycloak-compatible OIDC forward-auth proxy) runs as a sidecar. It handles the OAuth2 authorization code flow, manages session cookies in Redis, and exposes a `/api/verify` endpoint that Caddy's `forward_auth` directive calls.

2. **caddy-security** (the authcrunch plugin) provides native OIDC token validation within Caddy itself, without requiring oauth2-proxy. This is used for the Grafana and analytics sub-domains where a full login flow is needed.

A new Keycloak client (`caddy-edge`) is defined in `keycloak-caddy-client.json` with the correct redirect URIs, role mappers, and token lifetime settings. This client must be imported into the `insureportal` realm before deploying Caddy.

### 4.3 Caddy ↔ OpenAppSec

OpenAppSec natively supports NGINX and Kong as attachment points. Since Caddy is not NGINX, OpenAppSec cannot attach as a module. Instead, a new **standalone OpenAppSec agent** runs as a separate container, exposing an HTTP check endpoint on port 8090.

Caddy's `forward_auth` directive sends a pre-check request to this agent for every non-health-check request. The agent responds with 200 (allow) or 403 (block). This preserves the full ML-based WAF protection of OpenAppSec at the Caddy edge layer, in addition to the existing APISIX-attached OpenAppSec instance.

### 4.4 Caddy ↔ Internal Microservices (mTLS)

The `infra/caddy/config/internal-mtls.Caddyfile` fragment defines a reusable mTLS sidecar configuration. Each microservice's deployment adds a Caddy sidecar container that:

- Listens on port 8443 with mTLS required (using Caddy's internal CA).
- Forwards validated requests to the service's plain HTTP port.
- Presents the service's client certificate when making outbound calls to other services.

The Caddy internal CA (`insureportal-internal`) issues all service certificates automatically. No manual certificate management is required.

### 4.5 Caddy ↔ Redis

oauth2-proxy uses Redis (the existing Redis instance on database 3) to store session state. This means Keycloak sessions are shared across all Caddy replicas — a user authenticated on one Caddy pod does not need to re-authenticate when load-balanced to another pod.

### 4.6 Caddy ↔ Grafana / Jaeger / Analytics

Each internal tool sub-domain is protected by Caddy's `forward_auth` directive, requiring a valid Keycloak session before access is granted. Jaeger is additionally restricted to internal network IP ranges only, preventing public access to distributed traces.

---

## 5. Plugins Included in the Custom Build

| Plugin | Purpose | Why Needed |
| :--- | :--- | :--- |
| `caddy-ratelimit` | Per-zone rate limiting with sliding window | Caddy OSS has no rate limiting; APISIX rate limiting is post-routing |
| `caddy-security` (authcrunch) | Native OIDC/OAuth2 against Keycloak | Enables full login flow without oauth2-proxy for some routes |
| `caddy-dns/cloudflare` | DNS-01 ACME challenge for wildcard certs | Required for `*.brokers.insureportal.ng` wildcard certificate |
| `transform-encoder` | Response body transformation | Multi-tenancy: inject broker branding into responses |
| `maxmind-geolocation` | GeoIP-based access control | Block requests from OFAC-sanctioned countries (compliance) |
| `caddy-crowdsec-bouncer` | CrowdSec IP reputation blocking | Block known malicious IPs before they reach APISIX |

---

## 6. On-Demand TLS for Broker Portals

This is the single most operationally significant feature Caddy adds. The platform supports hundreds of insurance broker portals, each on their own sub-domain. Without On-Demand TLS, every new broker onboarding requires:

1. A DevOps engineer to provision a TLS certificate via Let's Encrypt.
2. The certificate to be stored as a Kubernetes secret.
3. The Ingress/APISIX configuration to be updated.
4. A deployment to apply the changes.

With Caddy's On-Demand TLS, the process is:

1. A new broker is created in the database.
2. Their sub-domain (`newbroker.brokers.insureportal.ng`) is created in DNS.
3. The first HTTPS request to that sub-domain triggers Caddy to automatically provision a certificate from ZeroSSL.
4. All subsequent requests are served over HTTPS with a valid certificate.

No manual steps. No DevOps involvement. No deployment required.

---

## 7. Deployment Instructions

### Docker Compose (Development/Staging)

```bash
# Add required environment variables to .env
echo "KEYCLOAK_CADDY_CLIENT_SECRET=<generate-secret>" >> insureportal/.env
echo "OAUTH2_PROXY_COOKIE_SECRET=$(openssl rand -base64 32)" >> insureportal/.env
echo "CADDY_JWT_SECRET=$(openssl rand -base64 32)" >> insureportal/.env
echo "OPENAPPSEC_AGENT_TOKEN=<your-token>" >> insureportal/.env

# Import the Keycloak client
docker exec insureportal-keycloak /opt/keycloak/bin/kcadm.sh \
    create clients -r insureportal \
    -f /opt/keycloak/data/import/caddy-client.json

# Start Caddy alongside the existing stack
docker-compose \
    -f infra/docker-compose.yml \
    -f infra/caddy/docker-compose.caddy.yml \
    up -d caddy keycloak-auth-proxy openappsec-standalone
```

### Kubernetes (Production)

```bash
# Create secrets
kubectl create secret generic caddy-keycloak-secret \
    --from-literal=client-secret="$KEYCLOAK_CADDY_CLIENT_SECRET" \
    -n insureportal

kubectl create secret generic caddy-jwt-secret \
    --from-literal=jwt-secret="$CADDY_JWT_SECRET" \
    -n insureportal

kubectl create secret generic caddy-cookie-secret \
    --from-literal=cookie-secret="$OAUTH2_PROXY_COOKIE_SECRET" \
    -n insureportal

kubectl create secret generic openappsec-secret \
    --from-literal=agent-token="$OPENAPPSEC_AGENT_TOKEN" \
    -n insureportal

# Deploy via Helm
helm upgrade --install insureportal-caddy infra/helm/caddy/ \
    --namespace insureportal \
    --set domain.primary=insureportal.ng \
    --set domain.acmeEmail=ops@insureportal.ng \
    --values infra/helm/caddy/values.yaml
```

---

## 8. Summary Scorecard

| Capability | Before Caddy | After Caddy |
| :--- | :---: | :---: |
| Automatic TLS certificate management | ❌ Manual | ✅ Automatic (ZeroSSL/Let's Encrypt) |
| On-demand TLS for broker portals | ❌ Manual per broker | ✅ Automatic on first request |
| HTTP/3 (QUIC) for mobile users | ❌ Not available | ✅ Enabled globally |
| Brotli/Zstd compression | ❌ Gzip only | ✅ Brotli + Zstd + Gzip |
| Edge OIDC validation (before APISIX) | ❌ APISIX-level only | ✅ Edge + APISIX (double validation) |
| Internal mTLS between services | ❌ Plain HTTP | ✅ mTLS via Caddy internal CA |
| WAF at edge (before APISIX) | ❌ APISIX-level only | ✅ Edge (standalone) + APISIX |
| GeoIP blocking (OFAC compliance) | ❌ Not implemented | ✅ MaxMind GeoIP at edge |
| CrowdSec IP reputation blocking | ❌ Not implemented | ✅ CrowdSec bouncer at edge |
| Per-zone rate limiting at edge | ❌ APISIX-level only | ✅ Edge rate limiting per zone |
| Security headers (HSTS, CSP) | ❌ Not enforced | ✅ Enforced at edge |
| Zero-downtime config reload | ❌ Requires restart | ✅ Admin API hot reload |
