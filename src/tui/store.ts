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
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats'
import type { TokenUsageProjection } from '@deepseek-ai/dsh-token-meter'
import type { DiscoveredModel, ProviderDraft, ProviderRow } from './modelProfile/types.js'

/** Which pane of the `/model` overlay is showing. */
export type ModelProfileView = 'list' | 'form'

/** Overlay-owned state for the `/model` provider-profile screen. */
export interface ModelProfileOverlayState {
  readonly view: ModelProfileView
  /** Joined provider directory; `undefined` until the first load settles. */
  readonly providers: readonly ProviderRow[] | undefined
  readonly selected: number
  readonly draft: ProviderDraft | undefined
  /** Bumped on every `editProvider`/`createProvider` so the form remounts with fresh local state. */
  readonly formKey: number
  readonly discovered: readonly DiscoveredModel[] | undefined
  readonly busy: boolean
  readonly error: string | undefined
}

/** Full-screen overlay replacing the live region's normal controls. */
export type Overlay =
  | { readonly kind: 'none' }
  | { readonly kind: 'modelProfile'; readonly modelProfile: ModelProfileOverlayState }
  | { readonly kind: 'trajectory' }

/** Whole-log figures for the status bar's stats line; each side is `undefined` without its projection unit mounted. */
export interface StatsSnapshot {
  readonly sessionStats: SessionStatsProjection | undefined
  readonly tokenUsage: TokenUsageProjection | undefined
}

const EMPTY_STATS: StatsSnapshot = { sessionStats: undefined, tokenUsage: undefined }

/** The session's current permission preset, folded from `ctx.permissionPresets`. */
export interface PermissionState {
  /** The effective preset name, or `'custom'` when the knobs match no table entry. */
  readonly current: string
  /** Every switchable preset name, in table declaration order. */
  readonly names: readonly string[]
}

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
  /** Active full-screen overlay, if any, replacing the prompt/status live region. */
  readonly overlay: Overlay
  /** Current permission preset, or `undefined` when `ctx.permissionPresets` isn't composed in this profile. */
  readonly permission: PermissionState | undefined
  /** Whole-log stats-line figures, or `undefined` sides when `ctx.sessionProjections` isn't composed in this profile. */
  readonly stats: StatsSnapshot
}

const CLOSED_OVERLAY: Overlay = { kind: 'none' }

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
      overlay: CLOSED_OVERLAY,
      permission: undefined,
      stats: EMPTY_STATS,
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

  setPermission(permission: PermissionState | undefined): void {
    this.set({ permission })
  }

  setStats(stats: StatsSnapshot): void {
    this.set({ stats })
  }

  /** Open the `/model` overlay to a fresh, loading provider list. */
  openModelProfile(): void {
    this.set({
      overlay: {
        kind: 'modelProfile',
        modelProfile: {
          view: 'list',
          providers: undefined,
          selected: 0,
          draft: undefined,
          formKey: 0,
          discovered: undefined,
          busy: true,
          error: undefined,
        },
      },
    })
  }

  /** Open the `/trajectory` ledger overlay. */
  openTrajectory(): void {
    this.set({ overlay: { kind: 'trajectory' } })
  }

  /** Close whichever overlay is open, restoring the normal prompt/status controls. */
  closeOverlay(): void {
    this.set({ overlay: CLOSED_OVERLAY })
  }

  /** Patch the open `/model` overlay's sub-state; a no-op once it's closed. */
  updateModelProfile(patch: Partial<ModelProfileOverlayState>): void {
    if (this.state.overlay.kind !== 'modelProfile') return
    this.set({
      overlay: { kind: 'modelProfile', modelProfile: { ...this.state.overlay.modelProfile, ...patch } },
    })
  }

  private set(partial: Partial<TuiState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) listener()
  }
}
