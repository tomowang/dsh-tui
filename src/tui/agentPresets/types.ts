/**
 * Plain, Cordis-agnostic snapshot of one agent preset, joined from
 * `ctx.agentPresets.list()` for the `/presets` overlay.
 * @module @tomowang/dsh-tui/tui/agentPresets/types
 */

/** One preset row as the overlay renders it. */
export interface AgentPresetRow {
  /** Stable identifier; the declaring `@deepseek-ai/dsh-agent-preset` row's `config.id`. */
  readonly id: string
  /** Display label: built-in English copy for a shipped preset, else the preset's own name, else its id. */
  readonly label: string
  /** One sentence on what this preset is for, when it published one. */
  readonly description: string | undefined
  /** Whether this is a shipped preset (`isBuiltInPreset`) rather than one a bundle patch declared. */
  readonly builtIn: boolean
  /** Why this preset cannot compose a session, `undefined` when it can. */
  readonly broken: string | undefined
}
