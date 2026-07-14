# Financial Services — Payment, Premium Finance, Multi-Currency, Reconciliation
# Consolidated into a single Go binary

FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build

COPY infrastructure/go-sdk/ ./infrastructure/go-sdk/
COPY infrastructure/docker/cmd/financial/ ./cmd/financial/
RUN cd cmd/financial && go build -o /financial .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /financial /usr/local/bin/financial
EXPOSE 8500 50053
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget --spider -q http://localhost:8500/health || exit 1
ENTRYPOINT ["financial"]
