# syntax=docker/dockerfile:1.7

# ── Build ────────────────────────────────────────────────────────────────────
FROM node:22-alpine3.24 AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++ openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts ./scripts
RUN npm ci

COPY tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build \
  && npm prune --omit=dev

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine3.24 AS runtime
WORKDIR /app

# npm and Corepack are build tools, not runtime dependencies. Removing them
# reduces the production image and excludes their package trees from the
# shipped attack surface.
RUN apk add --no-cache tini openssl ca-certificates \
  && addgroup -S -g 10001 meridian \
  && adduser -S -D -H -u 10001 -G meridian -h /app -s /sbin/nologin meridian \
  && rm -rf /usr/local/lib/node_modules \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

ENV NODE_ENV=production
ENV PORT=3000
ENV SHELL=/bin/sh

COPY --from=build --chown=meridian:meridian /app/dist ./dist
COPY --from=build --chown=meridian:meridian /app/node_modules ./node_modules
COPY --from=build --chown=meridian:meridian /app/package.json ./package.json
COPY --from=build --chown=meridian:meridian /app/prisma ./prisma

USER meridian
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
