/**
 * Persistent one-line status: session identity, model, and lifecycle state.
 * @module @tomowang/dsh-tui/tui/StatusBar
 */

import { Text } from 'ink'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { stripSessionIdPrefix } from '../sessionId.js'
import { Spinner } from './Spinner.js'

export interface StatusBarProps {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly status: AgentStatus
  readonly queuedCount: number
  /** Current agent preset's display label, or `undefined` without a mounted preset service. */
  readonly presetLabel: string | undefined
}

export function StatusBar({ sessionId, provider, model, status, queuedCount, presetLabel }: StatusBarProps) {
  const queuedSuffix = queuedCount > 0 ? ` · ${queuedCount} queued` : ''
  const presetSegment = presetLabel === undefined ? '' : ` · ${presetLabel}`
  return (
    <Text dimColor>
      session {stripSessionIdPrefix(sessionId)} · {provider}/{model}
      {presetSegment} · {status === 'running' ? <Spinner /> : null}{' '}
      {status}
      {queuedSuffix}
    </Text>
  )
}
