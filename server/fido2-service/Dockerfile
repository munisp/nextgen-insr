# ── Build stage ──────────────────────────────────────────────────────────────
# 2026-10-02 (C2-fido2-fix): base image bumped golang:1.22 → 1.25 to match
# go.mod (go 1.25.0); duplicate CMD and malformed HEALTHCHECK fixed; env var
# renamed FIDO2_ORIGIN → FIDO2_RP_ORIGIN (what the code actually reads).
FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o fido2-service .

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata wget \
    && addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder /app/fido2-service .
EXPOSE 8083
USER appuser
ENV PORT=8083 \
    FIDO2_RP_ID=54link.ng \
    FIDO2_RP_NAME="54Link POS" \
    FIDO2_RP_ORIGIN=https://54link.ng
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8083/health || exit 1
CMD ["./fido2-service"]
