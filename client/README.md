# Meridian Client

## E2E Tests (Playwright)

### Quick start — frontend-only tests (no backend needed)

These tests cover auth form validation, the demo workspace, theme toggle,
share dialog, invite link, and backend-unavailable behaviour.

```bash
# From the client/ directory:
npm run test:e2e
```

Playwright starts the Vite dev server automatically (`npm run dev` on port
5173) and re-uses it if already running.

### Full test suite — requires a running backend

Auth, workspace, file-create/rename/delete, Monaco editing, save/persist,
and file-import tests require both the Vite dev server **and** the NestJS
backend.

```bash
# Terminal 1 — start the backend (from server/)
npm run start:dev

# Terminal 2 — run all tests (from client/)
MERIDIAN_BACKEND_URL=http://localhost:3000 npm run test:e2e
```

Tests that need the backend call `isBackendAvailable()` at runtime and skip
themselves gracefully when the backend is not reachable.

### Interactive UI mode

```bash
npm run test:e2e:ui
```

### Headed mode (watch the browser)

```bash
npm run test:e2e:headed
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `MERIDIAN_BASE_URL` | `http://localhost:5173` | Playwright `baseURL` |
| `MERIDIAN_BACKEND_URL` | `http://localhost:3000` | Backend availability probe |

### Test files

| File | Backend needed | Covers |
|---|---|---|
| `e2e/auth.spec.ts` | No (offline), Yes (backend group) | Landing page, login default, weak-password block, forgot-password, sign-up, sign-out |
| `e2e/workspace.spec.ts` | Yes | Workspace load, auto-create, file/folder CRUD, Monaco edit, Cmd+S save, content persistence |
| `e2e/file-import.spec.ts` | Yes | Open local file, import ZIP, file appears in explorer |
| `e2e/ui-controls.spec.ts` | No (theme/share), Yes (collab empty state) | Theme toggle, share dialog, copy link, invite route, collaboration panel |
| `e2e/offline.spec.ts` | No | Backend-unavailable banner, demo mode labels, no crash |

### Generated fixture

`e2e/global-setup.ts` writes `e2e/fixtures/test-project.zip` before the
suite runs. The ZIP contains a single `hello.ts` file and requires no
external dependencies.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
