# Client source layout

```text
client/
|-- e2e/
|   |-- fixtures/              Generated/import fixtures
|   |-- helpers/               Authentication and workspace test helpers
|   |-- global-setup.ts        ZIP fixture creation and stale-user cleanup
|   `-- *.spec.ts              Playwright browser scenarios
|-- public/                    Files copied without Vite transformation
|-- src/
|   |-- components/
|   |   |-- editor/            Monaco editor, tabs, themes, remote cursors
|   |   |-- layout/            Workspace chrome, dialogs, panels, explorer
|   |   `-- ui/                Shared presentation primitives
|   |-- constants/             Brand, version, and file-display constants
|   |-- data/                  Legacy mock data (not activated by runtime loading failures)
|   |-- hooks/                 Workspace, file, save, realtime, and terminal flows
|   |-- lib/                   HTTP, Socket.IO, Yjs, Monaco, import/export helpers
|   |-- pages/                 Landing, workspace, invite, verify/reset-password routes
|   |-- store/                 Zustand workspace store
|   |-- types/                 Client domain types
|   |-- App.tsx                Browser routes and lazy page boundaries
|   |-- index.css              Global and Tailwind styles
|   `-- main.tsx               React entry point
|-- Dockerfile                 Vite build and Nginx runtime
|-- nginx.conf                 SPA fallback and response headers
|-- playwright.config.ts       Playwright runner
|-- vite.config.ts             React Vite plugin
`-- vitest.config.ts           Vitest runner
```

Unit tests are colocated as `src/**/*.test.ts`; Playwright tests are
`e2e/*.spec.ts`. For component/data-flow explanation, see
[client architecture](../../explanation/client-architecture.md).

## Visual conventions

Account routes share `AccountLayout` and the workspace's `MeridianWordmark`.
Keep the favicon and wordmark's M consistent. Use the semantic color tokens in
`index.css`: Harvard crimson (`#A51C30`), black, white, and neutral grays.
White is the default theme. Black surfaces are the optional dark mode; an
explicit theme choice is remembered across routes and sessions.
Crimson container tokens keep primary buttons consistent across themes; small
text uses white on dark surfaces for contrast. Errors retain explicit labels.
Monaco and terminal backgrounds follow those same surfaces. Geist is the
interface font; JetBrains Mono is for code and paths.

Prefer clear labels, thin dividers, and useful actions over decorative cards,
glows, gradients, and promotional badges. Account forms scroll on short screens.
Empty states should explain the next available action, respect workspace roles,
and only describe capabilities that the server actually enables.
