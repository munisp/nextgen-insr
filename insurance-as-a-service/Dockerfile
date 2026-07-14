FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /insurance-as-a-service .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /insurance-as-a-service /insurance-as-a-service
EXPOSE 8122
CMD ["/insurance-as-a-service"]
