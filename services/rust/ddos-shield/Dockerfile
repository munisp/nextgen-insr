FROM rust:1.88-slim AS builder
WORKDIR /app
COPY Cargo.toml .
COPY src/ src/
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/ddos-shield /usr/local/bin/
EXPOSE 8090
CMD ["ddos-shield"]
