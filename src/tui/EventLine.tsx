/**
 * One rendered session-log line, or nothing for events the transcript does
 * not present. Delegates all formatting to the pure `formatEvent` so the
 * decision of what a session event looks like stays testable without Ink.
 * @module @tomowang/dsh-tui/tui/EventLine
 */

import { Text } from 'ink'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { formatEvent } from '../render.js'

export interface EventLineProps {
  readonly event: SessionEvent
  /** True when this event was seeded from replay rather than observed live. */
  readonly replay: boolean
}

export function EventLine({ event, replay }: EventLineProps) {
  const line = formatEvent(event, { replay })
  if (line === undefined) return null
  return <Text>{line}</Text>
}
