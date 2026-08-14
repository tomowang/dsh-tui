/**
 * Persistent one-line status: session identity, model, and lifecycle state.
 * @module @tomowang/dsh-tui/tui/StatusBar
 */

import { Text } from 'ink'
import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { Spinner } from './Spinner.js'

export interface StatusBarProps {
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly status: AgentStatus
  readonly queuedCount: number
}

export function StatusBar({ sessionId, provider, model, status, queuedCount }: StatusBarProps) {
  const queuedSuffix = queuedCount > 0 ? ` · ${queuedCount} queued` : ''
  return (
    <Text dimColor>
      session {sessionId} · {provider}/{model} · {status === 'running' ? <Spinner /> : null}{' '}
      {status}
      {queuedSuffix}
    </Text>
  )
}
