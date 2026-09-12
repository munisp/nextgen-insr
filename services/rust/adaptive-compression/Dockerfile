FROM rust:1.75-slim AS builder
WORKDIR /app
COPY Cargo.toml .
COPY src/ src/
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/adaptive-compression /usr/local/bin/
EXPOSE 8109
CMD ["adaptive-compression"]
