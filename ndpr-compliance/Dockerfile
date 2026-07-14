FROM golang:1.22-alpine AS builder

RUN apk --no-cache add git ca-certificates

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /ndpr-compliance .

FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata curl

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /ndpr-compliance .

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8126

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8126/health || exit 1

CMD ["./ndpr-compliance"]
