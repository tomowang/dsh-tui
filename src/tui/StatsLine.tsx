/**
 * One-line performance strip mirroring the web portal's composer-dock stats
 * line: turn/step counts, LLM/tool wall time, first-token latency, decode
 * throughput, cache hit rate, and billed tokens. Pure presentation over a
 * line already built by `buildStatsLine` — see `../tui/statsFormat`.
 * @module @tomowang/dsh-tui/tui/StatsLine
 */

import { Text } from 'ink'
import { theme } from './theme.js'

export interface StatsLineProps {
  /** Pre-joined display line; empty when there is nothing to show yet. */
  readonly line: string
}

export function StatsLine({ line }: StatsLineProps) {
  if (line === '') return null
  return <Text color={theme.muted}>{line}</Text>
}
