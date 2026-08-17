# dsh-tui color palette

A DeepSeek-branded terminal palette, chosen to fix low-contrast "faint" text
and give the TUI a coherent, on-brand look. Defined once in
[`src/tui/theme.ts`](src/tui/theme.ts) and shared by every Ink component and
the two hand-rolled ANSI formatters ([`src/render.ts`](src/render.ts),
[`src/tui/bannerText.ts`](src/tui/bannerText.ts)).

## Why not ANSI "dim" / 16-color names

Before this palette, muted text used Ink's `dimColor` prop (and, in
`render.ts`/`bannerText.ts`, a hand-rolled `ESC[2m` "faint" wrapper), and a
handful of accents used basic 16-color names (`"red"`, `"yellow"`, `"cyan"`,
`"gray"`). Both rely on the terminal emulator's own rendering of SGR 2/30-37,
which varies a lot — some terminals just lower the alpha on the existing
foreground color, which on certain color profiles renders as barely-legible
gray-on-gray. Every token below is a fixed 24-bit hex value instead, so text
looks the same everywhere.

## Token table

| Token | Name | Hex | Purpose |
| :--- | :--- | :--- | :--- |
| `primary` | DeepSeek Blue | `#4F6BFE` | Brand banner/ASCII, active prompt-input border |
| `secondary` | Electric Cyan | `#38BDF8` | Overlay section headers, question prompts, meter fills |
| `accent` | Slate Indigo | `#818CF8` | Active-model badge in the status bar |
| `reasoning` | Thought Violet | `#A855F7` | Reserved — not yet wired to any component (see below) |
| `success` | Mint Emerald | `#34D399` | Approve choice, active plugin row, workspace-write permission |
| `warning` | Amber Sun | `#FBBF24` | Shell-mode border/marker, approval-request prompt |
| `error` | Coral Red | `#F87171` | Errors, reject choice, failed plugin row, danger-full-access permission |
| `info` | (= `primary`) | `#4F6BFE` | Read-only permission indicator |
| `muted` | Slate Gray | `#94A3B8` | Everything that was `dimColor`/faint before: hints, footers, timestamps, secondary lines |

`info` is a semantic alias of `primary`, not a separate hue — DeepSeek's own
guide uses primary blue for informational UI, so there's no reason to
introduce a tenth color for it.

## What's deliberately not here

The source palette this table is drawn from also specifies panel-background
tokens (`bg-dark`, `surface`, `surface-alt`, `border-dim`) for things like a
header-bar fill or a bordered reasoning panel. This TUI renders to **native
terminal scrollback** via Ink's `<Static>`, not a full-screen alternate
buffer with self-painted panels (see AGENTS.md's "Current status / roadmap"
section) — so there's no header bar or panel to fill, and painting
background colors on scattered `<Text>`/`<Box>` elements inside plain
scrollback would look like stray colored blocks rather than a cohesive
surface. Those tokens are left out rather than force-fit; they're worth
revisiting only if/when this project takes on the full-screen differential
renderer mentioned as a known gap.

## Two rendering paths, one palette

- **Live Ink UI** (status bar, prompt box, `/model`/`/plugins`/`/trajectory`/
  etc. overlays) sets color via Ink's `color` prop, reading `theme.*` hex
  values directly.
- **Settled scrollback** (`src/render.ts`'s `formatEvent`, and
  `src/tui/bannerText.ts`'s startup banner) is built as plain strings with
  embedded ANSI codes, predating and outliving any given Ink render pass —
  it needs to keep working, and look identical, on `--resume` replay before
  Ink even reads the log. Both modules define a local `fg(hex)` helper that
  emits 24-bit truecolor SGR sequences (`ESC[38;2;r;g;bm`) from the same
  `theme.ts` hex constants, so scrollback and the live UI never drift apart.

  `bannerText.ts` in particular builds its banner as one fully-colored
  string (title, dim rows, and the chafa-rendered logo's own embedded RGB
  escapes) *before* Ink ever sees it. `Banner.tsx` renders that string with a
  plain `<Text>` — wrapping it in a second `color` prop would nest an
  Ink/chalk-applied SGR code around a string that already contains its own
  `ESC[0m` resets, which would terminate the outer color partway through the
  first line instead of covering the whole banner.

## `reasoning` is reserved, not decorative

`theme.reasoning` (Thought Violet) has no call site yet. AGENTS.md's roadmap
lists reasoning/`<think>` content as dropped entirely — `textOf()` in
`render.ts` filters `reasoning`/`reasoning-delta` blocks out of both settled
and streaming rendering. The token is defined now so that whichever future
change renders that content (a `<think>` marker, a dimmed reasoning block)
has an on-brand color ready rather than reaching for another ad hoc hex
value.
