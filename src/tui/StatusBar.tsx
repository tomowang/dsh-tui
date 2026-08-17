/**
 * Persistent one-line status: session identity, model, lifecycle state, and
 * logged event count.
 * @module @tomowang/dsh-tui/tui/StatusBar
 */

import { Text } from 'ink'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { stripSessionIdPrefix } from '../sessionId.js'
import { Spinner } from './Spinner.js'
import { theme } from './theme.js'

export interface StatusBarProps {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly status: AgentStatus
  readonly queuedCount: number
  /** Current agent preset's display label, or `undefined` without a mounted preset service. */
  readonly presetLabel: string | undefined
  /** Number of events logged to `agent.session.events` so far. */
  readonly eventCount: number
}

export function StatusBar({ sessionId, provider, model, status, queuedCount, presetLabel, eventCount }: StatusBarProps) {
  const queuedSuffix = queuedCount > 0 ? ` · ${queuedCount} queued` : ''
  const presetSegment = presetLabel === undefined ? '' : ` · ${presetLabel}`
  return (
    <Text color={theme.muted}>
      session {stripSessionIdPrefix(sessionId)} · <Text color={theme.accent}>{provider}/{model}</Text>
      {presetSegment} · {status === 'running' ? <Spinner /> : null}{' '}
      {status}
      {queuedSuffix} · {eventCount} events
    </Text>
  )
}
