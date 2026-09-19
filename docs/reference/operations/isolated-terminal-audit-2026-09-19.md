# Isolated execution and email follow-up — 2026-09-19

The user chose to include isolated execution before public launch and authorized
live account-email tests. Email delivery is complete; see
[email delivery evidence](email-delivery-2026-09-19.md).

## Implemented

- A private authenticated execution worker, separate from the API. The API has no
  Docker socket and workloads have no host mounts, API credentials, or networking.
- Mandatory gVisor in production with fail-closed runtime and readiness checks.
  Ordinary Docker is available only as an explicit loopback development mode.
- Non-root workloads with dropped capabilities, read-only images, bounded CPU,
  memory, processes, temporary storage, sessions, output, input, and lifetime.
- File snapshots and conditional editor mutations run inside the sandbox. Returned
  text is independently validated and saved through existing transactional import,
  authorization, version history and conflict handling. No tar extraction or
  shared host workspace mount is used.
- Cancellation during allocation, authorization rechecks after allocation, cleanup
  and orphan reaping. A retained image reference prevents a local image rebuild
  from invalidating the worker's pinned executable image.
- A visible Starting state, bounded ordered startup input, and Run waiting for a
  ready session. Buffered input is discarded on stop, error or workspace teardown.
- A deployment overlay, setup guide, worker policy tests, real execution smoke
  checks and image scans added to CI.

## Verification completed locally

- 459 server unit tests; 52 client unit tests; 69 database integration tests.
- Four worker policy tests, including production refusal of the development override.
- All 23 focused browser scenarios passed in one stable run against the separate
  worker: collaboration, roles, startup typing, Run, file import and conflicts,
  reload/export, resizing and themes.
- Real worker smoke passed both as a local process and inside the read-only broker
  container with dropped capabilities. Executed Python, JavaScript, TypeScript,
  and Go; checked PTY resize, files, conflict preconditions, traversal/symlink
  rejection, missing secrets/network/mounts, per-user quotas and cleanup.
- Client lint/build, server TypeScript compilation, production Compose overlay
  validation and CI YAML parsing passed. Worker npm audit reports zero findings.
- Trivy scans of both final new images reported zero HIGH/CRITICAL findings.
  npm's bundled vulnerable dependencies were replaced with compatible patched
  releases; the broker image has no unused npm/Corepack installation.
- Production worker startup on this Mac was explicitly rejected because runsc is
  unavailable, including when the development override was also set.

Final locally scanned image references:

- `runner`: `sha256:8cf235418067b42ff2411c3d0b2558dfdc9fb21d8b05c9410a07c887cf743227`.
- `sandbox`: `sha256:40b7e943fe0a158ee4136042b9ee360069c60f7f27faa57e13d27315edc2f452`.

Remote GitHub Actions results have not been inspected; local verification is the
evidence above. The new worker checks and scans are included in the CI workflow.

## Deployment qualification still required

This Mac's Docker Desktop provides runc, not gVisor. Local checks exercise the
worker protocol, shell, filesystem behavior, application flows, resource policy,
and refusal to start production without runsc. They are **not** proof of the
Linux/gVisor boundary or public-host readiness.

No Linux server address or hosting provider has been supplied. Before public
execution: install genuine runsc on the chosen host, repeat worker/application
checks under it, verify resource enforcement and crash/restart recovery there,
scan the exact release images, and verify private worker networking and TLS.
Outbound package installation remains disabled by the initial network policy.
Workloads are ephemeral; changes not yet imported can be lost on forced shutdown
or host failure. See [setup and limits](../../how-to/run-isolated-terminals.md).

The existing production base topology still disables terminals. Use the opt-in
isolated overlay only after host qualification. Nothing has been publicly deployed.
