#!/usr/bin/env bash
# Exercise the actual production edge and PostgreSQL entrypoint on an isolated
# network. Images must first be built under the same tags used in CI.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
run_id="meridian-infra-smoke-${RANDOM}-${RANDOM}"
work_dir="$(mktemp -d)"
cleanup() {
  docker rm -fv "${run_id}-edge" "${run_id}-web" "${run_id}-pg" >/dev/null 2>&1 || true
  docker network rm "${run_id}" >/dev/null 2>&1 || true
  rm -rf "${work_dir}"
}
trap cleanup EXIT
docker network create "${run_id}" >/dev/null
docker run -d --name "${run_id}-pg" --network "${run_id}" --network-alias postgres \
  -e POSTGRES_PASSWORD=disposable-smoke-password -e POSTGRES_USER=meridian \
  -e POSTGRES_DB=meridian meridian-postgres:ci >/dev/null
for attempt in {1..60}; do
  # TCP readiness excludes the temporary initdb Unix-socket-only server.
  if docker exec "${run_id}-pg" pg_isready -h 127.0.0.1 -U meridian -d meridian >/dev/null; then break; fi
  if [[ "${attempt}" == 60 ]]; then docker logs "${run_id}-pg"; exit 1; fi
  sleep 1
done
docker run --rm --network "${run_id}" \
  -e DATABASE_URL=postgresql://meridian:disposable-smoke-password@postgres:5432/meridian \
  meridian-migrate:ci
docker exec "${run_id}-pg" psql -U meridian -d meridian -v ON_ERROR_STOP=1 \
  -c 'SELECT count(*) FROM "_prisma_migrations";'
# Restart exercises the existing-volume path as well as first initialization.
docker restart "${run_id}-pg" >/dev/null
for attempt in {1..30}; do
  if docker exec "${run_id}-pg" pg_isready -h 127.0.0.1 -U meridian -d meridian >/dev/null; then break; fi
  if [[ "${attempt}" == 30 ]]; then exit 1; fi
  sleep 1
done
docker exec "${run_id}-pg" psql -U meridian -d meridian -v ON_ERROR_STOP=1 \
  -c 'SELECT count(*) FROM "_prisma_migrations";'

docker run -d --name "${run_id}-web" --network "${run_id}" --network-alias web meridian-web:ci >/dev/null
docker run -d --name "${run_id}-edge" --network "${run_id}" \
  -p 127.0.0.1::443 -e DOMAIN=localhost -e ACME_EMAIL=smoke@example.com \
  -e API_UPSTREAMS=web:8080 -e LB_COOKIE_SECRET=disposable-smoke-secret \
  -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" meridian-caddy:ci >/dev/null
edge_address="$(docker port "${run_id}-edge" 443/tcp)"
base_url="https://localhost:${edge_address##*:}"
for attempt in {1..30}; do
  if curl -kfsS "${base_url}/" -o "${work_dir}/index.html"; then break; fi
  if [[ "${attempt}" == 30 ]]; then docker logs "${run_id}-edge"; exit 1; fi
  sleep 1
done
for route in /metrics /docs /docs/index.html /e2e /e2e/cleanup; do
  status="$(curl -ksS -o /dev/null -w '%{http_code}' "${base_url}${route}")"
  [[ "${status}" == 404 ]] || { echo "${route}: expected 404, got ${status}" >&2; exit 1; }
done
sentinel="token-must-not-be-logged-${run_id}"
curl -kfsS "${base_url}/invite/${sentinel}?token=${sentinel}" \
  -H "Referer: ${base_url}/reset-password?token=${sentinel}" -o /dev/null
# A missing asset exercises nginx's error logging as well as SPA routing.
curl -ksS "${base_url}/${sentinel}.js" -o /dev/null
docker logs "${run_id}-edge" > "${work_dir}/edge.log" 2>&1
docker logs "${run_id}-web" > "${work_dir}/web.log" 2>&1
if grep -Fq "${sentinel}" "${work_dir}/edge.log" "${work_dir}/web.log"; then
  echo 'Credential URL leaked into container logs' >&2
  exit 1
fi
echo 'Infrastructure smoke passed: PostgreSQL init/migrate/restart, HTTPS routing, blocked endpoints, credential-safe logs'
