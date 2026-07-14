FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /digital-twin-risk-modeler .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /digital-twin-risk-modeler /digital-twin-risk-modeler
EXPOSE 8125
CMD ["/digital-twin-risk-modeler"]
