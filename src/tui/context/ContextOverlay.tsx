/**
 * `/context` overlay: a static panel showing context-window occupancy and its
 * System prompt / Tools / Messages composition, mirroring the web portal's
 * composer-bar ring's expanded panel. Unlike `TrajectoryOverlay` this has no
 * scrolling or selection state — it's a fixed read of `state.stats`, so the
 * only local behavior is Esc/`q` closing it.
 * @module @tomowang/dsh-tui/tui/context/ContextOverlay
 */

import { Box, Text, useInput } from 'ink'
import type { ContextBreakdownProjection, ContextPressureProjection } from '@deepseek-ai/dsh-token-meter'
import type { TuiActions } from '../PromptInput.js'
import { contextBreakdownRows, contextOccupancy, formatTokens } from '../statsFormat.js'
import { theme } from '../theme.js'

export interface ContextOverlayProps {
  readonly pressure: ContextPressureProjection | undefined
  readonly breakdown: ContextBreakdownProjection | undefined
  readonly actions: TuiActions
}

const BAR_WIDTH = 30

function bar(widthPercent: number): string {
  const filled = Math.round((widthPercent / 100) * BAR_WIDTH)
  return '█'.repeat(Math.max(0, Math.min(BAR_WIDTH, filled))).padEnd(BAR_WIDTH, '░')
}

export function ContextOverlay({ pressure, breakdown, actions }: ContextOverlayProps) {
  useInput((input, key) => {
    if (key.escape || input === 'q') actions.closeContext()
  })

  const occupancy = contextOccupancy(pressure)
  const rows = contextBreakdownRows(occupancy, breakdown)

  return (
    <Box flexDirection="column">
      <Text bold color={theme.secondary}>Context usage</Text>
      {occupancy === null ? (
        <Text color={theme.muted}>No usage reported yet — send a message first.</Text>
      ) : (
        <>
          <Text>
            {occupancy.percent}% of context used
          </Text>
          <Text color={theme.muted}>
            ~{formatTokens(occupancy.usedTokens)} / {formatTokens(occupancy.contextWindow)}
          </Text>
          <Box height={1} />
          {rows.length === 0 ? (
            <Text color={theme.muted}>No composition breakdown yet.</Text>
          ) : (
            rows.map(row => (
              <Box key={row.label}>
                <Text>{row.label.padEnd(14)} </Text>
                <Text color={theme.secondary}>{bar(row.width)} </Text>
                <Text>{formatTokens(row.tokens)}</Text>
              </Box>
            ))
          )}
        </>
      )}
      <Box height={1} />
      <Text color={theme.muted}>esc close</Text>
    </Box>
  )
}
