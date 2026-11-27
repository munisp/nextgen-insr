# actuary-pricing — Leg B Go pricing service (design Appendix D/G).
#
# Multi-stage build: rust builder produces the actuary_kernels cdylib, the
# go builder links it via cgo (flags match the package's hardcoded relative
# -I/-L paths by staging kernels under /kernels), distroless carries the
# .so in /usr/lib.
#
# Build context is the REPO ROOT:  docker build -f actuary-engine/pricing/Dockerfile .

# ── Stage 1: Rust kernels (cdylib) ─────────────────────────────────────────
FROM rust:1.100-bookworm AS kernels
WORKDIR /src
COPY actuary-engine/kernels/ ./
RUN cargo build --release

# ── Stage 2: Go service with cgo ───────────────────────────────────────────
FROM golang:1.22-bookworm AS gobuild
WORKDIR /app

# Stage the kernels where the package's #cgo directives expect them:
# internal/kernels resolves ../../../kernels/include and
# ../../../kernels/target/release relative to the package dir (/app).
COPY actuary-engine/kernels/include/ /kernels/include/
COPY --from=kernels /src/target/release/libactuary_kernels.so /kernels/target/release/

COPY actuary-engine/pricing/go.mod actuary-engine/pricing/go.sum ./
RUN go mod download
COPY actuary-engine/pricing/ ./
RUN CGO_ENABLED=1 go build -trimpath -o pricing-service ./cmd/server

# ── Stage 3: distroless runtime (glibc base — cgo needs it) ────────────────
FROM gcr.io/distroless/base-debian12
WORKDIR /app
COPY --from=gobuild /app/pricing-service ./pricing-service
COPY --from=kernels /src/target/release/libactuary_kernels.so /usr/lib/libactuary_kernels.so
ENV LD_LIBRARY_PATH=/usr/lib
EXPOSE 7080
ENTRYPOINT ["/app/pricing-service"]
