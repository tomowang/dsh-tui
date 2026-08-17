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
pnpm run lint          # eslint .
pnpm run test          # vitest run
```

A Husky `pre-push` hook (`.husky/pre-push`, wired via the `prepare` script) runs lint, typecheck, test, and build before every push, so failures surface locally instead of in CI. To exercise the TUI end-to-end, point a `dsh` profile's dependency at this checkout and rebuild before each run — profiles load the built `lib/` under plain Node, not `src/`:

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

**Log-first rendering.** The TUI never holds its own mutable view of "what happened" — it renders only from the durable, append-only `agent.session.events` log (`src/render.ts`). On startup it replays persisted events, then follows live `session/event` emissions through the same formatting path (`formatEvent` in `render.ts`). This is what makes `--resume` show exactly the history the log carries, and replay and live events render identically: `user/message` prints on both paths, so a submitted prompt stays visible in the transcript once the prompt box clears it. A `user/message`'s `source.kind` also decides how much of it shows: `'user'` (a direct human prompt) prints in full, while `'plugin'` (synthetic `agent.inject()` context — subdir AGENTS.md, skill content, cron notices, …) collapses to one label line instead of dumping its content, mirroring how a web chat UI collapses injected-context rows.

**Store as the seq-dedupe boundary (`src/tui/store.ts`).** `TuiStore` is a dependency-free, Ink/Cordis-agnostic projection exposed via `useSyncExternalStore`. It owns the one invariant that keeps replay and live event streams from double-rendering: `appendEvent` drops anything with `seq <= lastSeq`. Session/agent event listeners in `index.ts`'s `run()` all funnel into this store; components never touch Cordis events directly.

**Input routing (`src/index.ts` `actions.send`).** Line input maps to the agent inbox based on current status: `agent.followup()` while idle, `agent.steer()` while a turn is running. `Ctrl+C` cancels the running turn (idle behavior differs — see `PromptInput.tsx`); `exitOnCtrlC: false` is set on the Ink `render()` call in `src/tui/mount.tsx` specifically so `PromptInput`'s own `useInput` handler can own cancel-vs-shutdown semantics instead of Ink's default.

**Model-profile services are optional, re-checked at point of use.** `settings`, `credentials`, and `llm` are *not* in this plugin's `inject` array (only `agentDefaultModel`, `agents`, `sessions` are required) because not every profile mounts them. The `/model` overlay (`src/tui/modelProfile/`) degrades to an error notice instead of refusing to start the whole TUI when they're absent — see `requireModelProfileServices()` in `index.ts`, which every model-profile action call re-checks rather than caching.

**Custom provider persistence.** User-declared LLM providers are joined at read time from `ctx.llm.listConfigurableProviders()` (static/live catalog) against `ctx.settings.describe()` (persisted overrides) and `ctx.credentials.describe()` (API key presence, redacted). Writes go through `settings.mutate()` with an explicit `revision` for optimistic-concurrency, and a *new* custom provider is namespaced under `CUSTOM_PROVIDER_NAMESPACE` (`llm-pi-ai`) with its route as the settings path segment. `deriveApiKeyRef()` turns a route like `my-proxy` into a POSIX credential ref `MY_PROXY_API_KEY`.

**Rendering entry point.** `src/tui/mount.tsx` is deliberately the *only* JSX call site outside the `tui/` component tree — `index.ts` stays a plain `.ts` module. `App.tsx` wires `TuiStore`/`TuiActions` into the component tree (`Banner`, `StatusBar`, `EventLine` list, `PromptInput`, `QueuedIndicator`, and the full-screen `ModelProfileOverlay`).

**In-terminal approval/question answerers.** `src/index.ts`'s `run()` registers two Cordis-context-scoped (not per-session) answerers behind a single shared FIFO queue (`interactionQueue`/`activeInteraction`), so an approval and a multi-question `ask_user_question` call never fight over the one overlay slot: a bare `ctx.on('approval/request', …)` listener answers `@deepseek-ai/dsh-user-approval`'s tool-approval waterfall (`ApprovalOverlay.tsx`, y/n/allow-reject), and `ctx.userQuestions.registerProvider(...)` (optional — only when that profile mounts it) answers `@deepseek-ai/dsh-user-questions`' seam behind `ask_user_question` and `dsh-plan-mode`'s `exit_plan_mode` plan review (`QuestionOverlay.tsx`, option cursor + multi-select + free-text "Other…", `esc` to skip a question). Both route through whichever session's `store` is current, so a `/clear` mid-request still lands the prompt on the live screen; see `src/tui/interaction/`.

**Shell mode bypasses the agent loop entirely (`src/tui/PromptInput.tsx`, `store.ts`).** A leading `!` typed at an empty prompt — Claude Code's convention — flips `PromptState.shellMode`, which swaps Enter's meaning to "run this line as a local shell command" instead of `agent.followup()`/`agent.steer()`. The command runs outside the agent loop and never touches `agent.session.events`; its output is a display-only transcript entry (`ShellRunLine.tsx`) that `TuiStore` interleaves with real session events in completion order, so it settles into scrollback alongside agent output without being persisted or replayed on `--resume`. `Esc` or backspace on an empty shell-mode buffer exits back to normal mode.

**`@`-file-mention is prompt-text insertion, not a wire-format change (`src/tui/fileMention.ts`, `fileIndex.ts`).** `mentionQuery()` detects an open `@token` ending at the cursor (whitespace-delimited, so it can open mid-sentence); `matchFileCandidates()` fuzzy-ranks the repo's file index (`git ls-files`, falling back to a bounded walk outside a git repo) by path-prefix, then basename-prefix, then length. `Tab`/`Enter` splices the picked path into the prompt buffer at the `@` — the model only ever sees a plain path string and reads the file itself once the prompt is sent, mirroring the `/`-slash-command dropdown's shape.

**Markdown rendering is detect-then-style, not a parser (`src/markdown.ts`).** `renderMarkdown()` is applied to both settled `assistant/message` text and the live streaming fold (`formatStreamingText`, both in `src/render.ts`), and is a no-op unless `looksLikeMarkdown()` first finds an unambiguous signal (fenced code, ATX header, list, blockquote, rule, table row, link, bold, strikethrough, or inline code) — plain prose, including text with a stray `*`/`_`, passes through byte-for-byte unchanged so this never mangles ordinary chat replies. Detection deliberately excludes lone single-`*`/`_` emphasis on its own (highest false-positive risk: globs, multiplication, snake_case) — it only renders once some other cue has already confirmed the text is Markdown. Rendering itself is a line-oriented pass with a small fenced-code state machine, not a CommonMark-conformant parser, so multi-line inline spans and nested block constructs (e.g. a header inside a blockquote) aren't specially handled — reasonable for terminal chat output, not a general-purpose renderer. Table rows are detected (to avoid misfiring the plain-prose path) but not box-drawn.

**Reasoning content renders as a distinct violet block ahead of the visible text.** `reasoningOf()` mirrors `textOf()` but keeps `type === 'reasoning'` blocks instead (`src/render.ts`); both settled `assistant/message` rendering and the live streaming fold (`formatStreamingText`, `StreamingLine.tsx`) call both extractors and, when reasoning is non-empty, prefix it with a dim `✦ thinking` label rendered in `theme.reasoning` — set apart from the assistant's answer rather than interleaved with it. `TuiStore.foldChunk` folds `reasoning-delta` chunks into `StreamingState.reasoningText` the same way `text-delta` chunks fold into `.text`, using the same `BlockAssembler` instance so ordering across interleaved block indexes stays correct.

## Current status / roadmap

Functionally a complete single-session terminal client — session replay/resume, streaming, tool cards, in-terminal approvals/questions, model/preset/compaction/permission management, shell mode, `@`-file-mention autocomplete, and persisted prompt history are all in place — with a handful of known presentation gaps below; "early scaffold" undersells it and describes only the very first cut. Settled session events print to native scrollback; a live status bar and boxed prompt sit pinned to the terminal's bottom row. Assistant text streams live from `assistant/chunk` (folded via `@deepseek-ai/dsh-llm`'s `BlockAssembler` in `TuiStore`, rendered in the live region below `<Static>` until the step settles — see `src/tui/store.ts`, `src/tui/StreamingLine.tsx`). `tool/call`/`tool/result` events render through a tool's declared `presentCall`/`presentResult` (`@deepseek-ai/dsh-tools`) when available — a diff, a terminal block, grouped search matches, a line-numbered read, web citations — falling back to the original flat line otherwise (see `formatEvent` in `src/render.ts`). Approvals and model questions (`ask_user_question`, plan-mode review) are answered in-terminal — see the "In-terminal approval/question answerers" architecture note above. A synchronous `restoreTerminal()` (`src/index.ts`) is registered on `process.once('exit', ...)` once the TTY check passes, and disables stdin raw mode and shows the cursor as a last line of defense: React's `useInput` cleanup (the normal way Ink turns raw mode back off) defers to a microtask that a `process.on('exit')` handler never gets another turn for, so without this a SIGTERM, an early SIGINT, or an uncaught exception could otherwise leave the reader's shell in raw mode with a hidden cursor.

Known gaps, roughly in order of how much they matter:

- **No tool-card expand/collapse.** Unlike the removed first-party TUI's `Ctrl+O` fold, a card body is capped to a fixed line count instead (Ink's `<Static>` prints are permanent, so there's nothing to toggle after the fact).
- **No full-screen differential rendering** — an alternate-screen-buffer mode with a self-owned virtual-screen diff, replacing the current native-scrollback/`<Static>` model. The removed first-party `@deepseek-ai/dsh-tui` (deleted from the harness repo, recoverable from git history) remains the reference for that direction; going that direction would also mean giving up native scrollback copy/paste of history, which the current model gets for free.

## Releasing

Changelog and GitHub Release notes are generated from [Conventional Commits](https://www.conventionalcommits.org/) via [git-cliff](https://git-cliff.org/) (`cliff.toml`). To cut a release:

1. Bump `version` in `package.json` (e.g. `npm version --no-git-tag-version <patch|minor|major>`).
2. `pnpm run changelog` — regenerates `CHANGELOG.md`, folding commits since the last tag into a new `vX.Y.Z` section.
3. Review the diff, then `git add package.json CHANGELOG.md && git commit -m "chore(release): vX.Y.Z"`.
4. `git tag vX.Y.Z && git push && git push --tags`.

Pushing the tag triggers `.github/workflows/release.yml`, which re-verifies the build, checks the tag matches `package.json`'s version, cuts a GitHub Release from `CHANGELOG.md`'s latest section, and publishes to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC — no stored npm token). One-time setup: on the `@tomowang/dsh-tui` package's npmjs.com settings, add a Trusted Publisher pointing at this GitHub repo with workflow filename `release.yml`.
