FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o infra-go ./cmd/server/

FROM alpine:3.19
RUN apk --no-cache add ca-certificates wget
# Run as non-root (Semgrep: missing USER). Port 8093 is unprivileged (>1024).
RUN addgroup -S appuser && adduser -S appuser -G appuser
WORKDIR /app
COPY --from=builder /app/infra-go .
RUN chown -R appuser:appuser /app
USER appuser
# 2026-10-03 (W7-B11 verify nit): main.go reads INFRA_GO_PORT (default 8090);
# align with the compose/Dockerfile port so the container serves on 8093.
ENV INFRA_GO_PORT=8093
EXPOSE 8093
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8093/health || exit 1
CMD ["./infra-go"]
