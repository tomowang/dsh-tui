/**
 * Plain, dependency-free projection of Cordis/session events into a single
 * immutable snapshot that React components read through
 * `useSyncExternalStore`. Owns the seq-dedupe boundary between replayed and
 * live session events so that invariant lives in one place, testable without
 * Ink or Cordis.
 * @module @tomowang/dsh-tui/tui/store
 */

import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { SessionStatsProjection } from '@deepseek-ai/dsh-session-stats'
import type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter'
import type { DiscoveredModel, ProviderDraft, ProviderRow } from './modelProfile/types.js'
import type { PluginRow } from './plugins/types.js'
import type { AgentPresetRow } from './agentPresets/types.js'
import { textOf } from '../render.js'

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

/** Overlay-owned state for the `/presets` agent-preset screen. */
export interface AgentPresetsOverlayState {
  /** Joined preset roster; empty while the first load is still in flight (see `busy`). */
  readonly rows: readonly AgentPresetRow[]
  readonly selected: number
  /** The session's currently resolved preset id, or `undefined` without a mounted service. */
  readonly current: string | undefined
  /** Whether the session has run no turn yet — the only state a preset switch is accepted in. */
  readonly blank: boolean
  readonly busy: boolean
  readonly error: string | undefined
}

/** Full-screen overlay replacing the live region's normal controls. */
export type Overlay =
  | { readonly kind: 'none' }
  | { readonly kind: 'modelProfile'; readonly modelProfile: ModelProfileOverlayState }
  | { readonly kind: 'trajectory' }
  | { readonly kind: 'context' }
  | { readonly kind: 'plugins'; readonly rows: readonly PluginRow[] }
  | { readonly kind: 'agentPresets'; readonly agentPresets: AgentPresetsOverlayState }

/** Whole-log figures for the status bar's stats line; each side is `undefined` without its projection unit mounted. */
export interface StatsSnapshot {
  readonly sessionStats: SessionStatsProjection | undefined
  readonly tokenUsage: TokenUsageProjection | undefined
  readonly contextPressure: ContextPressureProjection | undefined
  readonly contextBreakdown: ContextBreakdownProjection | undefined
}

const EMPTY_STATS: StatsSnapshot = {
  sessionStats: undefined,
  tokenUsage: undefined,
  contextPressure: undefined,
  contextBreakdown: undefined,
}

/** The session's current permission preset, folded from `ctx.permissionPresets`. */
export interface PermissionState {
  /** The effective preset name, or `'custom'` when the knobs match no table entry. */
  readonly current: string
  /** Every switchable preset name, in table declaration order. */
  readonly names: readonly string[]
}

/** The session's current agent preset, folded from `ctx.agentPresets`. */
export interface PresetState {
  /** Display label of the resolved preset, or `undefined` when the deployment composes none. */
  readonly current: string | undefined
  /** Whether the session has run no turn yet — the only state a preset switch is accepted in. */
  readonly blank: boolean
}

/** The currently-generating step's accumulated text, folded live from `assistant/chunk`. */
export interface StreamingState {
  readonly turn: number
  readonly step: number
  readonly text: string
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
  /** Current agent preset, or `undefined` when `ctx.agentPresets` isn't composed in this profile. */
  readonly preset: PresetState | undefined
  /** The in-flight step's accumulated text, or `undefined` when nothing is currently streaming. */
  readonly streaming: StreamingState | undefined
}

const CLOSED_OVERLAY: Overlay = { kind: 'none' }

type Listener = () => void

/** Mutable projection; `getSnapshot`/`subscribe` satisfy `useSyncExternalStore`. */
export class TuiStore {
  private state: TuiState
  private readonly listeners = new Set<Listener>()
  private lastSeq: number
  // Not part of TuiState: mid-stream assembly state for the in-flight step,
  // rebuilt fresh whenever a chunk's `{turn, step}` doesn't match the last one.
  private streamingAssembler: BlockAssembler | undefined
  private streamingKey: { turn: number; step: number } | undefined

  constructor(initial: { events: readonly SessionEvent[] }) {
    const lastSeq = initial.events.at(-1)?.seq ?? 0
    this.lastSeq = lastSeq
    this.state = {
      // `assistant/chunk` rows from a prior session are never folded into
      // `streaming` (see appendEvent/foldChunk) — dropping them here too
      // keeps a resumed session's <Static> transcript free of dead entries
      // that would only ever render as null.
      events: initial.events.filter(event => event.type !== 'assistant/chunk'),
      replayThrough: lastSeq,
      status: 'idle',
      queued: [],
      notice: undefined,
      overlay: CLOSED_OVERLAY,
      permission: undefined,
      stats: EMPTY_STATS,
      preset: undefined,
      streaming: undefined,
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
    if (event.type === 'assistant/chunk') {
      this.foldChunk(event.data)
      return
    }
    if (event.type === 'assistant/message') {
      this.streamingAssembler = undefined
      this.streamingKey = undefined
      this.set({ events: [...this.state.events, event], streaming: undefined })
      return
    }
    this.set({ events: [...this.state.events, event] })
  }

  /** Fold one raw stream chunk into the in-flight step's live text, keyed by `{turn, step}`. */
  private foldChunk(data: { turn: number; step: number; chunk: StreamChunk }): void {
    const { turn, step, chunk } = data
    if (this.streamingKey?.turn !== turn || this.streamingKey?.step !== step) {
      this.streamingAssembler = new BlockAssembler()
      this.streamingKey = { turn, step }
    }
    this.streamingAssembler!.push(chunk)
    const text = textOf(this.streamingAssembler!.blocks())
    this.set({ streaming: text === '' ? undefined : { turn, step, text } })
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

  setPreset(preset: PresetState | undefined): void {
    this.set({ preset })
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

  /** Open the `/context` usage overlay. */
  openContext(): void {
    this.set({ overlay: { kind: 'context' } })
  }

  /** Open the `/plugins` loaded-plugin-tree overlay with a snapshotted row list. */
  openPlugins(rows: readonly PluginRow[]): void {
    this.set({ overlay: { kind: 'plugins', rows } })
  }

  /** Open the `/presets` overlay to a fresh, loading roster. */
  openAgentPresets(init: { current: string | undefined; blank: boolean }): void {
    this.set({
      overlay: {
        kind: 'agentPresets',
        agentPresets: { rows: [], selected: 0, current: init.current, blank: init.blank, busy: true, error: undefined },
      },
    })
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

  /** Patch the open `/presets` overlay's sub-state; a no-op once it's closed. */
  updateAgentPresets(patch: Partial<AgentPresetsOverlayState>): void {
    if (this.state.overlay.kind !== 'agentPresets') return
    this.set({
      overlay: { kind: 'agentPresets', agentPresets: { ...this.state.overlay.agentPresets, ...patch } },
    })
  }

  /** Move the `/presets` overlay's list cursor. */
  selectAgentPresetRow(index: number): void {
    this.updateAgentPresets({ selected: index })
  }

  private set(partial: Partial<TuiState>): void {
    this.state = { ...this.state, ...partial }
    for (const listener of this.listeners) listener()
  }
}
