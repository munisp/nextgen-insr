FROM rust:1.75-alpine AS builder
RUN apk add --no-cache musl-dev openssl-dev pkgconf
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release 2>/dev/null || true
COPY src/ src/
RUN cargo build --release

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/target/release/did-identity /service
EXPOSE 8113
ENTRYPOINT ["/service"]
