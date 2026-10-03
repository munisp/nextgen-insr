FROM node:20-alpine
WORKDIR /app
# 2026-10-03 (W8-B2): @insureportal/channel-core is a vendored file:
# dependency (vendor/channel-core, refreshed via `npm run sync:channel-core`).
# It must be copied BEFORE npm install, along with .npmrc (install-links=true
# installs it as a copy, not a symlink).
COPY package*.json .npmrc ./
COPY vendor/ ./vendor/
RUN npm install --production
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
