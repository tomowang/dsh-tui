/**
 * Mutable inspector for tool cards, opened by Ctrl+O/`/tools`: a selected
 * card expands into a scrollable window over its full, uncapped
 * presentation (`formatToolCardDetail`), rather than the transcript's fixed
 * 20-line-then-omit cap.
 * @module @tomowang/dsh-tui/tui/toolCards/ToolCardsOverlay
 */

import type { Component, TUI } from '@earendil-works/pi-tui'
import { Key, matchesKey } from '@earendil-works/pi-tui'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatToolCardDetail, formatToolCardSummary, type RenderOptions } from '../../render.js'
import type { TuiActions } from '../actions.js'
import type { TuiStore } from '../store.js'
import { theme, fg } from '../theme.js'

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`
const secondary = fg(theme.secondary)
const muted = fg(theme.muted)

function isToolEvent(event: SessionEvent): boolean {
  return event.type === 'tool/call' || event.type === 'tool/result'
}

export class ToolCardsOverlay implements Component {
  private selected: number | undefined
  private readonly expanded = new Set<number>()
  private scrollOffset = 0
  private lastEventSeq: number | undefined
  private lastOpen = false

  constructor(
    private readonly tui: TUI,
    private readonly store: TuiStore,
    private readonly actions: TuiActions,
    private readonly getTool: RenderOptions['getTool'],
    private readonly getToolCall: RenderOptions['getToolCall'],
  ) {}

  invalidate(): void {}

  private cards(): SessionEvent[] {
    return this.store.getSnapshot().events.filter(isToolEvent)
  }

  private contentRows(): number {
    const availableRows = Math.max(6, Math.min(this.tui.terminal.rows - 1, 24))
    const chrome = 4 // header, position/scroll line, blank separator, footer
    return Math.max(1, availableRows - chrome)
  }

  render(_width: number): string[] {
    const cards = this.cards()
    const index = cards.length === 0 ? 0 : Math.min(this.selected ?? cards.length - 1, cards.length - 1)
    const event = cards[index]
    const open = event !== undefined && this.expanded.has(event.seq)

    // A newly selected or newly opened card always starts scrolled to its top.
    if (event?.seq !== this.lastEventSeq || open !== this.lastOpen) {
      this.scrollOffset = 0
      this.lastEventSeq = event?.seq
      this.lastOpen = open
    }

    const contentRows = this.contentRows()
    const summary = event === undefined ? undefined : formatToolCardSummary(event, { replay: false, getTool: this.getTool, getToolCall: this.getToolCall })
    const detailLines = event === undefined || !open ? undefined : formatToolCardDetail(event, { replay: false, getTool: this.getTool, getToolCall: this.getToolCall })
    const totalDetailLines = detailLines?.length ?? 0
    const maxScrollOffset = Math.max(0, totalDetailLines - contentRows)
    const clampedOffset = Math.min(this.scrollOffset, maxScrollOffset)
    const visibleDetailLines = detailLines?.slice(clampedOffset, clampedOffset + contentRows)

    const scrollHint =
      totalDetailLines <= contentRows
        ? ''
        : ` · lines ${clampedOffset + 1}-${Math.min(totalDetailLines, clampedOffset + contentRows)} of ${totalDetailLines}`

    const lines: string[] = [
      bold(secondary(`Tool Cards${cards.length === 0 ? '' : ` (${index + 1}/${cards.length})`}${open ? scrollHint : ''}`)),
    ]
    if (event === undefined) {
      lines.push(muted('No tool cards in this session yet.'))
    } else if (open) {
      lines.push(...(visibleDetailLines ?? []))
    } else {
      lines.push(`▸ ${summary ?? ''}`)
    }
    lines.push('')
    lines.push(
      muted(
        `${open ? '↑↓ scroll · PgUp/PgDn/Home/End · Enter/Space/← collapse' : '↑↓ select · Enter/Space/→ expand'} · Ctrl+O/Esc close`,
      ),
    )
    return lines
  }

  private move(delta: number): void {
    const cards = this.cards()
    if (cards.length === 0) return
    const current = this.selected ?? cards.length - 1
    this.selected = Math.max(0, Math.min(cards.length - 1, current + delta))
  }

  private scroll(delta: number, maxScrollOffset: number): void {
    this.scrollOffset = Math.max(0, Math.min(maxScrollOffset, this.scrollOffset + delta))
  }

  private toggle(): void {
    const cards = this.cards()
    const index = cards.length === 0 ? 0 : Math.min(this.selected ?? cards.length - 1, cards.length - 1)
    const event = cards[index]
    if (event === undefined) return
    if (this.expanded.has(event.seq)) this.expanded.delete(event.seq)
    else this.expanded.add(event.seq)
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl('o')) || data === 'q') {
      this.actions.closeToolCards()
      return
    }
    const cards = this.cards()
    const index = cards.length === 0 ? 0 : Math.min(this.selected ?? cards.length - 1, cards.length - 1)
    const event = cards[index]
    const open = event !== undefined && this.expanded.has(event.seq)
    const contentRows = this.contentRows()
    const detailLines = event === undefined || !open ? undefined : formatToolCardDetail(event, { replay: false, getTool: this.getTool, getToolCall: this.getToolCall })
    const maxScrollOffset = Math.max(0, (detailLines?.length ?? 0) - contentRows)

    if (open) {
      if (matchesKey(data, Key.pageUp)) return this.scroll(-contentRows, maxScrollOffset)
      if (matchesKey(data, Key.pageDown)) return this.scroll(contentRows, maxScrollOffset)
      if (matchesKey(data, Key.home)) return this.scroll(-maxScrollOffset, maxScrollOffset)
      if (matchesKey(data, Key.end)) return this.scroll(maxScrollOffset, maxScrollOffset)
      if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) return this.scroll(-1, maxScrollOffset)
      if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) return this.scroll(1, maxScrollOffset)
      if (matchesKey(data, Key.enter) || data === ' ' || matchesKey(data, Key.left)) return this.toggle()
      return
    }
    if (matchesKey(data, Key.up) || matchesKey(data, Key.ctrl('p'))) {
      this.move(-1)
      return
    }
    if (matchesKey(data, Key.down) || matchesKey(data, Key.ctrl('n'))) {
      this.move(1)
      return
    }
    if (matchesKey(data, Key.enter) || data === ' ' || matchesKey(data, Key.right)) this.toggle()
  }
}
