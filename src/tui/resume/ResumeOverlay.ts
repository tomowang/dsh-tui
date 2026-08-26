/**
 * `/resume` picker: the current working directory's past sessions, newest
 * first, each with its folded title when one landed. Cursor lives in the
 * store (`selected`), matching `AgentPresetsOverlay`'s pattern. Loaded once
 * on open (see `loadResumeSessions` in `index.ts`) rather than kept live —
 * the picker is a one-shot action, not a dashboard.
 * @module @tomowang/dsh-tui/tui/resume/ResumeOverlay
 */

import type { Component } from '@earendil-works/pi-tui'
import { Key, matchesKey } from '@earendil-works/pi-tui'
import type { TuiActions } from '../actions.js'
import type { TuiStore } from '../store.js'
import { theme, fg } from '../theme.js'
import { formatAge } from './format.js'

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`
const secondary = fg(theme.secondary)
const muted = fg(theme.muted)
const errorColor = fg(theme.error)
const invert = (s: string): string => `\x1b[7m${s}\x1b[0m`

export class ResumeOverlay implements Component {
  constructor(
    private readonly store: TuiStore,
    private readonly actions: TuiActions,
  ) {}

  invalidate(): void {}

  render(_width: number): string[] {
    const overlay = this.store.getSnapshot().overlay
    if (overlay.kind !== 'resume') return []
    const { rows, selected, busy, error } = overlay.resume
    const now = Date.now()
    const lines: string[] = [bold(secondary('Resume a session'))]
    if (error !== undefined) lines.push(errorColor(error))
    if (busy && rows.length === 0) lines.push(muted('Loading…'))
    rows.forEach((row, index) => {
      const label = row.title ?? muted(`${row.id} (untitled)`)
      const age = muted(formatAge(row.createdAt, now))
      const row0 = `${index === selected ? '› ' : '  '}${label}  ${age}`
      lines.push(index === selected ? invert(row0) : row0)
    })
    if (rows.length === 0 && !busy) lines.push(muted('No past sessions in this directory.'))
    lines.push(muted('↑↓ select · enter resume · esc close'))
    return lines
  }

  handleInput(data: string): void {
    const overlay = this.store.getSnapshot().overlay
    if (overlay.kind !== 'resume') return
    const { rows, selected } = overlay.resume
    if (matchesKey(data, Key.escape) || data === 'q') {
      this.actions.closeResume()
      return
    }
    if (rows.length === 0) return
    if (matchesKey(data, Key.up)) {
      this.actions.selectResumeRow(Math.max(0, selected - 1))
      return
    }
    if (matchesKey(data, Key.down)) {
      this.actions.selectResumeRow(Math.min(rows.length - 1, selected + 1))
      return
    }
    if (matchesKey(data, Key.enter)) {
      const row = rows[selected]
      if (row !== undefined) this.actions.applyResume(row.id)
    }
  }
}
