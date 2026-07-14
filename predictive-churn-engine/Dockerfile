FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /predictive-churn-engine .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /predictive-churn-engine /predictive-churn-engine
EXPOSE 8124
CMD ["/predictive-churn-engine"]
