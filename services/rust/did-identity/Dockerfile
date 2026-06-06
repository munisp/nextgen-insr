FROM rust:1.75-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release 2>/dev/null || true
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/did-identity /usr/local/bin/
ENV PORT=8112
EXPOSE 8112
CMD ["did-identity"]
