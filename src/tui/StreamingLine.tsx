/**
 * Live-region mirror of `EventLine` for the step that is still generating.
 * Renders in the mutable area below `<Static>`, since `assistant/chunk`
 * events fold into `TuiState.streaming` rather than `TuiState.events` — the
 * text grows in place here until the settled `assistant/message` event
 * clears it and the same text lands permanently in `<Static>`.
 * @module @tomowang/dsh-tui/tui/StreamingLine
 */

import { Text } from 'ink'
import { formatStreamingText } from '../render.js'
import type { StreamingState } from './store.js'

export interface StreamingLineProps {
  readonly streaming: StreamingState | undefined
}

export function StreamingLine({ streaming }: StreamingLineProps) {
  if (streaming === undefined) return null
  const line = formatStreamingText(streaming.text)
  if (line === undefined) return null
  return <Text>{line}</Text>
}
