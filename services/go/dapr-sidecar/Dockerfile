FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod .
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /dapr-sidecar .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /dapr-sidecar /dapr-sidecar
EXPOSE 3501
CMD ["/dapr-sidecar"]
