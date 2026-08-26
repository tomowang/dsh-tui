/**
 * @tomowang/dsh-tui — interactive terminal front door. The bundle patch rides
 * over dsh-base without Host, HTTP, or browser plugins; this runner creates
 * (or resumes) one Agent through the core registry, projects the durable
 * session log to the terminal, and feeds line input back as follow-up or
 * steering messages until the reader exits.
 *
 * The plugin owns terminal input and presentation only; agent lifecycle,
 * session persistence, tool execution, and model policy remain separate
 * composition entries, so any dsh-base row stays patchable underneath it.
 *
 * @module @tomowang/dsh-tui
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
// Real import so its `agent-preset/selected` SessionEventMap augmentation
// (declared in the module's own session.ts) resolves alongside the value.
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { ManualCompactionErrorCode } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { GoalError } from '@deepseek-ai/dsh-goal'
import type { GoalProjection, GoalRef, GoalView } from '@deepseek-ai/dsh-goal'
import { foldPlanMode } from '@deepseek-ai/dsh-plan-mode'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp, SettingsScope } from '@deepseek-ai/dsh-settings'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApprovalOutcome, ApprovalRequest } from '@deepseek-ai/dsh-user-approval'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
// Empty type imports carry the loader Context merge for the mount await,
// the cmdline Context merge for the appExit host value, and the
// permission-presets Context merge for ctx.permissionPresets and the
// 'sandbox/mode'/'approval/policy' event types the permission-preset knobs
// write.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
// Type-only: resolves ctx.sessionProjections and its sessionStats/tokenUsage
// SessionProjectionMap entries for the status bar's stats line.
import type { SessionProjectionMap } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats'
// Resolves the 'title' SessionProjectionMap entry the terminal title
// (`TuiApp`'s `updateTerminalTitle`) reads, and `/rename`'s empty-title
// rejection.
import { foldSessionTitle, SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
// Type-only: resolves ctx.sessionPersistence for the /resume picker's
// cwd-scoped past-session listing.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-token-meter'

import { ensureSessionIdPrefix, stripSessionIdPrefix } from './sessionId.js'
import { SLASH_COMMANDS, SLASH_COMMAND_WIDTH } from './tui/commands.js'
import { goalPhaseLabel } from './tui/liveText.js'
import { TuiStore } from './tui/store.js'
import type { ModelProfileOverlayState, PermissionState, PresetState, StatsSnapshot } from './tui/store.js'
import { mountTui, restoreActiveTerminal, type TuiHandle } from './tui/TuiApp.js'
import { loadFileIndex } from './tui/fileIndex.js'
import type { TuiActions } from './tui/actions.js'
import { readPackageName, readPackageVersion } from './version.js'
import { checkForUpdate } from './updateCheck.js'
import type { ProviderDraft, ProviderRow, StoredProviderProfile } from './tui/modelProfile/types.js'
import type { PluginRow } from './tui/plugins/types.js'
import type { AgentPresetRow } from './tui/agentPresets/types.js'
import type { SessionResumeRow } from './tui/resume/types.js'
import type { QuestionAnswer, QuestionOptionRow } from './tui/interaction/types.js'

/** Stable Cordis plugin name. */
export const name = 'tui'

/** Core services required before the interactive loop can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Settings namespace hand-declared/custom provider profiles are stored under. */
const CUSTOM_PROVIDER_NAMESPACE = 'llm-pi-ai'

/** Settings namespace submitted-line history is persisted under, for up/down-arrow recall across process restarts. */
const HISTORY_NAMESPACE = 'tui-history'

/** Persisted prompt-history shape: previously submitted lines, oldest first. */
interface HistorySettings {
  entries: string[]
}

const HistorySettings: z<HistorySettings> = z.object({ entries: z.array(z.string()) })

/** Read a nested value out of an untyped resolved/raw settings section. */
function getAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** Derive a POSIX-identifier credential ref from a provider route, e.g. `my-proxy` -> `MY_PROXY_API_KEY`. */
function deriveApiKeyRef(route: string): string {
  const upper = route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  const identifier = /^[A-Z_]/.test(upper) ? upper : `P_${upper}`
  return `${identifier}_API_KEY`
}

/** Map a loader entry's live fiber state to the `/plugins` overlay's display label. */
function fiberStateLabel(state: FiberState): PluginRow['state'] {
  switch (state) {
    case FiberState.PENDING: return 'pending'
    case FiberState.LOADING: return 'loading'
    case FiberState.ACTIVE: return 'active'
    case FiberState.FAILED: return 'failed'
    case FiberState.DISPOSED: return 'disposed'
    case FiberState.UNLOADING: return 'unloading'
  }
}

/** Short, user-facing text for each `ManualCompactionError` code, mirroring the harness's `command-compact` plugin. */
const COMPACTION_ERROR_MESSAGES: Record<ManualCompactionErrorCode, string> = {
  busy: 'compaction is unavailable while another compaction is running, or the agent is not idle',
  cancelled: 'compaction cancelled',
  changed: 'the selected history changed before it could be replaced; the conversation is unchanged',
  summary: 'compaction could not produce a useful summary; the conversation is unchanged',
  commit: 'compaction did not finish cleanly; some session history may have changed',
  persistence: 'compaction finished, but the session could not be saved',
}

/**
 * English display names for the four shipped preset ids. The shipped
 * `preset.yml` metadata is authored in Chinese and there's no server-side
 * locale resolution — the web client's own EN/ZH table lives in a
 * browser-only React package, so a plain fallback table is simplest here.
 * Any other preset id (a locally authored one) falls back to its own `name`
 * metadata, then its raw id.
 */
const BUILT_IN_PRESET_LABELS: Record<string, string> = {
  standard: 'Standard mode',
  code: 'Code mode',
  minimal: 'Minimal mode',
  cordis: 'Creator mode',
}

/** Display label for a bare preset id, without fetching its metadata. */
function presetLabelForId(id: string): string {
  return BUILT_IN_PRESET_LABELS[id] ?? id
}

/** Display label for a resolved preset row, preferring its own metadata over the raw id. */
function presetRowLabel(preset: AgentPreset): string {
  return BUILT_IN_PRESET_LABELS[preset.id] ?? preset.name ?? preset.id
}

/** Whether `session` has run no turn yet — the only state a preset switch is accepted in, mirroring the harness's own `sessionBlank`. */
function sessionBlank(session: Session): boolean {
  return !session.events.some(event => event.type === 'turn/start')
}

// --- `/goal` helpers, mirroring `@deepseek-ai/dsh-command-goal`'s own handler ---
// The TUI intercepts `/goal` in the prompt (like `/plan`) instead of
// dispatching through `ctx.commands`, so the handler below re-implements
// command-goal's grammar and result text as the notice.

/** Usage line for `/goal`, matching `command-goal`'s `USAGE`. */
const GOAL_USAGE = 'Usage: /goal [<objective>|clear|edit <objective>|pause|resume]'

/** Exact current compare-and-set ref for one live goal view. */
function goalRef(goal: GoalView): GoalRef {
  return { id: goal.id, revision: goal.revision }
}

/** Commands that are meaningful from one exact live state, mirroring `command-goal`'s `commandHint`. */
function goalCommandHint(goal: GoalView): string {
  if (goal.phase === 'active') {
    return goal.activation === 'armed'
      ? '/goal edit <objective>, /goal pause, /goal clear'
      : '/goal edit <objective>, /goal resume, /goal clear'
  }
  switch (goal.phase) {
    case 'paused':
    case 'blocked':
      return '/goal edit <objective>, /goal resume, /goal clear'
    case 'complete':
      return '/goal <objective>, /goal clear'
  }
}

/** Render one `/goal` result as the notice, mirroring `command-goal`'s `renderGoal`. */
function renderGoalNotice(title: string, goal: GoalView): string {
  const reason = goal.phase === 'blocked' ? goal.blockedReason : undefined
  /* v8 ignore next -- durable replay guarantees every blocked goal carries its validated reason */
  if (goal.phase === 'blocked' && reason === undefined) throw new TypeError('blocked goal is missing its reason')
  const blocker = reason === undefined ? [] : [`Blocker: ${reason.code}: ${reason.message}`]
  return [
    title,
    `Status: ${goalPhaseLabel(goal.phase)}`,
    ...blocker,
    `Objective: ${goal.objective}`,
    `Rounds: ${goal.roundsStarted}/${goal.maxGoalRounds}`,
    `Activation: ${goal.activation}`,
    '',
    `Commands: ${goalCommandHint(goal)}`,
  ].join('\n')
}

/** Notice for an operation that requires a current goal, mirroring `command-goal`'s `missingGoal`. */
function goalMissingNotice(action: string): string {
  return `No goal is currently set; /goal ${action} requires one. ${GOAL_USAGE}`
}

/** Plugin config: startup values resolved from this app's provider service. */
export interface Config {
  /** Session id to resume; absent starts a fresh session. */
  resume?: string
  /** Agent preset id to compose a fresh session from; absent uses the deployment's default. Ignored when resuming. */
  agentPreset?: string
}

export const Config: z<Config> = z.object({
  resume: z.string(),
  agentPreset: z.string(),
})

/** Process-facing effects of the interactive loop; tests substitute captures. */
interface TuiIo {
  write(chunk: string): unknown
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The process stream the TUI writes to and mounts Ink on; tests substitute a capture. */
export const internals: { stdout: NodeJS.WriteStream } = {
  stdout: process.stdout,
}

/** Report an unexpected front-door failure and request a failing exit. */
function fail(io: TuiIo, error: unknown, instance: TuiHandle | undefined): void {
  instance?.unmount()
  io.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/** Replace a leading home directory with `~`, matching common shell prompts. */
function abbreviateHome(cwd: string): string {
  const home = homedir()
  return cwd === home || cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd
}

/**
 * Drive one interactive session: create or resume the Agent, replay its log,
 * follow live session events, and mount the Ink front end for input.
 * @param ctx - plugin context carrying the Agent, default model, and Session services.
 * @param config - validated startup config.
 * @param io - process-facing effects.
 * @param mounted - written once the TUI mounts, so a later rejection can unmount before reporting.
 */
async function run(ctx: Context, config: Config, io: TuiIo, mounted: { instance?: TuiHandle }): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agentsMaybe = ctx.get('agents')
  const defaultModelMaybe = ctx.get('agentDefaultModel')
  const sessionsMaybe = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agentsMaybe === undefined || defaultModelMaybe === undefined || sessionsMaybe === undefined) return
  // Rebound so nested closures (attachSession, defined below) see the
  // narrowed non-undefined type — TS doesn't carry flow narrowing into them.
  const agents = agentsMaybe
  const defaultModel = defaultModelMaybe
  const sessions = sessionsMaybe
  // Same optional-service pattern: not every profile composes permission
  // presets, so the indicator/keybinding degrade instead of the TUI refusing
  // to start.
  const permissionPresets = ctx.get('permissionPresets')
  // Same optional-service pattern: a lean profile without the projection
  // registry (or without dsh-tui's own session-stats/token-meter rows) just
  // shows no stats line instead of the TUI refusing to start.
  const sessionProjections = ctx.get('sessionProjections')
  // Same optional-service pattern: a profile without a mounted compaction
  // engine just tells the reader /compact is unavailable instead of
  // refusing to start.
  const compaction = ctx.get('compaction')
  // Same optional-service pattern: a profile without a mounted plan-mode
  // controller just tells the reader /plan is unavailable instead of
  // refusing to start.
  const planMode = ctx.get('planMode')
  // Same optional-service pattern: a profile without the goal domain
  // (dsh-base composes it, but an overridden patch may not) just tells the
  // reader /goal is unavailable and hides the goal strip instead of refusing
  // to start.
  const goals = ctx.get('goals')
  // Same optional-service pattern: a profile without the session-title
  // service just tells the reader /rename is unavailable instead of
  // refusing to start.
  const sessionTitle = ctx.get('sessionTitle')
  // Same optional-service pattern: a profile without a mounted agent-preset
  // roster just shows no preset in the status bar and tells the reader
  // /presets is unavailable instead of refusing to start.
  const presets = ctx.get('agentPresets')
  // Same optional-service pattern: a profile without durable session
  // persistence just tells the reader /resume's picker is unavailable
  // instead of refusing to start (`/resume <id>` itself still works — it
  // goes through `agents.resume`, not this seam).
  const sessionPersistence = ctx.get('sessionPersistence')
  // Same optional-service pattern: a profile without a mounted settings
  // service just keeps prompt history in memory for the process's lifetime
  // instead of refusing to start. Registration can also fail loud on an
  // invalid stored section — degrade the same way rather than crash.
  const settingsForHistory = ctx.get('settings')
  let historyScope: SettingsScope<HistorySettings> | undefined
  if (settingsForHistory !== undefined) {
    try {
      historyScope = settingsForHistory.register(settingsNamespace(HISTORY_NAMESPACE), HistorySettings)
    } catch {
      historyScope = undefined
    }
  }

  /**
   * Best-effort persist of one new history line. Reads the settings scope's
   * current resolved value rather than this process's own `promptHistory`
   * copy — the file provider hot-reloads other processes' writes into it —
   * so two `dsh-tui` processes appending around the same time are less
   * likely to clobber each other than a naive replace-with-local-array
   * write would be. Not a real lock: a tight enough race can still stomp.
   */
  function persistHistory(line: string): void {
    if (historyScope === undefined) return
    const current = historyScope.get().entries
    if (current.at(-1) === line) return
    void historyScope.replace({ entries: [...current, line] }).catch(() => {})
  }

  /** Guard for the three optional model-profile services, together or not at all. Re-resolved on every call, not cached: a profile that mounts these after startup should still be picked up. */
  function requireModelProfileServices() {
    const settingsSvc = ctx.get('settings')
    const credentialsSvc = ctx.get('credentials')
    const llmSvc = ctx.get('llm')
    if (settingsSvc === undefined || credentialsSvc === undefined || llmSvc === undefined) return undefined
    return { settings: settingsSvc, credentials: credentialsSvc, llm: llmSvc }
  }

  // Same optional-service pattern: a profile without a mounted tool registry
  // just falls back to the flat `tool/call`/`tool/result` rendering `render.ts`
  // already had before tool cards, instead of refusing to start.
  function getTool(name: string): ToolDefinition | undefined {
    return ctx.get('tools')?.get(name)
  }

  /** The session's current permission preset, or `undefined` without a mounted service. */
  function permissionState(events: readonly SessionEvent[]): PermissionState | undefined {
    if (permissionPresets === undefined) return undefined
    return { current: permissionPresets.current(events), names: permissionPresets.names }
  }

  /**
   * One shared projection cut's raw values, or `undefined` without a mounted
   * registry/unit. `snapshot()` schema-validates every registered key on
   * each call, so callers needing more than one key (e.g. the initial store
   * seed below) must fetch this once and derive both from it rather than
   * calling `statsSnapshot`/`goalSnapshot` separately.
   */
  function projectionValues(session: Session): Partial<SessionProjectionMap> | undefined {
    return sessionProjections?.snapshot(session).values
  }

  /** The session's current stats-line figures, or empty sides without a mounted registry/unit. */
  function statsSnapshot(values: Partial<SessionProjectionMap> | undefined): StatsSnapshot {
    return {
      sessionStats: values?.sessionStats,
      tokenUsage: values?.tokenUsage,
      contextPressure: values?.contextPressure,
      contextBreakdown: values?.contextBreakdown,
    }
  }

  /** The session's current goal projection (the 'goal' key), or `undefined` without a mounted registry/unit. */
  function goalSnapshot(values: Partial<SessionProjectionMap> | undefined): GoalProjection | null | undefined {
    return values?.goal
  }

  /** The session's current title (the 'title' key), or `undefined` without a mounted registry/unit (`@deepseek-ai/dsh-session-title` not composed in this profile). */
  function titleSnapshot(values: Partial<SessionProjectionMap> | undefined): string | null | undefined {
    return values?.title
  }

  /** The session's current agent preset, or `undefined` without a mounted service. */
  function currentPresetState(session: Session): PresetState | undefined {
    if (presets === undefined) return undefined
    const id = resolveSessionPreset(session)
    return { current: id === undefined ? undefined : presetLabelForId(id), blank: sessionBlank(session) }
  }

  /** Snapshot the loader's current entry tree into plain display rows, or `undefined` without a mounted loader. */
  function pluginRows(): PluginRow[] | undefined {
    const loader = ctx.get('loader')
    if (loader === undefined) return undefined
    return [...loader.entries()].map(entry => ({
      id: entry.id,
      name: entry.options.name,
      disabled: entry.disabled,
      group: Boolean(entry.options.group),
      state: entry.fiber === undefined ? undefined : fiberStateLabel(entry.fiber.state),
    }))
  }

  /** The open `/model` overlay's sub-state, or `undefined` while it's closed. */
  function currentModelProfile(): ModelProfileOverlayState | undefined {
    const overlay = current.store.getSnapshot().overlay
    return overlay.kind === 'modelProfile' ? overlay.modelProfile : undefined
  }

  /** Re-join `ctx.llm`'s provider directory with `ctx.settings`/`ctx.credentials` and refresh the list. */
  async function loadProviders(): Promise<void> {
    const services = requireModelProfileServices()
    if (services === undefined) {
      current.store.updateModelProfile({
        providers: [],
        busy: false,
        error: 'Model provider settings are not available in this profile.',
      })
      return
    }
    const { settings: settingsSvc, credentials: credentialsSvc, llm: llmSvc } = services
    const configurable = llmSvc.listConfigurableProviders()
    const live = new Set(llmSvc.listProviders().map(provider => provider.id))
    const descriptors = settingsSvc.describe({ redactSecrets: true })
    const byNs = new Map<string, (typeof descriptors)[number]>(descriptors.map(descriptor => [descriptor.ns, descriptor]))
    const rows: ProviderRow[] = []
    for (const entry of configurable) {
      const descriptor = byNs.get(entry.settingsNs)
      const value =
        descriptor === undefined
          ? undefined
          : (getAtPath(descriptor.value, entry.settingsPath) as StoredProviderProfile | undefined)
      const userValue = descriptor === undefined ? undefined : getAtPath(descriptor.user, entry.settingsPath)
      const apiKeyRef = value?.apiKeyEnv ?? deriveApiKeyRef(entry.provider)
      const info = await credentialsSvc.describe(credentialRef(apiKeyRef))
      rows.push({
        route: entry.provider,
        displayName: value?.displayName ?? entry.displayName,
        settingsNs: entry.settingsNs,
        settingsPath: entry.settingsPath,
        configured: userValue !== undefined,
        live: live.has(entry.provider),
        api: value?.api,
        baseURL: value?.baseURL,
        apiKeyRef,
        apiKeyConfigured: info.configured,
        models: value?.models ?? [],
        revision: descriptor?.revision,
      })
    }
    const previousSelected = currentModelProfile()?.selected ?? 0
    current.store.updateModelProfile({
      providers: rows,
      busy: false,
      error: undefined,
      selected: Math.min(previousSelected, Math.max(0, rows.length - 1)),
    })
  }

  /** Fetch the deployment's preset roster and refresh the open `/presets` overlay's row list. */
  async function loadAgentPresets(): Promise<void> {
    if (presets === undefined) return
    try {
      const list = await presets.list()
      const rows: AgentPresetRow[] = list.map(preset => ({
        id: preset.id,
        label: presetRowLabel(preset),
        description: preset.description,
        trust: preset.trust,
        broken: preset.broken,
      }))
      current.store.updateAgentPresets({ rows, busy: false, error: undefined })
    } catch (error) {
      current.store.updateAgentPresets({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Fetch this cwd's past sessions (headers only — cheap, no full-log parse)
   * and refresh the open `/resume` overlay's row list. A header alone has no
   * title (that's folded from `session/title` events, not stored metadata),
   * so each candidate gets one `inspect` — a full log read — to fold its
   * title; a failed or title-less inspect just leaves that row's title
   * `undefined` ("untitled") rather than dropping the row or the listing.
   */
  async function loadResumeSessions(): Promise<void> {
    if (sessionPersistence === undefined) return
    try {
      const headers = await sessionPersistence.list()
      const cwd = process.cwd()
      const candidates = headers
        .filter(header => header.origin !== 'subagent' && header.cwd === cwd && header.id !== current.agent.session.id)
        .sort((a, b) => b.createdAt - a.createdAt)
      const rows = await Promise.all(candidates.map(async (header): Promise<SessionResumeRow> => {
        let title: string | undefined
        try {
          const inspected = await sessionPersistence.inspect(header.id)
          title = foldSessionTitle(inspected.events)?.title
        } catch {
          title = undefined
        }
        return { id: stripSessionIdPrefix(String(header.id)), title, createdAt: header.createdAt }
      }))
      current.store.updateResume({ rows, busy: false, error: undefined })
    } catch (error) {
      current.store.updateResume({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Load the `@`-mention dropdown's backing file list, guarded against a redundant reload once one is already loaded/in flight. */
  async function ensureFileIndexLoaded(): Promise<void> {
    const snapshot = current.store.getSnapshot().fileIndex
    if (snapshot.candidates !== undefined || snapshot.loading) return
    current.store.setFileIndexLoading()
    const candidates = await loadFileIndex(process.cwd())
    current.store.setFileIndex(candidates)
  }

  /** Write a draft's fields as path ops under its (or a new custom route's) settings path, then its API key. */
  async function persistProvider(draft: ProviderDraft): Promise<void> {
    const services = requireModelProfileServices()
    if (services === undefined) return
    if (draft.isNew && draft.route.trim() === '') {
      current.store.updateModelProfile({ error: 'Route is required.' })
      return
    }
    if (draft.isNew) {
      // `deriveApiKeyRef` collapses separator characters, so distinct routes
      // (`foo-bar`, `foo.bar`, `foo_bar`) can derive the same credential ref —
      // block the save instead of letting one route's key silently overwrite
      // another's.
      const apiKeyRef = draft.apiKeyRef === '' ? deriveApiKeyRef(draft.route) : draft.apiKeyRef
      const collision = currentModelProfile()?.providers?.find(row => row.route !== draft.route && row.apiKeyRef === apiKeyRef)
      if (collision !== undefined) {
        current.store.updateModelProfile({ error: `Route derives the same credential as "${collision.route}" — choose a more distinct route.` })
        return
      }
    }
    current.store.updateModelProfile({ busy: true, error: undefined })
    try {
      const path = draft.isNew ? ['providers', draft.route.trim()] : [...draft.settingsPath]
      const ns = settingsNamespace(draft.isNew ? CUSTOM_PROVIDER_NAMESPACE : draft.settingsNs)
      const apiKeyRef = draft.apiKeyRef === '' ? deriveApiKeyRef(draft.route) : draft.apiKeyRef
      const ops: SettingsPathOp[] = [{ op: 'set', path: [...path, 'displayName'], value: draft.displayName }]
      if (draft.api === '') ops.push({ op: 'unset', path: [...path, 'api'] })
      else ops.push({ op: 'set', path: [...path, 'api'], value: draft.api })
      if (draft.baseURL === '') ops.push({ op: 'unset', path: [...path, 'baseURL'] })
      else ops.push({ op: 'set', path: [...path, 'baseURL'], value: draft.baseURL })
      ops.push({ op: 'set', path: [...path, 'apiKeyEnv'], value: apiKeyRef })
      ops.push({ op: 'set', path: [...path, 'models'], value: draft.models })
      await services.settings.mutate(ns, ops, draft.revision)
      if (draft.apiKeyDraft !== '') await services.credentials.set(credentialRef(apiKeyRef), draft.apiKeyDraft)
      current.store.updateModelProfile({ view: 'list', draft: undefined })
      await loadProviders()
    } catch (error) {
      current.store.updateModelProfile({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Unset a provider's settings section, then its credential, and reload the
   * list. Settings is the conflict-checked write and the sole thing that can
   * block the removal; credential cleanup is best-effort afterward, since a
   * leftover unused credential is harmless while a provider left "configured"
   * with its key already gone (the other ordering's failure mode) is not.
   */
  async function removeProvider(row: ProviderRow): Promise<void> {
    const services = requireModelProfileServices()
    if (services === undefined) return
    current.store.updateModelProfile({ busy: true, error: undefined })
    try {
      await services.settings.mutate(settingsNamespace(row.settingsNs), [{ op: 'unset', path: row.settingsPath }], row.revision)
    } catch (error) {
      current.store.updateModelProfile({ busy: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    try {
      await services.credentials.unset(credentialRef(row.apiKeyRef))
    } catch (error) {
      current.store.setNotice(`provider removed, but its credential could not be cleared: ${error instanceof Error ? error.message : String(error)}`)
    }
    await loadProviders()
  }

  /** Probe a draft's endpoint (or its adapter's own catalog knowledge) for available models. */
  async function probeModels(draft: ProviderDraft): Promise<void> {
    const services = requireModelProfileServices()
    if (services === undefined) return
    current.store.updateModelProfile({ busy: true, error: undefined })
    try {
      const results = await services.llm.discoverModels(draft.isNew ? CUSTOM_PROVIDER_NAMESPACE : draft.settingsNs, {
        provider: draft.isNew ? undefined : draft.route,
        baseURL: draft.baseURL === '' ? undefined : draft.baseURL,
        api: draft.api === '' ? undefined : draft.api,
        apiKey: draft.apiKeyDraft === '' ? undefined : draft.apiKeyDraft,
      })
      current.store.updateModelProfile({ discovered: results, busy: false })
    } catch (error) {
      current.store.updateModelProfile({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** One live agent/session/UI wiring; replaced wholesale by `clearSession()`/`resumeSession()`. */
  interface CurrentSession {
    readonly agent: Agent
    readonly store: TuiStore
    readonly instance: TuiHandle
    /** From `AgentHandle.dispose`: stops the loop and drops it from the live session store (not disk). */
    readonly disposeAgent: () => Promise<void>
    readonly unsubscribers: readonly (() => unknown)[]
    closing: boolean
  }

  // --- In-terminal approval/question answerers ------------------------------
  // `ctx.approval`'s `approval/request` waterfall and `ctx.userQuestions`'
  // provider seam are both Cordis-context-scoped (registered once for the
  // plugin's whole lifetime), not per-session, so this queue lives outside
  // `attachSession` and routes every answer through whichever session's
  // store is current — a `/clear` mid-request still lands the prompt on the
  // live screen. One shared FIFO backs both request kinds since they render
  // into the same single overlay slot.
  type PendingInteraction =
    | {
        readonly kind: 'approval'
        readonly toolName: string
        readonly callId: string | undefined
        readonly reason: string | undefined
        settle(outcome: ApprovalOutcome): void
      }
    | {
        readonly kind: 'question'
        readonly header: string | undefined
        readonly question: string
        readonly detail: string | undefined
        readonly options: readonly QuestionOptionRow[]
        readonly multiSelect: boolean
        readonly approveLabel: string | undefined
        readonly progress: string | undefined
        settle(answer: QuestionAnswer): void
      }

  const interactionQueue: PendingInteraction[] = []
  let activeInteraction: PendingInteraction | undefined

  /** Show the next queued interaction, or close the overlay once the queue drains. */
  function showNextInteraction(): void {
    if (activeInteraction !== undefined) return
    const next = interactionQueue.shift()
    activeInteraction = next
    if (next === undefined) {
      current.store.closeOverlay()
      return
    }
    if (next.kind === 'approval') {
      current.store.openApproval({ toolName: next.toolName, callId: next.callId, reason: next.reason })
    } else {
      current.store.openUserQuestion({
        header: next.header,
        question: next.question,
        detail: next.detail,
        options: next.options,
        multiSelect: next.multiSelect,
        approveLabel: next.approveLabel,
        progress: next.progress,
      })
    }
  }

  /** Queue one interaction, showing it immediately if the overlay is free. */
  function enqueueInteraction(item: PendingInteraction): void {
    interactionQueue.push(item)
    showNextInteraction()
  }

  /** Drop a not-yet-shown interaction from the queue, or clear+advance past the active one — shared by a settled answer and a signal abort. */
  function retireInteraction(item: PendingInteraction): void {
    const index = interactionQueue.indexOf(item)
    if (index !== -1) {
      interactionQueue.splice(index, 1)
      return
    }
    if (activeInteraction === item) {
      activeInteraction = undefined
      showNextInteraction()
    }
  }

  // Bare Cordis event: fires only from inside a mounted `ApprovalService`, so
  // registering it costs nothing on a profile that composes none. Always
  // claims the request (never calls `next()`) since this answerer is the
  // interactive channel a deployment would compose it for.
  ctx.on('approval/request', async (req: ApprovalRequest) => {
    return new Promise<ApprovalOutcome>(resolve => {
      if (req.signal?.aborted) {
        resolve('cancelled')
        return
      }
      let settled = false
      const settleOutcome = (outcome: ApprovalOutcome): void => {
        if (settled) return
        settled = true
        req.signal?.removeEventListener('abort', onAbort)
        retireInteraction(item)
        resolve(outcome)
      }
      const onAbort = (): void => settleOutcome('cancelled')
      const item: PendingInteraction = {
        kind: 'approval',
        toolName: req.toolName,
        callId: req.callId,
        reason: req.reason,
        settle: settleOutcome,
      }
      req.signal?.addEventListener('abort', onAbort, { once: true })
      enqueueInteraction(item)
    })
  })

  // Same optional-service pattern: a profile without a mounted user-questions
  // seam just leaves `ask_user_question`/`exit_plan_mode` calls to whatever
  // that seam's own no-provider behavior is, instead of refusing to start.
  const userQuestionsSvc = ctx.get('userQuestions')
  if (userQuestionsSvc !== undefined) {
    ctx.effect(() =>
      userQuestionsSvc.registerProvider({
        ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
          return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
            const answers: AskUserQuestionAnswerItem[] = []
            let index = 0
            let settled = false
            let activeItem: PendingInteraction | undefined

            const fail = (): void => {
              if (settled) return
              settled = true
              request.signal?.removeEventListener('abort', fail)
              if (activeItem !== undefined) retireInteraction(activeItem)
              reject(new UserQuestionError('ask_user_question was interrupted before the user answered', 'ASK_ABORTED'))
            }
            request.signal?.addEventListener('abort', fail, { once: true })

            const askNext = (): void => {
              const question = request.questions[index]
              if (question === undefined) {
                settled = true
                request.signal?.removeEventListener('abort', fail)
                resolve({ answers })
                return
              }
              const item: PendingInteraction = {
                kind: 'question',
                header: question.header,
                question: question.question,
                detail: question.detail,
                options: (question.options ?? []).map(option => ({ label: option.label, description: option.description })),
                multiSelect: question.multiSelect ?? false,
                approveLabel: question.intent?.approve,
                progress: request.questions.length > 1 ? `Question ${index + 1} of ${request.questions.length}` : undefined,
                settle(answer) {
                  if (settled) return
                  activeItem = undefined
                  retireInteraction(item)
                  answers.push({
                    id: question.id,
                    selected: [...answer.selected],
                    ...(answer.custom === undefined ? {} : { custom: answer.custom }),
                  })
                  index += 1
                  askNext()
                },
              }
              activeItem = item
              enqueueInteraction(item)
            }
            askNext()
          })
        },
      }),
    )
  }

  // Owned here (outside the Ink tree) rather than inside PromptInput so `/clear`'s
  // remount doesn't lose the reader's up/down-arrow recall. Seeded from the
  // settings-backed history namespace (when mounted) so recall also survives
  // process restarts, not just `/clear`.
  const promptHistory: string[] = historyScope !== undefined ? [...historyScope.get().entries] : []

  /** Create (or resume) one Agent, wire its listeners to a fresh store, and mount a fresh Ink tree. */
  async function attachSession(resumeId: string | undefined): Promise<CurrentSession> {
    const selection = defaultModel.currentSelection()
    const agentOptions = { provider: selection.provider, model: selection.model }

    // Only a fresh session adopts `config.agentPreset`/the deployment default —
    // a resumed session's preset is whatever its persisted header (or a later
    // `agent-preset/selected` event) already recorded, exactly like `--resume`
    // already ignores model-selection flags in favor of the persisted state.
    let resolvedPreset: AgentPreset | undefined
    let presetNotice: string | undefined
    if (resumeId === undefined) {
      if (presets !== undefined) {
        try {
          resolvedPreset = await presets.resolve(config.agentPreset)
        } catch (error) {
          const named = config.agentPreset === undefined ? '' : `"${config.agentPreset}" `
          presetNotice = `agent preset ${named}could not be resolved: ${error instanceof Error ? error.message : String(error)}`
        }
      } else if (config.agentPreset !== undefined) {
        presetNotice = 'agent presets are not available in this profile; --agent-preset ignored'
      }
    }

    const setup = async (agentCtx: Context): Promise<void> => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
      if (presets !== undefined && resolvedPreset !== undefined) await presets.mount(agentCtx, resolvedPreset.id)
    }
    // dsh-agent's own doc calls `dispose` a portable CAPABILITY meant to be
    // handed to another owner (exactly what happens below, into
    // `disposeAgent`) — detaching it from the result object is the intended
    // usage, not an accidental `this` loss.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { agent, dispose } = resumeId !== undefined
      // `resume` loads the persisted log through `ctx.sessionPersistence`
      // before booting the agent on it; `create` never touches persistence,
      // so pointing it at an existing id (the old behavior here) built a
      // near-empty session that collided with the real log on first write.
      ? await agents.resume({ resumeSessionId: SessionId(ensureSessionIdPrefix(resumeId)), agentOptions, setup })
      : await agents.create({
          sessionId: SessionId(`session-${randomUUID()}`),
          meta: { cwd: process.cwd(), ...(resolvedPreset === undefined ? {} : { agentPreset: resolvedPreset.id }) },
          agentOptions,
          setup,
        })
    await agent.whenIdle()

    // Seed the store from persisted history, then follow the same log live; the
    // store's seq boundary keeps one rendering pass per event across replay and
    // live phases, and `--resume` starts with any pending inbox already shown.
    const store = new TuiStore({ events: agent.session.events })
    store.setStatus(agent.status)
    store.setQueued([...agent.inbox.nextStep, ...agent.inbox.nextTurn])
    store.setPermission(permissionState(agent.session.events))
    const initialProjection = projectionValues(agent.session)
    store.setStats(statsSnapshot(initialProjection))
    store.setGoal(goalSnapshot(initialProjection))
    store.setTitle(titleSnapshot(initialProjection))
    store.setPreset(currentPresetState(agent.session))
    if (presetNotice !== undefined) store.setNotice(presetNotice)

    const resnapshotQueue = (): void => {
      store.setQueued([...agent.inbox.nextStep, ...agent.inbox.nextTurn])
    }
    const unsubscribers: (() => unknown)[] = [
      ctx.on('session/event', (session, event) => {
        if (session !== agent.session) return
        store.appendEvent(event)
        if (event.type === 'permission/preset' || event.type === 'sandbox/mode' || event.type === 'approval/policy') {
          store.setPermission(permissionState(agent.session.events))
        }
        if (event.type === 'agent-preset/selected') {
          store.setPreset(currentPresetState(agent.session))
        }
      }),
      ctx.on('agent/status', (payload) => {
        if (payload.agent !== agent) return
        store.setStatus(payload.status)
      }),
      ctx.on('agent/inbox/inserted', (payload) => {
        if (payload.agent !== agent) return
        resnapshotQueue()
      }),
      ctx.on('agent/inbox/claimed', (payload) => {
        if (payload.agent !== agent) return
        resnapshotQueue()
      }),
      ctx.on('agent/inbox/discarded', (payload) => {
        if (payload.agent !== agent) return
        resnapshotQueue()
      }),
    ]
    // The registry's change feed lives on wherever it was constructed, not on
    // this call site's fiber, so its disposer must be collected here rather
    // than relying on effect teardown.
    if (sessionProjections !== undefined) {
      unsubscribers.push(sessionProjections.onChanged((session, key) => {
        if (session !== agent.session) return
        if (key === 'goal') {
          store.setGoal(goalSnapshot(projectionValues(agent.session)))
          return
        }
        if (key === 'title') {
          store.setTitle(titleSnapshot(projectionValues(agent.session)))
          return
        }
        if (key !== 'sessionStats' && key !== 'tokenUsage' && key !== 'contextPressure' && key !== 'contextBreakdown') return
        store.setStats(statsSnapshot(projectionValues(agent.session)))
      }))
    }

    // Local re-entrancy guard for `/compact`; a fresh session from `/clear` gets a fresh one.
    let compacting = false

    const actions: TuiActions = {
      send(text) {
        store.setNotice(undefined)
        const message = createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        })
        // An idle driver opens a turn from follow-up; a running one takes steering.
        if (agent.status === 'running') agent.steer(message)
        else agent.followup(message)
      },
      cancel() {
        agent.cancel({ kind: 'user' })
      },
      runShell(command) {
        // A local shell escape (Claude Code-style `!` bash mode): runs
        // outside the agent loop entirely, so its output is never appended
        // to the session log — only to this store's own display-only
        // transcript. stdin is not wired up (interactive/full-screen
        // commands aren't supported), matching a one-shot command runner.
        const id = store.startShellRun(command)
        const shell = process.env.SHELL ?? '/bin/sh'
        try {
          const child = spawn(shell, ['-c', command], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
          child.stdout.on('data', (chunk: Buffer) => store.appendShellOutput(id, chunk.toString()))
          child.stderr.on('data', (chunk: Buffer) => store.appendShellOutput(id, chunk.toString()))
          child.on('error', (error) => {
            store.appendShellOutput(id, `${error.message}\n`)
            store.finishShellRun(id, null)
          })
          child.on('close', (code) => {
            store.finishShellRun(id, code)
          })
        } catch (error) {
          store.appendShellOutput(id, `${error instanceof Error ? error.message : String(error)}\n`)
          store.finishShellRun(id, null)
        }
      },
      shutdown() {
        void shutdown()
      },
      help() {
        const commands = SLASH_COMMANDS.map(c => `  ${c.command.padEnd(SLASH_COMMAND_WIDTH)}  ${c.description}`).join('\n')
        const shortcuts = [
          '  Shift+Tab       cycle the permission preset',
          '  Ctrl+O          open Tool Cards (expand/collapse details)',
          '  !               on an empty prompt, enter shell mode (Enter runs a local command)',
          '  @               open the file-mention dropdown',
          '  Ctrl+C, Ctrl+D  cancel a running turn; press twice on an idle empty line to exit',
        ].join('\n')
        store.setNotice(`Commands:\n${commands}\n\nShortcuts:\n${shortcuts}`)
      },
      recordHistory: persistHistory,
      clear() {
        void clearSession()
      },
      resume(sessionId) {
        const trimmedId = sessionId.trim()
        if (trimmedId === '') {
          if (sessionPersistence === undefined) {
            store.setNotice('the session picker is not available in this profile; use /resume <sessionId>')
            return
          }
          store.openResume()
          void loadResumeSessions()
          return
        }
        void resumeSession(trimmedId)
      },
      openResume() {
        if (sessionPersistence === undefined) {
          store.setNotice('the session picker is not available in this profile; use /resume <sessionId>')
          return
        }
        store.openResume()
        void loadResumeSessions()
      },
      closeResume() {
        store.closeOverlay()
      },
      selectResumeRow(index) {
        store.selectResumeRow(index)
      },
      applyResume(id) {
        store.closeOverlay()
        void resumeSession(id)
      },
      cyclePermission() {
        if (permissionPresets === undefined) {
          store.setNotice('permission presets are not available in this profile')
          return
        }
        const names = permissionPresets.names
        if (names.length === 0) return
        const index = names.indexOf(permissionPresets.current(agent.session.events))
        // -1 (the `custom` state) + 1 = 0, so an unmatched current value lands on the first preset.
        permissionPresets.set(agent.session, names[(index + 1) % names.length])
      },
      compact() {
        if (compaction === undefined) {
          store.setNotice('compaction is not available in this profile')
          return
        }
        if (compacting) {
          store.setNotice('compaction is already running')
          return
        }
        compacting = true
        store.setNotice('compacting…')
        void compaction.compactNow(agent, new AbortController().signal)
          .then(result => {
            store.setNotice(result === null ? 'no compactable history yet' : undefined)
          })
          .catch((error: unknown) => {
            const message = error instanceof ManualCompactionError
              ? COMPACTION_ERROR_MESSAGES[error.code]
              : error instanceof Error ? error.message : String(error)
            store.setNotice(`compaction failed: ${message}`)
          })
          .finally(() => { compacting = false })
      },
      rename(title) {
        if (sessionTitle === undefined) {
          store.setNotice('rename is not available in this profile')
          return
        }
        const trimmedTitle = title.trim()
        if (trimmedTitle === '') {
          store.setNotice('Usage: /rename <title>')
          return
        }
        try {
          const accepted = sessionTitle.rename(agent.session, trimmedTitle)
          // No manual store.setTitle here: the sessionProjections 'title'
          // listener wired in attachSession picks up the session/title event
          // this just appended and updates the store reactively.
          store.setNotice(`Renamed to "${accepted.title}".`)
        } catch (error) {
          const message = error instanceof SessionTitleInvalidError
            ? 'title must contain visible characters'
            : error instanceof Error ? error.message : String(error)
          store.setNotice(`rename failed: ${message}`)
        }
      },
      // Mirrors `@deepseek-ai/dsh-plan-mode`'s own `/plan` command handler
      // (its result text is model-facing there; reused here as the notice).
      plan(rawInput) {
        if (planMode === undefined) {
          store.setNotice('plan mode is not available in this profile')
          return
        }
        const message = rawInput.trim()
        if (message === 'off') {
          switch (planMode.set(agent, false)) {
            case 'committed':
              store.setNotice('Plan mode off.')
              return
            case 'queued':
              store.setNotice('Leaving plan mode (applies from the next step).')
              return
            case 'cancelled':
              store.setNotice('Plan mode entry cancelled.')
              return
            case 'noop':
              store.setNotice(foldPlanMode(agent.session.events)
                ? 'Leaving plan mode (applies from the next step).'
                : 'Plan mode is already inactive.')
              return
            default:
              // Defensive: an outcome outside today's known union must still
              // stop here rather than fall through into the "entering plan
              // mode" code below, which would invert an explicit /plan off.
              store.setNotice('Plan mode off.')
              return
          }
        }
        const outcome = planMode.set(agent, true)
        if (message !== '') {
          agent.steer(createUserMessage({ content: [{ type: 'text', text: message }], source: { kind: 'user' } }))
        }
        store.setNotice(outcome === 'committed'
          ? 'Plan mode on. Use /plan off to leave.'
          : 'Entering plan mode (applies from the next step). Use /plan off to leave.')
      },
      // Mirrors `@deepseek-ai/dsh-command-goal`'s own `/goal` command handler
      // (its result text is model-facing there; reused here as the notice).
      goal(command) {
        if (goals === undefined) {
          store.setNotice('goal mode is not available in this profile')
          return
        }
        try {
          const current = goals.get(agent)
          switch (command.kind) {
            case 'show':
              store.setNotice(current === undefined
                ? `No goal is currently set.\n${GOAL_USAGE}`
                : renderGoalNotice('Goal', current))
              return
            case 'invalid-edit':
              store.setNotice(`Goal editing requires a replacement objective.\n${GOAL_USAGE}`)
              return
            case 'create':
              if (current !== undefined && current.phase !== 'complete') {
                store.setNotice(`A goal is already ${goalPhaseLabel(current.phase)}. Use /goal edit <objective> to change it or /goal clear before replacing it.`)
                return
              }
              store.setNotice(renderGoalNotice('Goal created', goals.create(agent, { objective: command.objective })))
              return
            case 'edit':
              if (current === undefined) {
                store.setNotice(goalMissingNotice(command.kind))
                return
              }
              if (current.phase === 'complete') {
                // A completed goal may be replaced by a fresh create, exactly
                // like command-goal's own edit branch.
                store.setNotice(renderGoalNotice('Goal created', goals.create(agent, { objective: command.objective })))
                return
              }
              store.setNotice(renderGoalNotice('Goal updated', goals.edit(agent, goalRef(current), { objective: command.objective })))
              return
            case 'pause':
              if (current === undefined) {
                store.setNotice(goalMissingNotice(command.kind))
                return
              }
              store.setNotice(renderGoalNotice('Goal paused', goals.pause(agent, goalRef(current))))
              return
            case 'resume':
              if (current === undefined) {
                store.setNotice(goalMissingNotice(command.kind))
                return
              }
              store.setNotice(renderGoalNotice('Goal resumed', goals.resume(agent, goalRef(current))))
              return
            case 'clear':
              if (current === undefined) {
                store.setNotice('No goal to clear.')
                return
              }
              goals.clear(agent, goalRef(current))
              store.setNotice('Goal cleared.')
              return
          }
        } catch (error: unknown) {
          if (error instanceof GoalError) {
            store.setNotice('The goal command is not valid for the current state. Run /goal to view available commands.')
            return
          }
          // Degrade like `compact()` does for any error type, rather than
          // crashing the process — e.g. `renderGoalNotice`'s guard against a
          // malformed blocked-goal record throws a plain `TypeError` here.
          store.setNotice(`goal command failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
      ensureFileIndex() {
        void ensureFileIndexLoaded()
      },

      openModelProfile() {
        store.openModelProfile()
        void loadProviders()
      },
      closeModelProfile() {
        store.closeOverlay()
      },
      backToProviderList() {
        store.updateModelProfile({ view: 'list', draft: undefined, discovered: undefined, error: undefined })
      },
      selectProvider(index) {
        store.updateModelProfile({ selected: index })
      },
      createProvider() {
        const formKey = (currentModelProfile()?.formKey ?? 0) + 1
        const draft: ProviderDraft = {
          route: '',
          isNew: true,
          settingsNs: CUSTOM_PROVIDER_NAMESPACE,
          settingsPath: [],
          displayName: '',
          api: '',
          baseURL: '',
          apiKeyRef: '',
          apiKeyConfigured: false,
          apiKeyDraft: '',
          models: [],
          revision: undefined,
        }
        store.updateModelProfile({ view: 'form', draft, discovered: undefined, error: undefined, formKey })
      },
      editProvider(route) {
        const row = currentModelProfile()?.providers?.find(candidate => candidate.route === route)
        if (row === undefined) return
        const formKey = (currentModelProfile()?.formKey ?? 0) + 1
        const draft: ProviderDraft = {
          route: row.route,
          isNew: false,
          settingsNs: row.settingsNs,
          settingsPath: row.settingsPath,
          displayName: row.displayName,
          api: row.api ?? '',
          baseURL: row.baseURL ?? '',
          apiKeyRef: row.apiKeyRef,
          apiKeyConfigured: row.apiKeyConfigured,
          apiKeyDraft: '',
          models: row.models,
          revision: row.revision,
        }
        store.updateModelProfile({ view: 'form', draft, discovered: undefined, error: undefined, formKey })
      },
      saveProvider(draft) {
        void persistProvider(draft)
      },
      deleteProvider(row) {
        void removeProvider(row)
      },
      discoverModelsForDraft(draft) {
        void probeModels(draft)
      },
      setActiveModel(provider, model) {
        void defaultModel
          .saveSelection({ provider, model })
          .then(() => store.setNotice(`default model set to ${provider}/${model}`))
          .catch((error: unknown) => {
            store.setNotice(`failed to set default model: ${error instanceof Error ? error.message : String(error)}`)
          })
      },

      openTrajectory() {
        store.openTrajectory()
      },
      closeTrajectory() {
        store.closeOverlay()
      },
      openToolCards() {
        store.openToolCards()
      },
      closeToolCards() {
        store.closeOverlay()
      },

      openContext() {
        store.openContext()
      },
      closeContext() {
        store.closeOverlay()
      },

      openPlugins() {
        const rows = pluginRows()
        if (rows === undefined) {
          store.setNotice('plugin list is not available in this profile')
          return
        }
        store.openPlugins(rows)
      },
      closePlugins() {
        store.closeOverlay()
      },

      openAgentPresets() {
        if (presets === undefined) {
          store.setNotice('agent presets are not available in this profile')
          return
        }
        store.openAgentPresets({ current: resolveSessionPreset(agent.session), blank: sessionBlank(agent.session) })
        void loadAgentPresets()
      },
      closeAgentPresets() {
        store.closeOverlay()
      },
      selectAgentPresetRow(index) {
        store.selectAgentPresetRow(index)
      },
      applyAgentPreset(id) {
        if (presets === undefined) return
        if (!sessionBlank(agent.session)) {
          store.setNotice('agent preset is fixed once a turn has run')
          return
        }
        store.updateAgentPresets({ busy: true, error: undefined })
        void presets.recompose(agent.ctx, id)
          .then(preset => {
            agent.session.append('agent-preset/selected', { agentPreset: preset.id })
            store.setPreset(currentPresetState(agent.session))
            store.closeOverlay()
          })
          .catch((error: unknown) => {
            store.updateAgentPresets({ busy: false, error: error instanceof Error ? error.message : String(error) })
          })
      },

      answerApproval(outcome) {
        if (activeInteraction?.kind !== 'approval') return
        activeInteraction.settle(outcome)
      },
      answerQuestion(answer) {
        if (activeInteraction?.kind !== 'question') return
        activeInteraction.settle(answer)
      },
    }

    // No manual clear-before-mount write here: `TuiAltScreen` clears the
    // alternate screen itself on entry, so the banner already opens on a
    // fresh page without racing a raw write against the TUI's own paint.
    const instance = mountTui({
      store,
      actions,
      sessionId: String(agent.session.id),
      provider: selection.provider,
      model: selection.model,
      version: readPackageVersion(),
      cwd: abbreviateHome(process.cwd()),
      promptHistory,
      getTool,
      getToolCall: store.getToolCall,
    })
    mounted.instance = instance

    return { agent, store, instance, disposeAgent: dispose, unsubscribers, closing: false }
  }

  let current = await attachSession(config.resume)

  // Fire-and-forget, once per process (not re-run on `/clear`): routes
  // through whichever session's store is current when the registry check
  // resolves, the same "current" closure pattern the approval/question
  // answerers use, so a `/clear` mid-check still lands the hint on screen.
  void checkForUpdate(readPackageName(), readPackageVersion())
    .then(latest => {
      if (latest !== undefined) current.store.setUpdateHint(latest)
    })

  async function shutdown(): Promise<void> {
    if (current.closing) return
    current.closing = true
    current.agent.cancel({ kind: 'user' })
    await current.agent.whenIdle()
    await sessions.flush(current.agent.session)
    current.instance.unmount()
    io.write(`resume with: dsh --profile tui --resume ${stripSessionIdPrefix(String(current.agent.session.id))}\n`)
    io.exit(0)
  }

  /**
   * Flush and tear down `old`'s agent/store/Ink tree so a new one can take
   * over the terminal. Shared by `clearSession` and `resumeSession`, which
   * differ only in what they attach afterward.
   */
  async function detachSession(old: CurrentSession): Promise<void> {
    old.closing = true
    old.agent.cancel({ kind: 'user' })
    await old.agent.whenIdle()
    await sessions.flush(old.agent.session)
    await old.disposeAgent()
    for (const off of old.unsubscribers) off()
    // `preserveScreen: true`: a fresh `TuiAltScreen` immediately re-enters
    // the alternate screen over the same terminal, so the old instance skips
    // flattening its content into scrollback (that's for a real exit, below).
    old.instance.unmount({ preserveScreen: true })
    await old.instance.waitUntilExit()
  }

  /** Flush and drop the live session, then attach a brand-new one in a freshly cleared screen. */
  async function clearSession(): Promise<void> {
    if (current.closing) return
    await detachSession(current)
    current = await attachSession(undefined)
  }

  /**
   * Flush and drop the live session, then attach a persisted session by id
   * in a freshly cleared screen — the interactive counterpart to
   * `dsh --profile tui --resume <sessionId>`.
   *
   * Unlike `clearSession`, attaching can fail (an unknown or malformed id):
   * `attachSession` also mounts the Ink tree, and pi-tui's alternate-screen
   * model doesn't support two live instances at once, so the old session
   * must already be torn down before attempting the new one — there's no
   * cheap way to validate the id first without attaching. A failure here
   * therefore falls back to a brand-new session (matching `clearSession`'s
   * behavior) with a notice explaining why, rather than leaving the TUI
   * without any live session at all.
   */
  async function resumeSession(sessionId: string): Promise<void> {
    if (current.closing) return
    await detachSession(current)
    try {
      current = await attachSession(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      current = await attachSession(undefined)
      current.store.setNotice(`resume failed: ${message}; started a new session instead`)
    }
  }

  // The TUI instance is the effect: plugin disposal must always release stdin.
  ctx.effect(() => () => current.instance.unmount())
}

/**
 * Mount the interactive front door. Requires real TTYs on both stdin and
 * stdout and fails loud instead of silently degrading, so pipes and CI keep
 * using headless mode.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency. Resolved first
  // because every other failure path below (including the TTY check) reports
  // through `io`, which needs `exit` to exist — this one case can't, so it
  // stays a raw throw.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('dsh-tui: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: TuiIo = { write: chunk => internals.stdout.write(chunk), exit }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    io.write('dsh-tui: stdin and stdout must both be TTYs; use `dsh --profile headless` for pipes\n')
    io.exit(1)
    return
  }
  process.once('exit', restoreActiveTerminal)
  const mounted: { instance?: TuiHandle } = {}
  void run(ctx, config, io, mounted).catch((error: unknown) => { fail(io, error, mounted.instance) })
}
