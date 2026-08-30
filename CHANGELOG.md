# Changelog

All notable changes to this project are documented in this file.

## [0.8.0] - 2026-08-30

### Bug Fixes

- *(markdown)* Render table rows as aligned terminal tables (#2)

### Chores

- *(repo)* Declare storefront screenshots

### Features

-  feat(tui): add /rename and /resume, Claude Code CLI-style (#3)

* feat(tui): add /rename and /resume commands

Both harness capabilities already existed but had no TUI entry point:

- /rename <title>: calls ctx.sessionTitle.rename() directly (the same
  service the Web UI's session.rename RPC wraps) — no new harness code
  needed, since dsh-tui is an in-process Cordis plugin with native
  service access, not a remote client like the browser. Follows the
  optional-service pattern used by compact/plan/goal: a profile without
  sessionTitle mounted gets a notice instead of a crash.

- /resume <sessionId>: the interactive counterpart to the existing
  `dsh --profile tui --resume <id>` launch flag, reusing the same
  attachSession() the launcher calls. Tears down the live session via a
  new detachSession() helper (extracted from clearSession(), which now
  shares it) before attaching the target id, since pi-tui's alt-screen
  model can't run two live instances at once — there's no cheap way to
  validate an id without attaching. A failed resume (unknown id) falls
  back to a fresh session with an explanatory notice rather than
  leaving the TUI without a live session.

Both take free-text arguments, so they're parsed ahead of the
whitespace-free slash-command matcher, mirroring /plan and /goal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat(tui): show the session title in the prompt box's top border

Right-aligns the session title into the composer's top border, Claude
Code CLI-style (e.g. ───────────────── explore-dir), instead of only
being visible via the OS terminal tab title (OSC 0) or /trajectory.

Only replaces the *plain* unscrolled border (a bare run of ─): pi-tui's
own scroll-up indicator on a multi-line prompt (createScrollBorder,
e.g. ─── ↑ 3 more ─────) is the only affordance for "there's more
above" during active scroll, so it wins over the title whenever both
would want the same row. No title yet, or one too long for the box at
its current width, both leave the border untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat(tui): add a /resume session picker, Claude Code CLI-style

Bare /resume previously showed a "Usage: /resume <sessionId>" notice —
there was no way to see what sessions existed at all short of the exit
banner's "resume with: dsh --profile tui --resume <id>" hint. /resume
<id> is unchanged; bare /resume now opens a picker instead.

The picker lists this cwd's past sessions (ctx.sessionPersistence.list(),
filtered to header.cwd === process.cwd() and header.origin !== 'subagent'
— subagent children belong to /agents, not here), newest first. A header
alone carries no title (that's folded from session/title events, not
stored metadata), so each candidate gets one inspect() to fold its title
via the harness's own foldSessionTitle — a full log read per session,
paid once when the picker opens, same tradeoff loadAgentPresets/
loadSubagents already accept for their own listings. A session that
never got a title (no reply landed) shows as "<id> (untitled)" rather
than being dropped.

Selecting a row calls the same resumeSession() /resume <id> already
uses. Verified the header/origin filtering and title fold against this
project's own real session store (~/.dsh/sessions), including a session
whose first message literally was "/rename experiment-dsh-tui" — typed
before the /rename command existed, so it became that session's
auto-generated title verbatim; folding it back out confirmed the logic
matches what's actually on disk.

Adds @deepseek-ai/dsh-session-persistence as a new peer+dev dependency,
following the exact version-pin pattern every other harness-seam import
in this package already uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* test(tui): cover the resume picker and title-border logic

Neither had automated tests: index.ts's loadResumeSessions and
CustomEditor's title-border splice have no test-file convention in this
codebase (nothing in index.ts or any Component class does), so their
logic could regress silently.

Split the pure, non-I/O parts out into their own modules — the same
"pure line/data builder next to its Component" pattern trajectory/ already
uses (TrajectoryDetail.ts is tested; TrajectoryOverlay.ts, which owns it,
is not):

- tui/resume/format.ts: formatAge, out of ResumeOverlay.
- tui/resume/select.ts: selectResumeCandidates (the cwd/origin/live-id
  filter + newest-first sort), out of loadResumeSessions.
- tui/titledBorder.ts: isPlainBorder + buildTitledBorder, out of
  CustomEditor.withSessionTitle.

None of this changes behavior — ResumeOverlay, loadResumeSessions, and
CustomEditor now just call the extracted functions instead of inlining
them. What's still untested (ResumeOverlay/CustomEditor's own render/
input orchestration, the sessionPersistence.list()/inspect() I/O) is
the same pi-tui-Component-and-Cordis-service gap already accepted
everywhere else in this codebase, not something this commit tries to
close.

29 new tests: formatAge's time-bucket boundaries (including a fixed
UTC date for the "past a week" fallback, not a live clock), every
selectResumeCandidates filter individually and combined, and
isPlainBorder/buildTitledBorder's padding arithmetic and edge cases
(title exactly fills the width, title too long, pi-tui's own scroll
indicator must not be clobbered).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat(rename): auto-generate title on bare /rename, Claude Code-style

Typing /rename with no argument now runs one on-demand ctx.llm call over
every human message logged so far and commits the result through the
existing sessionTitle.rename() path, instead of just printing a usage
notice. The call only ever fires on an explicit bare /rename — it is not
registered as an automatic ctx.sessionTitle provider (unlike the harness's
own -first-prompt-llm/-all-prompts-llm providers), so no per-message cost
lands on sessions that never touch /rename.

Source-text collection is split into a pure src/tui/titleGeneration.ts
(collectRenameSourceTexts + the fixed system prompt) so it's testable
against plain SessionEvent[] fixtures without a live ctx.llm.

Also sets reasoningEffort: 'off' on the auxiliary call. Verified live
against this deployment's own reasoning model (via direct HTTP to the
vLLM backend) that a reasoning model given a small maxTokens can spend
the entire token budget "thinking" and never emit visible text — observed
at both maxTokens: 64 and maxTokens: 1024. Suppressing reasoning for this
one auxiliary call needed a provider-level compat mapping (declared once,
in this deployment's own local-vllm model config, not in this repo):
compat.thinkingFormat: qwen-chat-template + compat.chatTemplateKwargs
mapping enable_thinking to the request's reasoningEffort, per the
harness's own llm-pi-ai catalog test fixtures.

* fix(rename): generate kebab-case slugs, Claude Code CLI-style

The harness's own reference title provider (dsh-session-title-llm)
deliberately asks for "plain text of natural language" — but this
feature is explicitly modeled on Claude Code CLI's /rename, which
produces a kebab-case slug (e.g. merge-agents-resume-overlays), not a
natural-language sentence. Live-tested output confirmed the prompt-only
version wasn't matching that convention.

Adds toKebabCase() as a deterministic post-process, applied
unconditionally rather than trusted to the prompt alone: this call runs
against a small local model with no guarantee it follows formatting
instructions exactly (stray punctuation, title case, an explanatory
sentence). Lowercases, splits on any run of non-letter/non-digit
characters (Unicode-aware, so non-Latin scripts still produce a
reasonable slug instead of an empty string), drops empty pieces, and
caps at 5 words.

11 new tests covering the punctuation/apostrophe/whitespace collapsing,
the word-count cap, idempotence on already-kebab input, and the
non-Latin-script edge case.

* docs(tui): document /rename, /resume, and the title border

Review comment on this PR: several user-visible features (both /rename
forms, both /resume forms, the composer's title-border display) and
their architecture were missing from README.md/AGENTS.md, per this
repo's own "Keep docs in sync" rule.

README.md: Features bullets for session rename (including the bare-form
kebab-case auto-title and the title-border display) and session resume
(including the bare-form picker); terminal-commands table rows for
/rename [title] and /resume [sessionId]; a keyboard-shortcuts row for
the resume picker's own ↑/↓/Enter/Esc/q bindings, which weren't
documented anywhere.

AGENTS.md: an architecture note covering the /rename//resume
parse-ahead command shape, why renaming needs no new harness package,
the bare-/rename on-demand title generation (including the
reasoningEffort/kebab-case design decisions behind it), the
detachSession/resumeSession split, and the resume picker's candidate
selection/title-folding; a second note for the titled-border splice in
CustomEditor. Folded both new commands into the "Current status"
summary line too.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---------

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
-  feat(tui): add a docked subagent switcher, Claude Code CLI-style (#4)

* feat(tui): add /rename and /resume commands

Both harness capabilities already existed but had no TUI entry point:

- /rename <title>: calls ctx.sessionTitle.rename() directly (the same
  service the Web UI's session.rename RPC wraps) — no new harness code
  needed, since dsh-tui is an in-process Cordis plugin with native
  service access, not a remote client like the browser. Follows the
  optional-service pattern used by compact/plan/goal: a profile without
  sessionTitle mounted gets a notice instead of a crash.

- /resume <sessionId>: the interactive counterpart to the existing
  `dsh --profile tui --resume <id>` launch flag, reusing the same
  attachSession() the launcher calls. Tears down the live session via a
  new detachSession() helper (extracted from clearSession(), which now
  shares it) before attaching the target id, since pi-tui's alt-screen
  model can't run two live instances at once — there's no cheap way to
  validate an id without attaching. A failed resume (unknown id) falls
  back to a fresh session with an explanatory notice rather than
  leaving the TUI without a live session.

Both take free-text arguments, so they're parsed ahead of the
whitespace-free slash-command matcher, mirroring /plan and /goal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat(tui): show the session title in the prompt box's top border

Right-aligns the session title into the composer's top border, Claude
Code CLI-style (e.g. ───────────────── explore-dir), instead of only
being visible via the OS terminal tab title (OSC 0) or /trajectory.

Only replaces the *plain* unscrolled border (a bare run of ─): pi-tui's
own scroll-up indicator on a multi-line prompt (createScrollBorder,
e.g. ─── ↑ 3 more ─────) is the only affordance for "there's more
above" during active scroll, so it wins over the title whenever both
would want the same row. No title yet, or one too long for the box at
its current width, both leave the border untouched.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat(tui): add a /resume session picker, Claude Code CLI-style

Bare /resume previously showed a "Usage: /resume <sessionId>" notice —
there was no way to see what sessions existed at all short of the exit
banner's "resume with: dsh --profile tui --resume <id>" hint. /resume
<id> is unchanged; bare /resume now opens a picker instead.

The picker lists this cwd's past sessions (ctx.sessionPersistence.list(),
filtered to header.cwd === process.cwd() and header.origin !== 'subagent'
— subagent children belong to /agents, not here), newest first. A header
alone carries no title (that's folded from session/title events, not
stored metadata), so each candidate gets one inspect() to fold its title
via the harness's own foldSessionTitle — a full log read per session,
paid once when the picker opens, same tradeoff loadAgentPresets/
loadSubagents already accept for their own listings. A session that
never got a title (no reply landed) shows as "<id> (untitled)" rather
than being dropped.

Selecting a row calls the same resumeSession() /resume <id> already
uses. Verified the header/origin filtering and title fold against this
project's own real session store (~/.dsh/sessions), including a session
whose first message literally was "/rename experiment-dsh-tui" — typed
before the /rename command existed, so it became that session's
auto-generated title verbatim; folding it back out confirmed the logic
matches what's actually on disk.

Adds @deepseek-ai/dsh-session-persistence as a new peer+dev dependency,
following the exact version-pin pattern every other harness-seam import
in this package already uses.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* test(tui): cover the resume picker and title-border logic

Neither had automated tests: index.ts's loadResumeSessions and
CustomEditor's title-border splice have no test-file convention in this
codebase (nothing in index.ts or any Component class does), so their
logic could regress silently.

Split the pure, non-I/O parts out into their own modules — the same
"pure line/data builder next to its Component" pattern trajectory/ already
uses (TrajectoryDetail.ts is tested; TrajectoryOverlay.ts, which owns it,
is not):

- tui/resume/format.ts: formatAge, out of ResumeOverlay.
- tui/resume/select.ts: selectResumeCandidates (the cwd/origin/live-id
  filter + newest-first sort), out of loadResumeSessions.
- tui/titledBorder.ts: isPlainBorder + buildTitledBorder, out of
  CustomEditor.withSessionTitle.

None of this changes behavior — ResumeOverlay, loadResumeSessions, and
CustomEditor now just call the extracted functions instead of inlining
them. What's still untested (ResumeOverlay/CustomEditor's own render/
input orchestration, the sessionPersistence.list()/inspect() I/O) is
the same pi-tui-Component-and-Cordis-service gap already accepted
everywhere else in this codebase, not something this commit tries to
close.

29 new tests: formatAge's time-bucket boundaries (including a fixed
UTC date for the "past a week" fallback, not a live clock), every
selectResumeCandidates filter individually and combined, and
isPlainBorder/buildTitledBorder's padding arithmetic and edge cases
(title exactly fills the width, title too long, pi-tui's own scroll
indicator must not be clobbered).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat(rename): auto-generate title on bare /rename, Claude Code-style

Typing /rename with no argument now runs one on-demand ctx.llm call over
every human message logged so far and commits the result through the
existing sessionTitle.rename() path, instead of just printing a usage
notice. The call only ever fires on an explicit bare /rename — it is not
registered as an automatic ctx.sessionTitle provider (unlike the harness's
own -first-prompt-llm/-all-prompts-llm providers), so no per-message cost
lands on sessions that never touch /rename.

Source-text collection is split into a pure src/tui/titleGeneration.ts
(collectRenameSourceTexts + the fixed system prompt) so it's testable
against plain SessionEvent[] fixtures without a live ctx.llm.

Also sets reasoningEffort: 'off' on the auxiliary call. Verified live
against this deployment's own reasoning model (via direct HTTP to the
vLLM backend) that a reasoning model given a small maxTokens can spend
the entire token budget "thinking" and never emit visible text — observed
at both maxTokens: 64 and maxTokens: 1024. Suppressing reasoning for this
one auxiliary call needed a provider-level compat mapping (declared once,
in this deployment's own local-vllm model config, not in this repo):
compat.thinkingFormat: qwen-chat-template + compat.chatTemplateKwargs
mapping enable_thinking to the request's reasoningEffort, per the
harness's own llm-pi-ai catalog test fixtures.

* fix(rename): generate kebab-case slugs, Claude Code CLI-style

The harness's own reference title provider (dsh-session-title-llm)
deliberately asks for "plain text of natural language" — but this
feature is explicitly modeled on Claude Code CLI's /rename, which
produces a kebab-case slug (e.g. merge-agents-resume-overlays), not a
natural-language sentence. Live-tested output confirmed the prompt-only
version wasn't matching that convention.

Adds toKebabCase() as a deterministic post-process, applied
unconditionally rather than trusted to the prompt alone: this call runs
against a small local model with no guarantee it follows formatting
instructions exactly (stray punctuation, title case, an explanatory
sentence). Lowercases, splits on any run of non-letter/non-digit
characters (Unicode-aware, so non-Latin scripts still produce a
reasonable slug instead of an empty string), drops empty pieces, and
caps at 5 words.

11 new tests covering the punctuation/apostrophe/whitespace collapsing,
the word-count cap, idempotence on already-kebab input, and the
non-Latin-script edge case.

* feat(tui): add a docked subagent switcher, Claude Code CLI-style

Subagents were invisible from the TUI — the harness runs them in the
background but dsh-tui had no way to see what one was doing or switch
to watching it.

A solid/hollow-circle strip docks directly below the composer whenever
at least one subagent in the current batch is running (an ephemeral
indicator, not a permanent log — it disappears once the whole batch
settles, matching Claude Code CLI's own background-task row). Left/Right
switch which transcript the primary scroll region shows — main, or any
child, latest-spawned first — without hiding the composer or the strip
itself: viewing a child is a separate TuiState.viewingChild field a new
TranscriptArea component reacts to, not a tui.showOverlay(...) panel like
every other overlay in this app, so the composer and strip stay live and
focused the whole time. Escape returns to main. Both bindings are gated
to an empty prompt, so they take nothing away from normal editing.

With more than 4 children in a batch, a dim `<N`/`N>` count marks
whatever the visible window (main + 4) doesn't fit, and the window
slides to keep whichever child is currently open inside it as the reader
cycles — nothing becomes unreachable, it just isn't all on screen at
once.

A viewed child streams further events live while it's still running
(ctx.sessions.get + a session/event subscription, the same mechanism
the main transcript itself uses) via ctx.sessions — already a hard
dependency of this plugin — and falls back to ctx.sessionPersistence.inspect
once it's finished or already gone from the live registry. A child's id
is a bare id with no session- prefix (verified against both the live
sessions registry and the on-disk persisted directory), unlike a
top-level session id, so it's looked up as-is.

Tests: detailLines.test.ts covers the per-child tool-call lookup and the
event-log-to-lines projection (10 cases); liveText.test.ts covers the
strip's visibility gate, ordering, solid/hollow marking, and the sliding
window (18 cases).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* fix(tui): keep the strip up while its own viewed child finishes

Live-testing turned up a real dead end: watch a subagent, let it finish
while you're looking at it, and the strip — Escape/arrow hint included —
vanishes out from under you. The Escape/Left/Right bindings still work
(they only ever check TuiState.viewingChild, never the strip's own
visibility), but with the hint gone there's no way to discover that, so
it reads as being stuck.

buildAgentsStripText's visibility gate was "at least one child running"
only. Now also stays up whenever a child's transcript is the one
currently open, regardless of whether it (or anything else) is still
running — the ephemeral-indicator behavior only applies to the reader
already back at main with nothing in flight, never to someone mid-
navigation away from it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* fix(tui): guard subagent-view races and unreachable navigation

Code review on this PR found two real bugs in the docked subagent
switcher:

- loadAgentDetail's sessionPersistence.inspect() path is awaited with no
  cancellation. Cycling Right twice fast enough between two finished
  subagents — the first (slower) request resolving after the second
  (faster) one — let child A's transcript silently overwrite child B's
  while the header still read "Subagent — B". Both the success and
  error branches now check store.getSnapshot().viewingChild?.childId
  still matches the request's childId before applying the result,
  discarding a stale response instead.

- cycleAgentsStrip only guarded on "are there any children at all," not
  on whether the strip was actually showing any of them — so Right at
  an empty prompt could jump to a finished child from a fully-settled
  batch the strip itself would never display, contradicting the
  feature's own ephemeral-indicator design. Extracted the visibility
  rule buildAgentsStripText already computed into an exported
  agentsStripIsVisible(), and cycleAgentsStrip now refuses to navigate
  when it says there's nothing to offer — the same predicate for both,
  so they can't drift apart like this again.

5 new tests for agentsStripIsVisible (370 total).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* fix(tui): word-wrap a viewed subagent's transcript

Code review on this PR: TranscriptArea's viewingChild branch pushed
buildAgentDetailLines's raw strings straight into the rendered output
with no wrapping, unlike the main transcript (Text/createTranscriptLine)
or /trajectory's detail pane (wrapTextWithAnsi) — a long line in a
subagent's transcript overflowed the terminal edge.

Routes the assembled lines through padTranscriptText, the same wrapping
the other rebuilt-every-render live-region rows (streamingText,
pendingToolCallsText, shellRunLiveText) already use; it also applies the
same left/right margin the main transcript renders with, so switching
between the two doesn't visibly shift the content column.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* docs(tui): document the docked subagent switcher

Review comment on this PR: neither README.md's Features/keyboard-
shortcuts tables nor AGENTS.md's architecture/status notes mentioned
the docked subagent switcher or its Left/Right/Escape bindings, despite
AGENTS.md's own "Keep docs in sync" section requiring this in the same
commit.

README.md: a Features bullet covering the strip's visibility rule, the
sliding window, and the Left/Right/Escape bindings; keyboard-shortcuts
rows for the same bindings.

AGENTS.md: an architecture note on why viewing a child is a plain
TuiState field and a TranscriptArea component rather than a
tui.showOverlay(...) panel (so the composer and strip stay live), and a
second note on the strip's visibility/windowing rules and how the
roster is kept live off the main session's own tool/call/tool/result
events. Folded the switcher into the "Current status" summary line too.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

* feat(tui): mark a running subagent with a spinner, not the circle

Follow-up design pass on the strip: an earlier proposal to encode "live"
by swapping the circle glyph itself (e.g. a fisheye/bullseye variant)
would have confounded it with the circle's existing job — marking which
session is currently selected. Keeping the two conflated would make
"selected and running," "selected and finished," "unselected and
running," and "unselected and finished" impossible to tell apart without
four distinct glyphs.

Instead: the solid/hollow circle keeps meaning exactly what it always
has (navigation — what you're looking at), and a running child now
additionally carries the shared status-bar Spinner's current frame right
after its own circle (activity — what's still working), regardless of
whether that child is the one selected. buildAgentsStripText takes the
frame as a new third parameter, mirroring how buildStatusBarText/
formatPendingToolCalls already take spinnerChar.

The shared Spinner only ticks while TuiState.status === 'running' (the
main turn) — a subagent can be running while the main agent sits idle
(dispatched, then waiting), which would otherwise freeze the strip's
spinner on a static frame exactly while a child is visibly still
working. Widened the start/stop gate in TuiApp's store-subscribe
callback to also cover any running child in TuiState.agentsStrip.

Also fixed buildAgentsStripText's doc comment, which had been left
orphaned above agentsStripIsVisible by an earlier edit instead of above
its own function.

4 new tests for the spinner (374 total). Folded into the strip's
existing README bullet and AGENTS.md architecture note, keeping both in
sync with this same commit.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

---------

Co-authored-by: Claude Sonnet 5 <noreply@anthropic.com>
Co-authored-by: Tomo Wang <3199140+tomowang@users.noreply.github.com>
- *(startup)* Open the session picker on bare --resume

## [0.7.0] - 2026-08-24

### Chores

- *(repo)* Add GitHub issue templates
- *(deps)* Upgrade @deepseek-ai/dsh-* packages to 0.1.1-rc.2

### Features

- *(tui)* Show a startup hint when a newer version is published
- *(tui)* Set the terminal window title from the session title
- *(tui)* Notify via OSC 9 when waiting on approval or a question

## [0.6.0] - 2026-08-20

### Bug Fixes

- *(tui)* Seed prompt-history recall from persisted history
- *(tui)* Fall back to the call's title, not the tool name, on tool results
- *(tui)* Collapse reasoning to a one-line summary instead of the raw body
- *(tui)* Raise the slash-command/mention dropdown to pi-tui's max height

### Chores

- *(deps)* Upgrade @deepseek-ai/dsh-* packages to 0.1.0-rc.8

### Features

- *(tui)* Add /plan [message] and /plan off commands for plan mode
- *(tui)* Add /goal command support for goal mode

## [0.5.0] - 2026-08-19

### Bug Fixes

- *(tui)* Merge each tool call/result pair into one /tools row
- *(tui)* Give trajectory's detail pane more room, expand tool cards by default

### Documentation

- *(repo)* Define commit scopes and require them going forward

### Features

- *(tui)* Migrate rendering from Ink/React to pi-tui, add full-screen scroll
- *(tui)* Collapse tool calls to one line, show a spinner while pending
- *(tui)* Give /trajectory per-record-kind detail tabs, ported from the web portal
- *(tui)* Show the approve/reject panel inline instead of full-screen
- *(tui)* Pad main-panel messages with a 2-space left/right margin

### Refactor

- *(tui)* Swap transcript's PreStyledText for pi-tui's cached Text

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

