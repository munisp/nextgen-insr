FROM rust:1.79-slim AS build
WORKDIR /src
COPY Cargo.toml .
COPY src/ src/
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=build /src/target/release/fee-splitter-realtime /fee-splitter-realtime
EXPOSE 8324
ENTRYPOINT ["/fee-splitter-realtime"]
