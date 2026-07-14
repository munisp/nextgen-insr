FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /parametric-insurance-engine .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /parametric-insurance-engine /parametric-insurance-engine
EXPOSE 8121
CMD ["/parametric-insurance-engine"]
