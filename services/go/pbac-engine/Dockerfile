FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod .
COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /pbac-engine .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
COPY --from=builder /pbac-engine /pbac-engine
EXPOSE 8091
CMD ["/pbac-engine"]
