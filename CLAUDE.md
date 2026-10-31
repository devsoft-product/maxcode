# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # daemon on :4174 + Vite on :5173 (proxies /api)
npm test           # node --test — discovers *.test.mjs anywhere
node --test src/lib/themes.test.mjs   # single test file
npm run typecheck  # tsc -b --pretty
npm run build      # tsc -b && vite build → dist/
npm start          # daemon serving the prebuilt dist/ on :4174
node server/maxcode.mjs {status,logs,stop}
```

Node 24 runs the `.test.mjs` files directly: they import TypeScript sources with an explicit `.ts` extension (`from './themes.ts'`) and rely on Node's built-in type stripping. See **Testing traps** below.

## Two processes, one app

The React app in `src/` never talks to a provider or the filesystem directly. It calls a local Node daemon (`server/daemon.mjs`, `127.0.0.1:4174`) over `/api`, and the daemon owns every privileged operation — provider credentials, workspace files, shell, git, search, deploy, plugins.

- **Provider calls** go browser → `POST /api/llm` → daemon → provider. Keys are AES-256-GCM encrypted in `~/.maxcode/secrets.enc`; the browser only ever sees a masked hint, so adding a provider means touching both `src/` and `server/lib/providers.mjs`.
- **Tool calls** are dispatched by the client agent loop via `src/lib/daemon.ts` → `POST /api/tools/execute` → `server/lib/tools.mjs`.
- **All `/api` routes** require a session cookie plus `x-maxcode-csrf`; Host, Origin and `Sec-Fetch-Site` are checked in `server/daemon.mjs`. New routes go inside the `pathname.startsWith('/api/')` block, after the session guard.

The daemon is documented as zero-runtime-dependency, but `shared/plugin-package.mjs` imports `fflate` from `node_modules` at runtime (`server/lib/plugins.mjs` imports it). That dependency is *not* bundled — a `node_modules`-free copy of the app cannot load plugins.

## Agent loop

`src/agent/index.ts` runs the whole loop in the browser, up to `MAX_ROUNDS` rounds. Each round appends one `AssistantMessage`, executes its tool calls, appends `ToolMessage`s, then loops.

`src/agent/queue.ts` serializes runs **per session** (`createTurnQueue`) and caps each run's history with `turnHistory`, which stops at the *next* user message. This is what keeps a prompt submitted mid-stream from either being consumed early or splitting into a second reply — do not replace it with a slice of the store.

Auto-compaction (`src/agent/compact.ts`) triggers at `AUTO_COMPACT_THRESHOLD` context usage before round 0.

## Chat rendering

Messages are stored flat (`UserMessage | AssistantMessage | ToolMessage`) with a `round` field. Presentation is derived, never stored: `src/lib/conversation.ts` (`groupConversationTurns`) folds consecutive tool messages into one `tools` segment and drops assistant rounds that only called tools. `TurnBlock` in `src/components/MessageItem.tsx` renders one user turn as one answer, and `UsedGroup` is the collapsible "Used N tools" cluster.

## Plugins

Lifecycle: install (disabled + untrusted) → review capabilities/domains → optional sandboxed preview → mark **Safe** → enable. A changed manifest hash invalidates grants and trust.

- `shared/plugin-package.mjs` is the package contract, shared verbatim by the browser and the daemon: `.pluginmax` is a ZIP (via `fflate`) with `manifest.json`, one JS entry, one CSS stylesheet, bounded assets. It is also the only place capability/domain/ID validation lives.
- `server/lib/plugins.mjs` stores packages under `~/.maxcode/plugins` and is the **only** path to the network. `network.request` is HTTPS-only, port 443, exact host from `manifest.domains` ∩ `grants.domains`, private IPs blocked, redirects refused, content-type allowlist, 64 KB request / 1 MB response / 12 s timeout.
- `src/plugins/api.ts` (`createPluginApi`) re-checks grants at every call site, so plugin code cannot reach an unapproved capability even by calling the API directly.
- `src/plugins/runtime.ts` runs Safe plugins as **blob ES modules**, not `new Function`: the daemon's CSP (`server/lib/http.mjs`) has no `unsafe-eval`, and `blob:` was added to `script-src` for exactly this. Removing either breaks plugin activation.
- `src/plugins/preview.ts` builds the sandboxed preview (`iframe sandbox="allow-scripts"`, deliberately **no** `allow-same-origin`) with a stub API and validates every postMessage through `bridge.mjs`.

Safe is an explicit trust choice, not a sandbox — after Safe the plugin runs same-realm with full app privileges. The UI copy must keep saying so.

## Theming

Themes are `[data-theme='<id>']` attribute selectors on `<html>` in `src/index.css`, each defining the same 18 semantic RGB-triplet tokens (`--canvas`, `--ink`, `--accent`, `--syn-keyword`, …). The `dark` class is toggled alongside for Tailwind's `dark:` variants. `tailwind.config.js` maps those tokens to utilities; components should use tokens, never literal colors.

Three places must stay in sync when adding a theme: the CSS token block, `THEMES`/`NAMED`/`DARK` in `src/lib/themes.ts`, and the boot-time script inlined in `index.html` (which prevents a flash of the wrong theme before hydration). `src/lib/themes.test.mjs` enforces the token set.

Plugin themes are registered at runtime as `plugin-<pluginId>:<themeId>` and styled the same way, so `themeIsDark` must go through the registry rather than a hardcoded list.

## Testing traps

- Test files are colocated `*.test.mjs`; there is no framework. Import TypeScript with the explicit extension: `import { x } from './thing.ts'`.
- A `.ts` file imported by these tests **cannot** use extensionless relative imports — Node's ESM resolver fails with `ERR_MODULE_NOT_FOUND`. That is why helpers used by tests keep `import type` only or live in `.mjs`.
- `assert.rejects` does not catch a synchronous throw; API wrappers under test are `async` on purpose.

## Traps

- **`server/src/`, `server/index.html`, `server/vite.config.ts` are a stale snapshot** of the app and are referenced by nothing. Vite's root is the repo root. Edit `src/` and `index.html` only.
- `dist/` is committed to git and is what the daemon serves — a source change is invisible in `npm start` until `npm run build`.
- The data directory is `~/.maxcode` (override with `MAXCODE_DATA`); provider keys, chats, settings and plugins all live there, so tests and manual runs share state with the real app.