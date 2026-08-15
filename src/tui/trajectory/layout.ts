/**
 * Pure fold of the durable session log into the `/trajectory` ledger's rows —
 * turn/step boundaries, one row per user/assistant message, tool calls paired
 * with their result by `callId`, and request-header changes. No Ink/React
 * dependency, so this is unit-testable directly against a `SessionEvent[]`
 * fixture.
 * @module @tomowang/dsh-tui/tui/trajectory/layout
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { textOf, truncate } from '../../render.js'
import type { TrajectoryRecordKind, TrajectoryRow } from './types.js'

const LABEL_LIMIT = 100

/** Mutable working copy of `TrajectoryRecord`; a plain (non-readonly) object structurally satisfies the readonly type at push time. */
interface RecordDraft {
  id: string
  kind: TrajectoryRecordKind
  turn: number
  step: number
  seq: number
  startedAt: number
  completedAt: number | undefined
  label: string
  isError: boolean
  summary: string
  payload: string | undefined
  result: string | undefined
}

interface TurnRowDraft {
  kind: 'turn'
  turn: number
  aborted: string | undefined
}

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2)
  } catch {
    return raw
  }
}

function userLabel(data: SessionEvent<'user/message'>['data']): string {
  const { source } = data
  if (source.kind === 'user') return `you › ${truncate(textOf(data.content), LABEL_LIMIT)}`
  if (source.kind === 'plugin') {
    const summary = source.form === 'notice' ? source.summary : undefined
    return `context › ${source.plugin}${summary === undefined ? '' : ` · ${summary}`}`
  }
  return `context › ${source.kind}`
}

/**
 * Fold the session log into ledger rows, in seq order.
 * @param events - the session's durable event log (replay + live, already seq-deduped by `TuiStore`).
 * @param collapsedTurns - turns whose non-first content row should fold into one `'collapsed'` summary row.
 */
export function buildTrajectoryRows(
  events: readonly SessionEvent[],
  collapsedTurns: ReadonlySet<number>,
): readonly TrajectoryRow[] {
  const rows: TrajectoryRow[] = []
  const stepsByTurn = new Map<number, Set<number>>()
  const pendingCalls = new Map<string, RecordDraft>()
  const openTurnRows = new Map<number, TurnRowDraft>()
  let currentTurn = 0
  let currentStep = 0

  for (const event of events) {
    switch (event.type) {
      case 'turn/start': {
        currentTurn = event.data.turn
        const draft: TurnRowDraft = { kind: 'turn', turn: currentTurn, aborted: undefined }
        openTurnRows.set(currentTurn, draft)
        rows.push(draft)
        break
      }
      case 'turn/end': {
        const draft = openTurnRows.get(event.data.turn)
        const { reason } = event.data
        if (draft !== undefined && reason.kind === 'error') {
          draft.aborted = `${reason.error.code}: ${reason.error.message}`
        } else if (draft !== undefined && reason.kind === 'aborted') {
          draft.aborted = 'turn canceled'
        }
        break
      }
      case 'step/start': {
        currentStep = event.data.step
        let steps = stepsByTurn.get(event.data.turn)
        if (steps === undefined) {
          steps = new Set()
          stepsByTurn.set(event.data.turn, steps)
        }
        steps.add(event.data.step)
        rows.push({ kind: 'step', turn: event.data.turn, step: event.data.step })
        break
      }
      case 'user/message': {
        const label = userLabel(event.data)
        const text = textOf(event.data.content)
        const record: RecordDraft = {
          id: `${event.seq}`,
          kind: 'user',
          turn: currentTurn,
          step: currentStep,
          seq: event.seq,
          startedAt: event.time,
          completedAt: undefined,
          label,
          isError: false,
          summary: label,
          payload: text === '' ? undefined : text,
          result: undefined,
        }
        rows.push({ kind: 'record', record })
        break
      }
      case 'assistant/message': {
        const text = textOf(event.data.message.content)
        const label = text === '' ? '(tool calls only)' : truncate(text, LABEL_LIMIT)
        const record: RecordDraft = {
          id: `${event.seq}`,
          kind: 'assistant',
          turn: event.data.turn,
          step: event.data.step,
          seq: event.seq,
          startedAt: event.time,
          completedAt: undefined,
          label,
          isError: false,
          summary: label,
          payload: text === '' ? undefined : text,
          result: undefined,
        }
        rows.push({ kind: 'record', record })
        break
      }
      case 'tool/call': {
        const label = `${event.data.name} ${truncate(event.data.arguments, LABEL_LIMIT)}`
        const record: RecordDraft = {
          id: event.data.callId,
          kind: 'tool',
          turn: event.data.turn,
          step: event.data.step,
          seq: event.seq,
          startedAt: event.time,
          completedAt: undefined,
          label,
          isError: false,
          summary: label,
          payload: prettyJson(event.data.arguments),
          result: undefined,
        }
        pendingCalls.set(event.data.callId, record)
        rows.push({ kind: 'record', record })
        break
      }
      case 'tool/result': {
        const [block] = event.data.message.content
        const failed = event.data.error !== undefined || block.isError === true
        const resultText = event.data.error !== undefined
          ? `${event.data.error.code}: ${event.data.error.name}`
          : textOf(block.content)
        const callId = event.data.message.source.callId
        const pending = pendingCalls.get(callId)
        if (pending !== undefined) {
          pending.completedAt = event.time
          pending.isError = failed
          pending.result = resultText
          pending.summary = `${pending.label} → ${failed ? 'error' : 'ok'}`
          pendingCalls.delete(callId)
        } else {
          // A result with no matching call in this window (e.g. replay truncation) still gets a row.
          const label = `(unmatched result) ${truncate(resultText, LABEL_LIMIT)}`
          const record: RecordDraft = {
            id: `${event.seq}`,
            kind: 'tool',
            turn: event.data.turn,
            step: event.data.step,
            seq: event.seq,
            startedAt: event.time,
            completedAt: event.time,
            label,
            isError: failed,
            summary: label,
            payload: undefined,
            result: resultText,
          }
          rows.push({ kind: 'record', record })
        }
        break
      }
      case 'request/header': {
        if (event.data.reason === 'initial') break
        const label = `config ${event.data.reason} updated`
        const record: RecordDraft = {
          id: `${event.seq}`,
          kind: 'header',
          turn: currentTurn,
          step: currentStep,
          seq: event.seq,
          startedAt: event.time,
          completedAt: undefined,
          label,
          isError: false,
          summary: label,
          payload: JSON.stringify(event.data.header, null, 2),
          result: undefined,
        }
        rows.push({ kind: 'record', record })
        break
      }
      default:
        break
    }
  }

  const filtered = rows.filter(row => row.kind !== 'step' || (stepsByTurn.get(row.turn)?.size ?? 0) > 1)
  return collapseRows(filtered, collapsedTurns)
}

/** Fold every row of a collapsed turn after its first content row into one summary row. */
function collapseRows(rows: readonly TrajectoryRow[], collapsedTurns: ReadonlySet<number>): readonly TrajectoryRow[] {
  if (collapsedTurns.size === 0) return rows
  const out: TrajectoryRow[] = []
  let seenFirstInTurn = false
  let pendingCount = 0
  let pendingTurn = -1

  const flush = () => {
    if (pendingCount > 0) {
      out.push({ kind: 'collapsed', turn: pendingTurn, count: pendingCount })
      pendingCount = 0
    }
  }

  for (const row of rows) {
    if (row.kind === 'turn') {
      flush()
      seenFirstInTurn = false
      pendingTurn = row.turn
      out.push(row)
      continue
    }
    const turn = row.kind === 'step' ? row.turn : row.kind === 'record' ? row.record.turn : pendingTurn
    if (!collapsedTurns.has(turn)) {
      out.push(row)
      continue
    }
    if (!seenFirstInTurn) {
      seenFirstInTurn = true
      out.push(row)
      continue
    }
    pendingCount += 1
  }
  flush()
  return out
}
