# MaxCode

A local-first AI coding agent by DevSoft. MaxCode pairs a warm React chat interface with a zero-dependency Node daemon that owns the real workspace, shell, git, search, deploy and provider credentials on your machine.

The daemon binds to `127.0.0.1` only. It serves the prebuilt app from `dist/` and stores everything under `~/.maxcode`. API keys and hosting tokens are encrypted with AES-256-GCM using a local `master.key`; the browser only ever receives a masked hint.

## Run the built app

Requires Node.js 20 or newer. No `npm install` is needed to run the built app.

```bash
npm start
```

`npm start` launches the daemon in the background and opens `http://127.0.0.1:4174`. Equivalent commands:

```bash
node server/maxcode.mjs start --open
node server/maxcode.mjs status
node server/maxcode.mjs logs
node server/maxcode.mjs stop
```

On first launch, choose a real project folder, then add a provider key in **Settings → Models** and pick a live model. Everything else — workspace tree, editor, git, search, build/plan modes, subagents and deploys — runs through the local daemon.

## What is in the app

- **Build and Plan modes.** Build can edit files and run commands; Plan is read-only investigation.
- **Live models and reasoning.** Model lists come from each provider; the models.dev catalog is only a fallback. Thinking is the provider's job: an effort control appears only when the selected model advertises effort levels or a token budget, and it is sent automatically.
- **Themes.** Light, Dark, Night Owl, Claude Code and Flame, plus System, which follows the OS preference. Syntax highlighting follows the theme.
- **Real tools.** Read/write/edit files, grep, list files, shell, git, web search, URL reading and a read-only SubAgent. Each user turn renders as one answer, with consecutive tool rounds collapsed into a single “Used N tools” group.
- **Turn queue.** A prompt sent while a turn is streaming waits its turn and runs next, instead of splitting into a second reply.
- **Local plugins.** Install a `.pluginmax` archive from disk, review its workspace capabilities and declared HTTPS domains one by one, preview it in a sandbox, then mark it Safe to run its JavaScript. The same panel builds a package from a folder you pick — one `.js` entry, an optional stylesheet, a `manifest.json` if the folder has one — and a plugin that needs no network declares no domains. Packages and grants live under `~/.maxcode/plugins`, outside the selected workspace.
- **Workspace panel.** Folder tree, file editor, git status and quick file actions.
- **Deploy.** Cloudflare Pages, Netlify and Vercel, for the open workspace or another existing folder. Tokens stay in the daemon and are passed to CLIs through environment variables.
- **Local history.** Conversations, settings, workspaces and encrypted keys survive restarts.

Slash commands include `/search`, `/plan`, `/build`, `/new`, `/workspace`, `/deploy`, `/settings` and `/clear`.

## Development

```bash
npm install
npm run dev        # starts the daemon and Vite on http://127.0.0.1:5173
npm run build      # typecheck + production build into dist/
npm run typecheck
```

`npm run dev` proxies `/api` to the daemon on port 4174. For a production-style run, use `npm run build` followed by `npm start`.

Remote models need provider access from this machine. Local providers such as Ollama are keyless but must already be running; MaxCode reports an actionable error when they are not.

OpenCode free-tier models only work inside OpenCode itself, so they are hidden here. Paid OpenCode models work with an API key. Deploys require the matching CLI (`wrangler`, `netlify` or `vercel`) or `npx`, plus credentials in **Settings → Deploy**.

## Data and security

- Data directory: `~/.maxcode` (override with `MAXCODE_DATA`).
- `secrets.enc` and `master.key` are created with mode `600`.
- All API routes require the local session cookie and a CSRF header; Host and Origin are checked.
- The daemon rejects code execution outside the selected workspace except for an explicit, existing deploy folder.
- No telemetry or DevSoft-hosted proxy. Provider requests go directly from the daemon to the provider you configured.

## Stack

TypeScript, React 19, Vite, Tailwind CSS, Zustand, direct provider adapters (OpenAI, Anthropic, Gemini, OpenCode and OpenAI-compatible endpoints), and a Node HTTP daemon with no runtime dependencies.

```
src/        React app, stores, agent loop, adapters and tools
server/     local daemon, encrypted store, workspace tools and deploy
dist/       verified production build
public/     favicon
```
