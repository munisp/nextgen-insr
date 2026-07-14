# Communication — Notification, Multi-Language, Gamification
# Consolidated into a single Go binary

FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git
WORKDIR /build

COPY infrastructure/go-sdk/ ./infrastructure/go-sdk/
COPY infrastructure/docker/cmd/communication/ ./cmd/communication/
RUN cd cmd/communication && go build -o /communication .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates wget
COPY --from=builder /communication /usr/local/bin/communication
EXPOSE 8700
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget --spider -q http://localhost:8700/health || exit 1
ENTRYPOINT ["communication"]
