#!/usr/bin/env bash
set -Eeuo pipefail

api_image="${1:-meridian-api:ci}"
web_image="${2:-meridian-web:ci}"
migrate_image="${3:-meridian-migrate:ci}"
web_container="meridian-web-smoke-${RANDOM}-${RANDOM}"
work_dir="$(mktemp -d)"

cleanup() {
  docker rm -f "${web_container}" >/dev/null 2>&1 || true
  rm -rf "${work_dir}"
}
trap cleanup EXIT

docker run --rm --entrypoint node "${api_image}" -e '
  const fs = require("node:fs");
  const { spawn } = require("node-pty");

  if (process.getuid?.() !== 10001) {
    throw new Error(`API runtime uid is ${process.getuid?.()}, expected 10001`);
  }
  for (const binary of ["npm", "npx", "corepack", "yarn", "pnpm"]) {
    if (fs.existsSync(`/usr/local/bin/${binary}`)) {
      throw new Error(`${binary} must not be present in the API runtime`);
    }
  }

  const engines = fs
    .readdirSync("/app/node_modules/.prisma/client")
    .filter((name) => name.startsWith("libquery_engine-"));
  if (!engines.some((name) => name.includes("linux-musl") && name.includes("openssl-3"))) {
    throw new Error(`Missing musl/OpenSSL 3 Prisma engine: ${engines.join(", ")}`);
  }

  const terminal = spawn("/bin/sh", ["-lc", "printf runtime-ok"], {
    cols: 80,
    rows: 24,
    cwd: "/app",
    env: process.env,
  });
  let output = "";
  const timeout = setTimeout(() => {
    terminal.kill();
    throw new Error("node-pty runtime smoke test timed out");
  }, 5000);
  terminal.onData((data) => {
    output += data;
  });
  terminal.onExit(({ exitCode }) => {
    clearTimeout(timeout);
    if (exitCode !== 0 || !output.includes("runtime-ok")) {
      throw new Error(`node-pty runtime smoke test failed (${exitCode}): ${output}`);
    }
  });
'

docker run --rm "${migrate_image}" --version
docker run --rm --entrypoint nginx "${web_image}" -t
docker run --rm --detach \
  --name "${web_container}" \
  --publish "127.0.0.1::8080" \
  "${web_image}" >/dev/null

web_address="$(docker port "${web_container}" 8080/tcp)"
base_url="http://${web_address}"

for attempt in {1..30}; do
  if curl --fail --silent --show-error "${base_url}/" \
    --output "${work_dir}/index.html"; then
    break
  fi
  if [[ "${attempt}" == "30" ]]; then
    docker logs "${web_container}"
    echo "Web container did not become ready" >&2
    exit 1
  fi
  sleep 1
done

assert_header() {
  local headers_file="$1"
  local expected="$2"
  if ! grep --fixed-strings --ignore-case --quiet "${expected}" "${headers_file}"; then
    echo "Missing expected header '${expected}' in:" >&2
    cat "${headers_file}" >&2
    exit 1
  fi
}

curl --fail --silent --show-error \
  --dump-header "${work_dir}/spa-headers" \
  --output /dev/null \
  "${base_url}/workspaces/container-smoke"
assert_header "${work_dir}/spa-headers" "Cache-Control: no-store"
assert_header "${work_dir}/spa-headers" "Content-Security-Policy:"
assert_header "${work_dir}/spa-headers" "X-Content-Type-Options: nosniff"
assert_header "${work_dir}/spa-headers" "Referrer-Policy: strict-origin-when-cross-origin"
assert_header "${work_dir}/spa-headers" "X-Frame-Options: DENY"

asset_path="$(
  docker exec "${web_container}" \
    find /usr/share/nginx/html/assets -type f -name "*.css" -print -quit
)"
asset_path="${asset_path#/usr/share/nginx/html}"
curl --fail --silent --show-error \
  --dump-header "${work_dir}/asset-headers" \
  --output /dev/null \
  "${base_url}${asset_path}"
assert_header \
  "${work_dir}/asset-headers" \
  "Cache-Control: public, max-age=604800, immutable"
assert_header "${work_dir}/asset-headers" "Content-Security-Policy:"

echo "Container runtime smoke tests passed"
