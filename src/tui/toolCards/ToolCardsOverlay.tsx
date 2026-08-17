/**
 * Mutable inspector for tool cards. The main transcript intentionally uses
 * Ink's append-only `<Static>` for native terminal scrollback, which means a
 * historical card cannot safely be redrawn in place. This overlay provides
 * the missing expand/collapse affordance without changing that contract:
 * a selected card expands into a scrollable window over its full,
 * uncapped presentation (`formatToolCardDetail`), rather than the
 * transcript's fixed 20-line-then-omit cap.
 * @module @tomowang/dsh-tui/tui/toolCards/ToolCardsOverlay
 */

import { useEffect, useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatToolCardDetail, formatToolCardSummary, type RenderOptions } from '../../render.js'
import type { TuiActions } from '../PromptInput.js'
import { theme } from '../theme.js'

export interface ToolCardsOverlayProps {
  readonly events: readonly SessionEvent[]
  readonly availableRows: number
  readonly actions: TuiActions
  readonly getTool: RenderOptions['getTool']
  readonly getToolCall: RenderOptions['getToolCall']
}

function isToolEvent(event: SessionEvent): boolean {
  return event.type === 'tool/call' || event.type === 'tool/result'
}

/**
 * Tool-card browser. ↑↓ selects a card; Enter/Space expands or collapses it.
 * An expanded card scrolls its own full body (↑↓/PageUp/PageDown/Home/End)
 * within the panel's available height, rather than the transcript's cap.
 */
export function ToolCardsOverlay({ events, availableRows, actions, getTool, getToolCall }: ToolCardsOverlayProps) {
  const cards = useMemo(() => events.filter(isToolEvent), [events])
  const [selected, setSelected] = useState(() => Math.max(0, cards.length - 1))
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set())
  const [scrollOffset, setScrollOffset] = useState(0)
  const index = cards.length === 0 ? 0 : Math.min(selected, cards.length - 1)
  const event = cards[index]
  const open = event !== undefined && expanded.has(event.seq)

  // Header, position/scroll line, blank separator, and footer leave the
  // rest for card content.
  const chrome = 4
  const contentRows = Math.max(1, availableRows - chrome)

  const summary = event === undefined ? undefined : formatToolCardSummary(event, { replay: false, getTool, getToolCall })
  const detailLines = useMemo(
    () => (event === undefined || !open ? undefined : formatToolCardDetail(event, { replay: false, getTool, getToolCall })),
    [event, open, getTool, getToolCall],
  )

  // A newly selected or newly opened card always starts scrolled to its top.
  useEffect(() => {
    setScrollOffset(0)
  }, [event?.seq, open])

  const totalDetailLines = detailLines?.length ?? 0
  const maxScrollOffset = Math.max(0, totalDetailLines - contentRows)
  const clampedOffset = Math.min(scrollOffset, maxScrollOffset)
  const visibleDetailLines = detailLines?.slice(clampedOffset, clampedOffset + contentRows)

  function move(delta: number): void {
    if (cards.length === 0) return
    setSelected(current => Math.max(0, Math.min(cards.length - 1, current + delta)))
  }

  function scroll(delta: number): void {
    setScrollOffset(current => Math.max(0, Math.min(maxScrollOffset, current + delta)))
  }

  function toggle(): void {
    if (event === undefined) return
    setExpanded(current => {
      const next = new Set(current)
      if (next.has(event.seq)) next.delete(event.seq)
      else next.add(event.seq)
      return next
    })
  }

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'o') || input === 'q') {
      actions.closeToolCards()
      return
    }
    if (open) {
      if (key.pageUp) return scroll(-contentRows)
      if (key.pageDown) return scroll(contentRows)
      if (key.home) return scroll(-maxScrollOffset)
      if (key.end) return scroll(maxScrollOffset)
      if (key.upArrow || (key.ctrl && input === 'p')) return scroll(-1)
      if (key.downArrow || (key.ctrl && input === 'n')) return scroll(1)
      if (key.return || input === ' ' || key.leftArrow) return toggle()
      return
    }
    if (key.upArrow || (key.ctrl && input === 'p')) {
      move(-1)
      return
    }
    if (key.downArrow || (key.ctrl && input === 'n')) {
      move(1)
      return
    }
    if (key.return || input === ' ' || key.rightArrow) toggle()
  })

  const scrollHint =
    totalDetailLines <= contentRows
      ? ''
      : ` · lines ${clampedOffset + 1}-${Math.min(totalDetailLines, clampedOffset + contentRows)} of ${totalDetailLines}`

  return (
    <Box flexDirection="column">
      <Text bold color={theme.secondary}>
        Tool Cards{cards.length === 0 ? '' : ` (${index + 1}/${cards.length})`}
        {open ? scrollHint : ''}
      </Text>
      {event === undefined ? (
        <Text color={theme.muted}>No tool cards in this session yet.</Text>
      ) : open ? (
        <Text>{(visibleDetailLines ?? []).join('\n')}</Text>
      ) : (
        <Text>{`▸ ${summary ?? ''}`}</Text>
      )}
      <Box height={1} />
      <Text color={theme.muted}>
        {open ? '↑↓ scroll · PgUp/PgDn/Home/End · Enter/Space/← collapse' : '↑↓ select · Enter/Space/→ expand'} · Ctrl+O/Esc close
      </Text>
    </Box>
  )
}
