# Client commands

Run commands from `client/`. The package requires Node.js 22.22 or later.

| Command | Executed program | Output or scope |
|---|---|---|
| `npm run dev` | `vite` | Vite development server |
| `npm run build` | `tsc -b && vite build` | Type-check, then write the production bundle to `dist/` |
| `npm run lint` | `eslint .` | Client lint |
| `npm run preview` | `vite preview` | Serve the existing production bundle |
| `npm test` | `vitest run` | Run client unit tests once |
| `npm run test:watch` | `vitest` | Run unit tests in watch mode |
| `npm run test:e2e` | `playwright test` | Run Playwright tests |
| `npm run test:e2e:ui` | `playwright test --ui` | Open Playwright UI mode |
| `npm run test:e2e:headed` | `playwright test --headed` | Run Playwright with a visible browser |

Playwright uses one Chromium worker, serial execution, `client/e2e/` as its test
directory, and starts `npm run dev` as its web server. See
[client configuration](configuration.md) for test variables and
[CI jobs](../ci-jobs.md) for the automated command sequence.
