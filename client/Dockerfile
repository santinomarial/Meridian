# syntax=docker/dockerfile:1.7

FROM node:22-alpine3.24 AS build
WORKDIR /app

# Empty = production SPA uses window.location.origin (same-origin behind Caddy).
ARG VITE_API_URL=
ARG VITE_SOCKET_URL=
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.31-alpine3.24-slim AS runtime
# Extra connect-src origins beyond 'self' (include a leading space), e.g.
# " https://api.example.com wss://api.example.com"
ARG CSP_CONNECT_SRC_EXTRA=
# Docker's USER directive owns privilege dropping. Remove the base image's
# redundant master-process user directive so non-root startup is warning-free.
RUN addgroup -S meridian && adduser -S -G meridian meridian \
  && sed -i '/^user /d' /etc/nginx/nginx.conf \
  && chown -R meridian:meridian /var/cache/nginx /var/run /var/log/nginx \
  && touch /var/run/nginx.pid && chown meridian:meridian /var/run/nginx.pid

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /tmp/nginx.conf
# Same-origin default; optional EXTRA origins substituted at build time.
RUN sed "s|__CSP_CONNECT_SRC_EXTRA__|${CSP_CONNECT_SRC_EXTRA}|g" /tmp/nginx.conf \
  > /etc/nginx/conf.d/default.conf \
  && rm /tmp/nginx.conf

USER meridian
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
