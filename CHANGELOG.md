# Changelog

All notable changes to this project are documented in this file.

## [0.1.0] - 2026-08-15

### Bug Fixes

- Align dependencies with the published 0.1.0-rc.6 line
- Pin prompt to bottom row via computed spacer instead of flexGrow
- Pin session stats line to the bottom row
- Render tool/result events in the transcript
- Harden startup guards and custom-provider persistence

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

### Testing

- Add Vitest unit tests for render/store/statsFormat/commands
