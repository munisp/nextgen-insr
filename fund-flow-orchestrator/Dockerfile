FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o fund-flow-orchestrator .

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /app/fund-flow-orchestrator .
EXPOSE 8090
ENTRYPOINT ["./fund-flow-orchestrator"]
