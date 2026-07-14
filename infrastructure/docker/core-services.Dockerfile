# Core Insurance Services — Policy, Claims, Customer, Verification
# Consolidated into a single Go binary with sub-routers

FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build

COPY infrastructure/go-sdk/ ./infrastructure/go-sdk/
COPY go.work* ./

# Build the core services gateway
COPY infrastructure/docker/cmd/core-services/ ./cmd/core-services/
RUN cd cmd/core-services && go build -o /core-services .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /core-services /usr/local/bin/core-services
EXPOSE 8080 50051
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget --spider -q http://localhost:8080/health || exit 1
ENTRYPOINT ["core-services"]
