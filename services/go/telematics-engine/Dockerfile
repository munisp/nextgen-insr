FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY cmd/ cmd/
RUN CGO_ENABLED=0 GOOS=linux go build -o /service ./cmd/...

FROM alpine:3.19
RUN apk --no-cache add ca-certificates wget
COPY --from=builder /service /service
EXPOSE 8097
CMD ["/service"]
