FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /fraud-network-graph .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /fraud-network-graph /fraud-network-graph
EXPOSE 8123
CMD ["/fraud-network-graph"]
