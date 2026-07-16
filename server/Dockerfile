# syntax=docker/dockerfile:1.7

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build \
  && npm prune --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 meridian \
  && useradd --system --uid 10001 --gid meridian --home-dir /app --shell /usr/sbin/nologin meridian

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build --chown=meridian:meridian /app/dist ./dist
COPY --from=build --chown=meridian:meridian /app/node_modules ./node_modules
COPY --from=build --chown=meridian:meridian /app/package.json ./package.json
COPY --from=build --chown=meridian:meridian /app/prisma ./prisma

USER meridian
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
