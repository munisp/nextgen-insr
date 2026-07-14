FROM rust:1.77-alpine AS builder
RUN apk add --no-cache musl-dev pkgconfig openssl-dev
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release && rm -rf src
COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM alpine:3.19
RUN apk --no-cache add ca-certificates curl
WORKDIR /root/
COPY --from=builder /app/target/release/rust-middleware .
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8091/health || exit 1
CMD ["./rust-middleware"]
