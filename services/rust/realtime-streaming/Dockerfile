FROM rust:1.75-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release 2>/dev/null || true
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/realtime-streaming /usr/local/bin/
ENV PORT=8115
EXPOSE 8115
CMD ["realtime-streaming"]
