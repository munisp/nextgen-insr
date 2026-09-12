FROM rust:1.79-slim AS build
WORKDIR /src
COPY Cargo.toml .
COPY src/ src/
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=build /src/target/release/billing-event-processor /billing-event-processor
EXPOSE 8315
ENTRYPOINT ["/billing-event-processor"]
