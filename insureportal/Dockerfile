# ─────────────────────────────────────────────────────────────────────────────
# InsurePortal — Multi-stage Production Dockerfile
# Stage 1: deps     — install all node_modules
# Stage 2: builder  — compile TypeScript + build Vite frontend
# Stage 3: runner   — minimal production image
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Dependency installation ─────────────────────────────────────────
FROM node:26-alpine AS deps
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package manifests
COPY package.json pnpm-lock.yaml ./

# Install production + dev dependencies (needed for build)
RUN pnpm install --frozen-lockfile

# ── Stage 2: Build ────────────────────────────────────────────────────────────
FROM node:26-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build the Vite frontend and compile TypeScript server
RUN pnpm build

# ── Stage 3: Production runner ────────────────────────────────────────────────
FROM node:26-alpine AS runner
WORKDIR /app

# Security: run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 insureportal

# Install only production dependencies
RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/public ./public

# Copy OpenTelemetry instrumentation (must load before app)
COPY --from=builder /app/server/instrumentation.ts ./server/instrumentation.ts

# Set ownership
RUN chown -R insureportal:nodejs /app

USER insureportal

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/health || exit 1

EXPOSE 3000

# Start with OpenTelemetry auto-instrumentation
CMD ["node", "--require", "./server/instrumentation.js", "dist/server/index.js"]
