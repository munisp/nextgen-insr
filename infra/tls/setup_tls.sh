#!/usr/bin/env bash
# =============================================================================
# TLS/mTLS Certificate Generation and Validation
#
# Generates:
#   1. Root CA certificate (self-signed, for internal mTLS)
#   2. Server certificates for each microservice
#   3. Client certificates for inter-service communication
#   4. Let's Encrypt integration script for production
#
# Usage:
#   ./setup_tls.sh generate    — Generate all certificates
#   ./setup_tls.sh validate    — Validate existing certificates
#   ./setup_tls.sh renew       — Renew certificates (Let's Encrypt)
#   ./setup_tls.sh deploy      — Deploy certificates to Kubernetes
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CERT_DIR="${CERT_DIR:-$SCRIPT_DIR/certs}"
DOMAIN="${DOMAIN:-insureportal.ng}"
ORG="InsurePortal Nigeria Ltd"
COUNTRY="NG"
STATE="Lagos"
VALIDITY_DAYS=365
CA_VALIDITY_DAYS=3650

SERVICES=(
  "underwriting" "policy-lifecycle" "premium-collection"
  "claims-adjudication" "instant-payout" "communication"
  "audit-trail" "reinsurance" "naicom-compliance"
  "fraud-detection" "group-life" "bancassurance"
  "agent-network" "broker-api" "api-gateway"
  "microinsurance" "takaful" "multi-tenant"
  "enhanced-kyc" "enterprise-mdm"
)

# ---------------------------------------------------------------------------
generate_ca() {
  echo "=== Generating Root CA ==="
  mkdir -p "$CERT_DIR/ca"

  # Generate CA private key
  openssl genrsa -out "$CERT_DIR/ca/ca.key" 4096

  # Generate CA certificate
  openssl req -new -x509 -key "$CERT_DIR/ca/ca.key" \
    -out "$CERT_DIR/ca/ca.crt" \
    -days "$CA_VALIDITY_DAYS" \
    -subj "/C=$COUNTRY/ST=$STATE/O=$ORG/CN=InsurePortal Root CA"

  echo "CA certificate generated: $CERT_DIR/ca/ca.crt"
  echo "CA key generated: $CERT_DIR/ca/ca.key"
}

generate_server_cert() {
  local service=$1
  local fqdn="${service}.${DOMAIN}"
  echo "  Generating server cert for: $fqdn"
  mkdir -p "$CERT_DIR/server/$service"

  # Generate server private key
  openssl genrsa -out "$CERT_DIR/server/$service/server.key" 2048

  # Generate CSR with SAN
  cat > "$CERT_DIR/server/$service/san.cnf" <<EOF
[req]
distinguished_name = req_dn
req_extensions = v3_req
prompt = no

[req_dn]
C = $COUNTRY
ST = $STATE
O = $ORG
CN = $fqdn

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = $fqdn
DNS.2 = ${service}.insureportal-prod.svc.cluster.local
DNS.3 = ${service}.insureportal-staging.svc.cluster.local
DNS.4 = localhost
IP.1 = 127.0.0.1
EOF

  openssl req -new -key "$CERT_DIR/server/$service/server.key" \
    -out "$CERT_DIR/server/$service/server.csr" \
    -config "$CERT_DIR/server/$service/san.cnf"

  # Sign with CA
  openssl x509 -req -in "$CERT_DIR/server/$service/server.csr" \
    -CA "$CERT_DIR/ca/ca.crt" -CAkey "$CERT_DIR/ca/ca.key" \
    -CAcreateserial -out "$CERT_DIR/server/$service/server.crt" \
    -days "$VALIDITY_DAYS" \
    -extfile "$CERT_DIR/server/$service/san.cnf" -extensions v3_req
}

generate_client_cert() {
  local service=$1
  echo "  Generating client cert for: $service"
  mkdir -p "$CERT_DIR/client/$service"

  openssl genrsa -out "$CERT_DIR/client/$service/client.key" 2048

  openssl req -new -key "$CERT_DIR/client/$service/client.key" \
    -out "$CERT_DIR/client/$service/client.csr" \
    -subj "/C=$COUNTRY/ST=$STATE/O=$ORG/CN=${service}-client"

  openssl x509 -req -in "$CERT_DIR/client/$service/client.csr" \
    -CA "$CERT_DIR/ca/ca.crt" -CAkey "$CERT_DIR/ca/ca.key" \
    -CAcreateserial -out "$CERT_DIR/client/$service/client.crt" \
    -days "$VALIDITY_DAYS"
}

# ---------------------------------------------------------------------------
generate_all() {
  generate_ca

  echo ""
  echo "=== Generating Server Certificates ==="
  for svc in "${SERVICES[@]}"; do
    generate_server_cert "$svc"
  done

  echo ""
  echo "=== Generating Client Certificates (mTLS) ==="
  for svc in "${SERVICES[@]}"; do
    generate_client_cert "$svc"
  done

  echo ""
  echo "=== Certificate Generation Complete ==="
  echo "CA:     $CERT_DIR/ca/"
  echo "Server: $CERT_DIR/server/<service>/"
  echo "Client: $CERT_DIR/client/<service>/"
  echo ""
  echo "Total: ${#SERVICES[@]} services × 2 certs (server + client) = $((${#SERVICES[@]} * 2)) certificates"
}

# ---------------------------------------------------------------------------
validate_certs() {
  echo "=== Validating Certificates ==="
  local errors=0

  # Validate CA
  if openssl x509 -in "$CERT_DIR/ca/ca.crt" -noout -text > /dev/null 2>&1; then
    expiry=$(openssl x509 -in "$CERT_DIR/ca/ca.crt" -noout -enddate | cut -d= -f2)
    echo "  CA: VALID (expires: $expiry)"
  else
    echo "  CA: INVALID"
    errors=$((errors + 1))
  fi

  # Validate server certs
  for svc in "${SERVICES[@]}"; do
    cert="$CERT_DIR/server/$svc/server.crt"
    if [ -f "$cert" ]; then
      if openssl verify -CAfile "$CERT_DIR/ca/ca.crt" "$cert" > /dev/null 2>&1; then
        expiry=$(openssl x509 -in "$cert" -noout -enddate | cut -d= -f2)
        echo "  Server/$svc: VALID (expires: $expiry)"
      else
        echo "  Server/$svc: INVALID (chain verification failed)"
        errors=$((errors + 1))
      fi
    else
      echo "  Server/$svc: MISSING"
      errors=$((errors + 1))
    fi
  done

  # Validate client certs
  for svc in "${SERVICES[@]}"; do
    cert="$CERT_DIR/client/$svc/client.crt"
    if [ -f "$cert" ]; then
      if openssl verify -CAfile "$CERT_DIR/ca/ca.crt" "$cert" > /dev/null 2>&1; then
        echo "  Client/$svc: VALID"
      else
        echo "  Client/$svc: INVALID"
        errors=$((errors + 1))
      fi
    else
      echo "  Client/$svc: MISSING"
      errors=$((errors + 1))
    fi
  done

  echo ""
  if [ $errors -eq 0 ]; then
    echo "All certificates VALID"
  else
    echo "ERRORS: $errors certificates invalid or missing"
  fi
  return $errors
}

# ---------------------------------------------------------------------------
deploy_to_k8s() {
  echo "=== Deploying Certificates to Kubernetes ==="
  local namespace="${K8S_NAMESPACE:-insureportal-prod}"

  # Create namespace if not exists
  kubectl create namespace "$namespace" --dry-run=client -o yaml | kubectl apply -f -

  # Deploy CA as ConfigMap
  kubectl create configmap ca-certificates \
    --from-file=ca.crt="$CERT_DIR/ca/ca.crt" \
    --namespace "$namespace" \
    --dry-run=client -o yaml | kubectl apply -f -
  echo "  CA ConfigMap deployed"

  # Deploy each service cert as a Secret
  for svc in "${SERVICES[@]}"; do
    if [ -f "$CERT_DIR/server/$svc/server.crt" ]; then
      kubectl create secret tls "${svc}-tls" \
        --cert="$CERT_DIR/server/$svc/server.crt" \
        --key="$CERT_DIR/server/$svc/server.key" \
        --namespace "$namespace" \
        --dry-run=client -o yaml | kubectl apply -f -

      kubectl create secret tls "${svc}-client-tls" \
        --cert="$CERT_DIR/client/$svc/client.crt" \
        --key="$CERT_DIR/client/$svc/client.key" \
        --namespace "$namespace" \
        --dry-run=client -o yaml | kubectl apply -f -

      echo "  $svc: server + client TLS secrets deployed"
    fi
  done

  echo ""
  echo "All certificates deployed to namespace: $namespace"
}

# ---------------------------------------------------------------------------
setup_letsencrypt() {
  echo "=== Setting Up Let's Encrypt (Production) ==="
  cat > "$CERT_DIR/cert-manager-issuer.yaml" <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: \${LETSENCRYPT_EMAIL}
    privateKeySecretRef:
      name: letsencrypt-prod-key
    solvers:
    - http01:
        ingress:
          class: nginx
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: insureportal-wildcard
  namespace: insureportal-prod
spec:
  secretName: insureportal-tls-wildcard
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
  - "*.${DOMAIN}"
  - "${DOMAIN}"
EOF
  echo "Let's Encrypt issuer config: $CERT_DIR/cert-manager-issuer.yaml"
  echo "Apply with: kubectl apply -f $CERT_DIR/cert-manager-issuer.yaml"
}

# ---------------------------------------------------------------------------
case "${1:-generate}" in
  generate)  generate_all ;;
  validate)  validate_certs ;;
  deploy)    deploy_to_k8s ;;
  renew)     setup_letsencrypt ;;
  *)         echo "Usage: $0 {generate|validate|deploy|renew}" ;;
esac
