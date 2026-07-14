# Insurance Operations — Actuarial, Underwriting, Claims Adjudication, Reinsurance
# Consolidated into a single Go binary

FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build

COPY infrastructure/go-sdk/ ./infrastructure/go-sdk/
COPY infrastructure/docker/cmd/insurance-ops/ ./cmd/insurance-ops/
RUN cd cmd/insurance-ops && go build -o /insurance-ops .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /insurance-ops /usr/local/bin/insurance-ops
EXPOSE 8400 50055
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget --spider -q http://localhost:8400/health || exit 1
ENTRYPOINT ["insurance-ops"]
