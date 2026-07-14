# Compliance — NAICOM, NDPR, IFRS17, Regulatory, Audit Trail
# Consolidated into a single Go binary

FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build

COPY infrastructure/go-sdk/ ./infrastructure/go-sdk/
COPY infrastructure/docker/cmd/compliance/ ./cmd/compliance/
RUN cd cmd/compliance && go build -o /compliance .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /compliance /usr/local/bin/compliance
EXPOSE 8600
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget --spider -q http://localhost:8600/health || exit 1
ENTRYPOINT ["compliance"]
