# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Browser-facing API origin (Compose default: host-published API port).
ARG VITE_API_URL=http://localhost:3000
ARG VITE_SOCKET_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
RUN addgroup -S meridian && adduser -S -G meridian meridian \
  && chown -R meridian:meridian /var/cache/nginx /var/run /var/log/nginx \
  && touch /var/run/nginx.pid && chown meridian:meridian /var/run/nginx.pid

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

USER meridian
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
