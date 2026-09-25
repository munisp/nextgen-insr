# Q-wave Q5 (2026-09-25) — parametric-evaluator (Go 1.22, repo Go-service convention).
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /server .

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /server /server
EXPOSE 8095
CMD ["/server"]
