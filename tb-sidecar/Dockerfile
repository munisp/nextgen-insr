# tb-sidecar — TigerBeetle ledger proxy sidecar.
# Stdlib-only Go binary; no module downloads required at build time.

# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/tb-sidecar .

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget \
    && addgroup -S sidecar && adduser -S sidecar -G sidecar
COPY --from=build /out/tb-sidecar /usr/local/bin/tb-sidecar
USER sidecar
EXPOSE 7070
# /health reflects REAL upstream reachability (503 when TigerBeetle is down).
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-7070}/health" || exit 1
ENTRYPOINT ["/usr/local/bin/tb-sidecar"]
