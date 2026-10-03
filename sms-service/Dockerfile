# sms-service — multi-provider SMS gateway.
# Hardened 2026-10-03: multi-stage build (dist is compiled in-image instead of
# relying on a prebuilt host dist/), non-root USER, correct port 8097
# (8095 collides with float-reconciler), healthcheck.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ src/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist/ dist/
EXPOSE 8097
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8097/health || exit 1
CMD ["node", "dist/index.js"]
