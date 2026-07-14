# KYC/KYB Services — Orchestrator, AML, Identity Matching
# Consolidated into a single container with Go orchestrator

FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build

COPY infrastructure/go-sdk/ ./infrastructure/go-sdk/
COPY kyc-kyb-system/ ./kyc-kyb-system/

RUN cd kyc-kyb-system/kyc-orchestrator-service && go build -o /kyc-services ./cmd/server/

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /kyc-services /usr/local/bin/kyc-services
EXPOSE 8085 50054
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget --spider -q http://localhost:8085/health || exit 1
ENTRYPOINT ["kyc-services"]
