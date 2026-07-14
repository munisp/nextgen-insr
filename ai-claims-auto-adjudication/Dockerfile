FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /ai-claims-auto-adjudication .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /ai-claims-auto-adjudication /ai-claims-auto-adjudication
EXPOSE 8120
CMD ["/ai-claims-auto-adjudication"]
