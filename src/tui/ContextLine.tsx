/**
 * One-line context-window occupancy strip mirroring the web portal's
 * composer-bar ring's percent readout. Pure presentation over a line already
 * built by `buildContextLine` — see `../tui/statsFormat`.
 * @module @tomowang/dsh-tui/tui/ContextLine
 */

import { Text } from 'ink'

export interface ContextLineProps {
  /** Pre-joined display line; empty when there is nothing to show yet. */
  readonly line: string
}

export function ContextLine({ line }: ContextLineProps) {
  if (line === '') return null
  return <Text dimColor>{line}</Text>
}
