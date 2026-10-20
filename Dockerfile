FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS engine
WORKDIR /app/engine
COPY engine/package.json engine/package-lock.json ./
RUN npm ci
COPY engine/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV NODE_ENV=production HOST=0.0.0.0 WEB_DIST=/app/web/dist TRUST_PROXY=true COOKIE_SECURE=true DATABASE_PATH=/data/engine.sqlite
WORKDIR /app/engine
COPY --from=engine /app/engine/node_modules ./node_modules
COPY --from=engine /app/engine/dist ./dist
COPY --from=engine /app/engine/package.json ./
COPY --from=web /app/web/dist /app/web/dist
RUN mkdir -p /data
CMD ["node","dist/server.js"]
