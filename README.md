# dsh-tui

An open-source terminal front door for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

`@tomowang/dsh-tui` is an **out-of-tree mode bundle**: it stacks on `@deepseek-ai/dsh-base` exactly like the shipped `dsh-web-app` and `dsh-headless` bundles do, but drives the agent from your terminal instead of a browser. The package is both a Cordis plugin (terminal input and presentation) and a dsh bundle (`dsh.bundle.patch` in `package.json` points at [`cordis.patch.yml`](cordis.patch.yml)); everything else — model adapters, tools, session persistence, sandbox and approval policy — stays in `dsh-base` and remains patchable underneath.

> Status: early scaffold. Line-oriented readline loop today; full-screen differential rendering, streaming output, tool cards, and the `userInteraction` approval panel are on the roadmap below.

## How it works

- The TUI renders **only from the durable session log**: it replays `agent.session.events` on startup and follows `session/event` live, so `--resume` shows the exact history the log carries — the harness's "model-visible ⟺ logged" invariant does the heavy lifting.
- Line input maps to the agent inbox: `agent.followup()` while idle, `agent.steer()` while a turn is running, `Ctrl+C` cancels the running turn.
- `tui-startup` parses this app's flags (everything after the launcher's own) through `dsh-cmdline` and publishes them as an ordinary Cordis service; the runner row reads them via the bundle patch, mirroring `dsh-headless`.
- Both stdin and stdout must be real TTYs; the plugin fails loud instead of degrading, so pipes keep using `dsh --profile headless`.

## Install

Requires Node `^22.19 || >=24` and a `DEEPSEEK_API_KEY`.

```sh
# 1. Install the dsh launcher
npm install -g @deepseek-ai/dsh

# 2. Create the profile and install this bundle into it
dsh plugin --profile tui add @tomowang/dsh-tui

# 3. Declare the bundle stack in the profile manifest
#    ($DSH_HOME/profiles/tui/package.json)
#    "dsh": { "profile": { "bundles": [
#      "@deepseek-ai/dsh-base",
#      "@tomowang/dsh-tui"
#    ] } }

# 4. Run
dsh --profile tui
dsh --profile tui --resume <sessionId>   # reopen a persisted session
dsh --profile tui --dump-config          # inspect the composed plugin tree
```

Any row `--dump-config` prints — the model adapter, tool set, sandbox policy, this TUI's own config — can be overridden from the profile's `cordis.patch.yml` without touching this package.

## Terminal commands

| Input | Effect |
|---|---|
| any text | follow-up while idle, steering while a turn runs |
| `/status` | session id, run state, logged event count |
| `/exit`, `/quit` | cancel, wait for idle, flush the session, exit |
| `Ctrl+C` | cancel the running turn; at idle, exit |

## Develop

```sh
pnpm install
pnpm run build        # tsc → lib/
pnpm run typecheck
```

To try a local checkout inside a profile, point the profile's dependency at this directory (`dsh plugin --profile tui add /path/to/dsh-tui`) and rebuild before each run — profiles load the built `lib/` under plain Node.

## Roadmap

- Streaming output from `assistant/chunk` instead of settled messages
- Tool cards through each tool definition's `presentCall` / `presentResult`
- `userInteraction` provider: approvals and model questions answered in-terminal
- `/model` selector over the `ctx.llm` catalog
- Full-screen differential rendering with terminal restoration on failure

The removed first-party TUI (`@deepseek-ai/dsh-tui`, deleted from the harness repo in Aug 2026 but recoverable from its git history) solved most of these already and is the reference for this project's direction.

## License

[MIT](LICENSE)
