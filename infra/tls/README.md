# TLS Configuration

## Certificate Management

InsurePortal uses cert-manager for automated TLS certificate provisioning via Let's Encrypt.

### Setup

1. Install cert-manager:
```bash
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
```

2. Apply the ClusterIssuer:
```bash
kubectl apply -f cluster-issuer.yaml
```

3. Apply the Certificate resource:
```bash
kubectl apply -f certificate.yaml
```

### Manual Certificate (for non-K8s deployments)

```bash
# Generate with Let's Encrypt using certbot
certbot certonly --standalone -d api.insureportal.io -d portal.insureportal.io

# Or generate self-signed for staging
openssl req -x509 -newkey rsa:4096 -keyout tls.key -out tls.crt -days 365 -nodes \
  -subj "/CN=*.insureportal.io/O=InsurePortal/C=NG"
```

### APISIX TLS Termination

TLS is terminated at the APISIX API Gateway. See `apisix-tls-route.yaml`.
