# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy manifests and patches for layer caching
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build (Vite client + esbuild server bundle)
ARG VITE_APP_ID=""
ARG VITE_APP_TITLE="InsurePortal InsurePortal Platform"
ENV NODE_ENV=production
RUN pnpm build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Runtime
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

# Security: run as non-root
RUN addgroup -S posshell && adduser -S posshell -G posshell

WORKDIR /app

# Copy build output + migrations
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/patches ./patches

# Install only production runtime dependencies
RUN corepack enable && corepack prepare pnpm@9 --activate \
    && pnpm install --prod --frozen-lockfile \
    && pnpm store prune

# Switch to non-root user
USER posshell

# Expose the server port (injected at runtime via PORT env var)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/health || exit 1

# Start the server bundle
CMD ["node", "dist/index.js"]
