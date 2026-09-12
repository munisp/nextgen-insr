FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod .
COPY *.go ./
RUN go build -o /telemetry-api-gateway .

FROM alpine:3.19
COPY --from=build /telemetry-api-gateway /telemetry-api-gateway
EXPOSE 8323
ENTRYPOINT ["/telemetry-api-gateway"]
