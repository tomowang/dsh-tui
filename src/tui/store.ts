/**
 * Plain, dependency-free projection of Cordis/session events into a single
 * immutable snapshot that React components read through
 * `useSyncExternalStore`. Owns the seq-dedupe boundary between replayed and
 * live session events so that invariant lives in one place, testable without
 * Ink or Cordis.
 * @module @tomowang/dsh-tui/tui/store
 */

import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'

/** One immutable snapshot of everything the TUI renders. */
export interface TuiState {
  /** Session log so far, in append order. */
  readonly events: readonly SessionEvent[]
  /** Highest `seq` that was seeded from replay rather than observed live. */
  readonly replayThrough: number
  /** Current agent lifecycle state. */
  readonly status: AgentStatus
  /** Messages currently pending in the agent's inbox. */
  readonly queued: readonly UserMessage[]
  /** Transient one-line notice (e.g. `/status`), cleared on the next input. */
  readonly notice: string | undefined
}

type Listener = () => void

/** Mutable projection; `getSnapshot`/`subscribe` satisfy `useSyncExternalStore`. */
export class TuiStore {
  private state: TuiState
  private readonly listeners = new Set<Listener>()
  private lastSeq: number

  constructor(initial: { events: readonly SessionEvent[] }) {
    const lastSeq = initial.events.at(-1)?.seq ?? 0
    this.lastSeq = lastSeq
    this.state = {
      events: initial.events,
      replayThrough: lastSeq,
      status: 'idle',
      queued: [],
      notice: undefined,
    }
  }

  getSnapshot = (): TuiState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Append one live session event, ignoring anything already seeded/seen. */
  appendEvent(event: SessionEvent): void {
    if (event.seq <= this.lastSeq) return
    this.lastSeq = event.seq
    this.set({ events: [...this.state.events, event] })
  }

  setStatus(status: AgentStatus): void {
    if (status === this.state.status) return
    this.set({ status })
  }

  setQueued(queued: readonly UserMessage[]): void {
    this.set({ queued })
  }

  setNotice(notice: string | undefined): void {
    this.set({ notice })
  }

  private set(partial: Partial<TuiState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) listener()
  }
}
