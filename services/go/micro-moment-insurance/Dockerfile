FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /service ./cmd/main.go

FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /service /service
EXPOSE 8112
ENTRYPOINT ["/service"]
