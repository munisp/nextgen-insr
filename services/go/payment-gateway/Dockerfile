FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod .
RUN go mod download
COPY cmd/ cmd/
RUN CGO_ENABLED=0 GOOS=linux go build -o /service ./cmd/...

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /service /service
EXPOSE 8100
CMD ["/service"]
