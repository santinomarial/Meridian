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
|   |-- pages/                 Landing, workspace, invite, reset-password routes
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
