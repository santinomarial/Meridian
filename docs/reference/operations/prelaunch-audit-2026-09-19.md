# Prelaunch audit — 2026-09-19

This audit continues the [September 18 deployment review](production-readiness-2026-09-18.md)
after the typography, terminal synchronization, and authentication UI changes.
It covers the supported single-API release, with the host-backed terminal
available only for local development. No public deployment was performed.

## Changes completed

- `167b640`: reproduced blank display names being accepted by registration and
  profile updates. Both HTTP routes now trim names and require 1–100 characters;
  profile updates reject null names. Signup and Settings enforce the same input
  limit. Added HTTP regression coverage and a browser test for profile changes
  surviving a reload.
- `3a5296f`: corrected two browser assertions that still expected older auth
  error wording. The tests continue to check failed-request retry, rate-limit
  feedback, and suppression of raw server details.
- `f94474c`: reproduced a delayed file-creation response inserting a file into
  another account's UI after sign-out and sign-up in the same browser tab.
  Asynchronous file operations now check the originating workspace, account,
  load generation, and backend state before applying results. Cancelled initial
  workspace creation also cannot overwrite the active workspace. Browser
  regressions cover both root-level and nested file creation.
- `3aff3c9`: reproduced duplicate invitation submission while delivery was
  pending and false clipboard-success feedback after clipboard denial. The
  invitation form now locks during a request, supports retry after failure,
  distinguishes an available link from confirmed email delivery, and reports
  clipboard outcomes accurately. Tests mock delivery, never send real mail.
- Published Resend's three DNS records for `santinomarial.com` through GoDaddy.
  Checked the records through authoritative and public DNS. Resend confirmed
  **Verified** and **ready to send emails**. Configured the ignored local
  `server/.env` sender as `Meridian <accounts@santinomarial.com>` and restarted
  the local API. Its readiness endpoint confirmed PostgreSQL and Redis healthy.
  Real recipient delivery has not yet been exercised.

## Verification evidence

Tests used disposable PostgreSQL and Redis containers bound to loopback ports
55433 and 56380, an isolated API on 3300, and a client on 5174. The isolated API
had no Resend credential, so synthetic account tests could not send real email.
The user's database, Redis, and client were not used for test cleanup.

| Check | Result |
|---|---|
| Client lint, TypeScript and Vite build | Passed |
| Client unit tests | 52 passed |
| Server TypeScript build and unit tests | Passed; 448 tests |
| Real PostgreSQL/Redis integration tests | 69 passed across 14 suites |
| Initial complete Chromium run | 132 passed; two stale wording assertions failed and were corrected |
| Focused auth/recovery/profile browser regression | 16 passed |
| Stable complete Chromium run after profile/workspace fixes | 137 passed, no skips or retries |
| Final invitation/sharing/permissions/collaboration regression | 24 passed, including three new invitation tests |
| Client and server production dependency audits | Zero reported vulnerabilities |
| Manual visual review | White/crimson login, white workspace, black workspace and terminal inspected at 1280×720; file icons, Python highlighting, editing and Save checked |
| Local API readiness after sender update | PostgreSQL and Redis healthy |

The invitation changes followed the complete run and were validated by the
focused 24-test run plus client lint, all 52 unit tests, and the production
build. Across these runs, all 140 distinct browser scenarios were exercised
successfully. Disposable test containers and API/client processes were removed
after verification. The user's local API on 3000 and client on 5173 remain
available. GitHub-hosted CI status could not be queried because the GitHub CLI
is not signed in; local results do not assert that remote CI passed.

## Feature coverage

| Feature | Evidence exercised in this audit |
|---|---|
| Signup, login, sign-out and session recovery | Input validation, password reveal, duplicate-submission prevention, expired cookies, network/429/500 errors, retry and reload |
| Email verification and password recovery | Token lifecycle integration tests and browser flows; real inbox delivery remains outstanding |
| Profile and settings | Name validation/persistence, password-reset retry, theme persistence, dialog focus and short viewport |
| Workspace navigation and membership | Deep links, invitation acceptance, owner/editor/viewer controls, server authorization, and delayed operations across account changes |
| Files and folders | Creation, rename, deletion, nested paths, file import, ZIP import and ZIP export |
| Editor | Language labels/icons, syntax theme, keyboard commands, Save and refresh persistence |
| Collaboration | Two-user editing, presence, chat, permissions and multi-replica integration coverage |
| Offline recovery | Durable outbox replay, dropped update retry, restore generation fencing and preservation of newer edits during Save |
| Version history | Save, preview, diff, restore, restored-version history and viewer restrictions |
| Development terminal | Interactive shell, run active file, nested paths, editor-to-shell updates, shell-to-editor updates, conflict copies and export persistence |
| Responsive UI and accessibility | Mobile/tablet panel transitions, small-screen auth and import, focus trapping/restoration and terminal layout/theme changes |
| Backend and configuration | Request limits, throttling, auth cookies, authorization, CRDT persistence and production configuration validation |

## Completion boundaries and next work

1. The planned local regression pass is complete. No reproduced defect from
   this pass remains unresolved. Resume targeted checks when new findings or
   product requirements warrant them, rather than repeatedly running green tests.
2. An explicitly authorized recipient is needed for a real verification or
   password-reset email. Domain verification and mocked delivery tests do not
   establish inbox delivery. The user has been asked for the recipient.
3. Production must receive its own sender/secret configuration. The local
   `.env` change does not configure a future deployment host.
4. Before public launch, complete the live-service requirements from the
   September 18 review: public TLS, firewall/secrets, actual paging delivery,
   off-host backup and restore, host restart, and capacity checks.
5. The development terminal is host command execution and remains disabled in
   production. A public terminal requires an isolated execution service; it
   must not be enabled by bypassing the production configuration guard. The user
   has been asked whether to include that service before launch or ship with
   the production terminal disabled.

Passing this audit is evidence for the exercised paths, not a guarantee that
every browser, workload, or deployment condition is defect-free. The browser
suite currently covers Chromium; Safari and Firefox have not been qualified.
