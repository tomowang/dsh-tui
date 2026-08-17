# Changelog

All notable changes to this project are documented in this file.

## [0.4.0] - 2026-08-17

### Bug Fixes

- Unstick /trajectory collapse and stop leaking injected-context payloads
- *(changelog)* Add blank line between release sections in git-cliff template

### Documentation

- Drop stale manual bundle-declaration step from README install
- Add build/npm/license/tech-stack badges and a push/PR CI workflow
- Document the Tool Cards overlay, reasoning display, and Markdown rendering
- Codify checking README/AGENTS.md before committing feature work
- *(assets)* Trim duplicate trailing frames and refresh gif/screenshot

### Features

- Adopt a DeepSeek-branded truecolor palette across the TUI
- Detect and render Markdown in assistant text
- Render reasoning content
- Add a Tool Cards overlay for expanding/collapsing tool output
- Align /trajectory ledger rows with the web portal's kind tags

### Refactor

- Drop /status, fold event count into the status bar

## [0.3.0] - 2026-08-16

### Bug Fixes

- Restore terminal state synchronously on crash exit

### Documentation

- Replace screenshot/mp4 screencast with inline gif
- Document shell mode and @-file-mention autocomplete

### Features

- Stream assistant output live from assistant/chunk
- Render tool cards via presentCall/presentResult
- Answer approvals and ask_user_question in-terminal
- Add shell mode via leading `!`
- Add @-file-mention autocomplete to the prompt
- Add /help command to show commands and shortcuts

## [0.2.1] - 2026-08-15

### Bug Fixes

- Mark dsh-base framework packages as peerDependencies

## [0.2.0] - 2026-08-15

### Bug Fixes

- Align slash-command dropdown to the widest command
- Swap permission-indicator emoji for monochrome glyphs
- Resume a session's persisted log instead of colliding with it
- Drop redundant session- prefix from status bar and resume hint
- Merge context indicator into stats line instead of a separate row

### Documentation

- Document current TUI features, commands, and shortcuts in README

### Features

- Switch npm publish to Trusted Publishing (OIDC)
- Add /trajectory ledger overlay
- Add /compact manual compaction command
- Add /context context-usage indicator
- Persist prompt-line history across sessions
- Add /plugins loaded-plugin-tree command
- Add agent preset support (/presets, --agent-preset, status bar)

## [0.1.0] - 2026-08-15

### Bug Fixes

- Align dependencies with the published 0.1.0-rc.6 line
- Pin prompt to bottom row via computed spacer instead of flexGrow
- Pin session stats line to the bottom row
- Render tool/result events in the transcript
- Harden startup guards and custom-provider persistence
- Lift prompt buffer state into App to size layout same-frame

### Chores

- Init project
- Add ESLint with type-aware rules on src/

### Documentation

- Add README with architecture, install, and roadmap
- Add AGENTS.md with CLAUDE.md symlink

### Features

- Add startup provider and interactive TUI runner
- Add dsh mode-bundle patch over dsh-base
- Rebuild interactive TUI on React + Ink
- Add Claude-Code-style startup banner with half-block logo
- Add /model overlay for LLM provider profile management
- Box the prompt input and pin it to the terminal's bottom row
- Add slash-command autocomplete menu to the prompt
- Require double Ctrl+C or Ctrl+D to exit the prompt
- Add up/down-arrow history navigation to the prompt
- Add /clear command to start a fresh session
- Always show the reader's submitted prompt and collapse injected context
- Add readline-style shortcuts and multi-line input to the prompt
- Add Shift+Tab permission-mode switching to the prompt
- Add whole-log session stats line to the status bar
- Add Tab command completion to the prompt
- Add git-cliff changelog + npm publish release workflow

### Testing

- Add Vitest unit tests for render/store/statsFormat/commands

