FROM golang:1.22-alpine AS builder

RUN apk --no-cache add git ca-certificates

WORKDIR /build

# Copy go module files first for better caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o /premium-collection-service .

# Second stage: minimal runtime image
FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata curl

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /premium-collection-service .
COPY config/ ./config/

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 8098

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8098/health || exit 1

CMD ["./premium-collection-service"]
