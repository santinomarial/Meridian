# Rebuild the stable upstream release with patched Go dependencies. The official
# 2.11.4 binary predates the security fixes pinned in go.mod/go.sum.
FROM golang:1.27.1-alpine3.24 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /caddy .

FROM caddy:2.11.4-alpine
RUN apk upgrade --no-cache
COPY --from=build /caddy /usr/bin/caddy
