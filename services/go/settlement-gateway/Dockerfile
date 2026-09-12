FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod .
COPY *.go ./
RUN go build -o /settlement-gateway .

FROM alpine:3.19
COPY --from=build /settlement-gateway /settlement-gateway
EXPOSE 8322
ENTRYPOINT ["/settlement-gateway"]
