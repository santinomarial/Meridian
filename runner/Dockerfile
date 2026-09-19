FROM node:22-alpine3.24 AS build
WORKDIR /runner
RUN apk add --no-cache python3 make g++
COPY package*.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev
FROM node:22-alpine3.24
WORKDIR /runner
RUN apk add --no-cache docker-cli tini \
    && rm -rf /usr/local/lib/node_modules \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx
COPY --from=build /runner/node_modules ./node_modules
COPY server.cjs policy.cjs ./
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.cjs"]
