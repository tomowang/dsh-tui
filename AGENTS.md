# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this is

`@tomowang/dsh-tui` is an out-of-tree terminal front door for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It stacks on `@deepseek-ai/dsh-base` the same way `dsh-web-app`/`dsh-headless` do, but drives the agent from a TTY instead of a browser. It is simultaneously:

- a **Cordis plugin** (`src/index.ts`, name `tui`) that owns terminal input/presentation only — agent lifecycle, session persistence, tool execution, and model policy stay in `dsh-base`;
- a **dsh bundle** (`package.json`'s `dsh.bundle.patch` points at `cordis.patch.yml`) that inserts `tui-startup` and `tui` into the plugin tree and disables `hmr` (module-reload redraws would fight the interactive terminal).

## Commands

```sh
pnpm install
pnpm run build        # tsc -p tsconfig.json → lib/
pnpm run typecheck     # tsc --noEmit
```

There is no lint script and no test suite in this package. To exercise it end-to-end, point a `dsh` profile's dependency at this checkout and rebuild before each run — profiles load the built `lib/` under plain Node, not `src/`:

```sh
dsh plugin --profile tui add /path/to/dsh-tui
pnpm run build
dsh --profile tui
dsh --profile tui --resume <sessionId>
dsh --profile tui --dump-config   # inspect the composed plugin tree
```

Both stdin and stdout must be real TTYs — `apply()` in `src/index.ts` throws loudly otherwise instead of degrading, so pipes/CI must use `dsh --profile headless`.

## Architecture

**Two-plugin split (`src/startup.ts` → `src/index.ts`).** `tui-startup` parses this app's CLI flags (everything after the launcher's own args) via `dsh-cmdline`/commander and publishes them as an ordinary Cordis service (`TUI_STARTUP_SERVICE` / `tuiStartup`). The `tui` plugin injects that service rather than parsing argv itself — this mirrors how `dsh-headless` is structured and keeps startup-value resolution lazy/testable. The wiring between the two is declared in `cordis.patch.yml`, not in code.

**Log-first rendering.** The TUI never holds its own mutable view of "what happened" — it renders only from the durable, append-only `agent.session.events` log (`src/render.ts`). On startup it replays persisted events, then follows live `session/event` emissions through the same formatting path (`formatEvent` in `render.ts`). This is what makes `--resume` show exactly the history the log carries, and it means replay and live events must stay behaviorally identical (see the `options.replay` branch in `formatEvent` for the one deliberate exception: `user/message` only re-prints during replay, since live input was just typed by the reader).

**Store as the seq-dedupe boundary (`src/tui/store.ts`).** `TuiStore` is a dependency-free, Ink/Cordis-agnostic projection exposed via `useSyncExternalStore`. It owns the one invariant that keeps replay and live event streams from double-rendering: `appendEvent` drops anything with `seq <= lastSeq`. Session/agent event listeners in `index.ts`'s `run()` all funnel into this store; components never touch Cordis events directly.

**Input routing (`src/index.ts` `actions.send`).** Line input maps to the agent inbox based on current status: `agent.followup()` while idle, `agent.steer()` while a turn is running. `Ctrl+C` cancels the running turn (idle behavior differs — see `PromptInput.tsx`); `exitOnCtrlC: false` is set on the Ink `render()` call in `src/tui/mount.tsx` specifically so `PromptInput`'s own `useInput` handler can own cancel-vs-shutdown semantics instead of Ink's default.

**Model-profile services are optional, re-checked at point of use.** `settings`, `credentials`, and `llm` are *not* in this plugin's `inject` array (only `agentDefaultModel`, `agents`, `sessions` are required) because not every profile mounts them. The `/model` overlay (`src/tui/modelProfile/`) degrades to an error notice instead of refusing to start the whole TUI when they're absent — see `requireModelProfileServices()` in `index.ts`, which every model-profile action call re-checks rather than caching.

**Custom provider persistence.** User-declared LLM providers are joined at read time from `ctx.llm.listConfigurableProviders()` (static/live catalog) against `ctx.settings.describe()` (persisted overrides) and `ctx.credentials.describe()` (API key presence, redacted). Writes go through `settings.mutate()` with an explicit `revision` for optimistic-concurrency, and a *new* custom provider is namespaced under `CUSTOM_PROVIDER_NAMESPACE` (`llm-pi-ai`) with its route as the settings path segment. `deriveApiKeyRef()` turns a route like `my-proxy` into a POSIX credential ref `MY_PROXY_API_KEY`.

**Rendering entry point.** `src/tui/mount.tsx` is deliberately the *only* JSX call site outside the `tui/` component tree — `index.ts` stays a plain `.ts` module. `App.tsx` wires `TuiStore`/`TuiActions` into the component tree (`Banner`, `StatusBar`, `EventLine` list, `PromptInput`, `QueuedIndicator`, and the full-screen `ModelProfileOverlay`).

## Current status / roadmap

Early scaffold: settled session events print to native scrollback; a live status bar and boxed prompt sit pinned to the terminal's bottom row. Not yet implemented (see README for details): streaming output from `assistant/chunk`, tool cards via `presentCall`/`presentResult`, an in-terminal `userInteraction` approval provider, and full-screen differential rendering with terminal restoration on failure. The removed first-party `@deepseek-ai/dsh-tui` (deleted from the harness repo, recoverable from git history) is the reference for this direction.
