# ─── InsurePortal Custom Caddy Build ─────────────────────────────────────────
# Builds a custom Caddy binary with the following plugins:
#   - caddy-ratelimit     : Advanced per-zone rate limiting (not in Caddy OSS)
#   - caddy-oidc          : Native OIDC/JWT validation against Keycloak
#   - caddy-crowdsec      : CrowdSec bouncer for IP reputation blocking
#   - caddy-dns/cloudflare: DNS-01 ACME challenge for wildcard certs
#   - caddy-transform     : Response body transformation for multi-tenancy
#   - caddy-security      : caddy-security (authcrunch) for Keycloak OAuth2/OIDC
#
# Stage 1: Build custom Caddy binary with xcaddy
FROM caddy:2.9-builder AS builder

RUN xcaddy build \
    --with github.com/mholt/caddy-ratelimit \
    --with github.com/greenpau/caddy-security \
    --with github.com/caddy-dns/cloudflare \
    --with github.com/caddyserver/transform-encoder \
    --with github.com/porech/caddy-maxmind-geolocation \
    --with github.com/hslatman/caddy-crowdsec-bouncer/http

# Stage 2: Production image
FROM caddy:2.9-alpine

# Copy custom binary
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Copy configuration
COPY Caddyfile /etc/caddy/Caddyfile
COPY config/ /etc/caddy/config/
COPY certs/ /etc/caddy/certs/

# Create data directory for cert storage
RUN mkdir -p /data/caddy && chown -R caddy:caddy /data/caddy

# Caddy runs as non-root by default
USER caddy

EXPOSE 80 443 443/udp 2019

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD caddy validate --config /etc/caddy/Caddyfile || exit 1

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
