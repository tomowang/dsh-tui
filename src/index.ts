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

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { ManualCompactionError } from '@deepseek-ai/dsh-compaction'
import type { ManualCompactionErrorCode } from '@deepseek-ai/dsh-compaction'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp, SettingsScope } from '@deepseek-ai/dsh-settings'
// Empty type imports carry the loader Context merge for the mount await,
// the cmdline Context merge for the appExit host value, the
// permission-presets Context merge for ctx.permissionPresets, and the
// sandbox-policy/user-approval SessionEventMap merges for the 'sandbox/mode'
// and 'approval/policy' event types the permission-preset knobs write.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
// Type-only: resolves ctx.sessionProjections and its sessionStats/tokenUsage
// SessionProjectionMap entries for the status bar's stats line.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { Instance } from 'ink'

import { TuiStore } from './tui/store.js'
import type { ModelProfileOverlayState, PermissionState, StatsSnapshot } from './tui/store.js'
import { mountTui } from './tui/mount.js'
import type { TuiActions } from './tui/App.js'
import { readPackageVersion } from './version.js'
import type { ProviderDraft, ProviderRow, StoredProviderProfile } from './tui/modelProfile/types.js'

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

/** Short, user-facing text for each `ManualCompactionError` code, mirroring the harness's `command-compact` plugin. */
const COMPACTION_ERROR_MESSAGES: Record<ManualCompactionErrorCode, string> = {
  busy: 'compaction is unavailable while another compaction is running, or the agent is not idle',
  cancelled: 'compaction cancelled',
  changed: 'the selected history changed before it could be replaced; the conversation is unchanged',
  summary: 'compaction could not produce a useful summary; the conversation is unchanged',
  commit: 'compaction did not finish cleanly; some session history may have changed',
  persistence: 'compaction finished, but the session could not be saved',
}

/** Plugin config: startup values resolved from this app's provider service. */
export interface Config {
  /** Session id to resume; absent starts a fresh session. */
  resume?: string
}

export const Config: z<Config> = z.object({
  resume: z.string(),
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
function fail(io: TuiIo, error: unknown, instance: Instance | undefined): void {
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
 * @param mounted - written once Ink mounts, so a later rejection can unmount before reporting.
 */
async function run(ctx: Context, config: Config, io: TuiIo, mounted: { instance?: Instance }): Promise<void> {
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

  /** The session's current permission preset, or `undefined` without a mounted service. */
  function permissionState(events: readonly SessionEvent[]): PermissionState | undefined {
    if (permissionPresets === undefined) return undefined
    return { current: permissionPresets.current(events), names: permissionPresets.names }
  }

  /** The session's current stats-line figures, or empty sides without a mounted registry/unit. */
  function statsSnapshot(session: Session): StatsSnapshot {
    if (sessionProjections === undefined) {
      return { sessionStats: undefined, tokenUsage: undefined, contextPressure: undefined, contextBreakdown: undefined }
    }
    const { values } = sessionProjections.snapshot(session)
    return {
      sessionStats: values.sessionStats,
      tokenUsage: values.tokenUsage,
      contextPressure: values.contextPressure,
      contextBreakdown: values.contextBreakdown,
    }
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

  /** One live agent/session/UI wiring; replaced wholesale by `clearSession()`. */
  interface CurrentSession {
    readonly agent: Agent
    readonly store: TuiStore
    readonly instance: Instance
    /** From `AgentHandle.dispose`: stops the loop and drops it from the live session store (not disk). */
    readonly disposeAgent: () => Promise<void>
    readonly unsubscribers: readonly (() => unknown)[]
    closing: boolean
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
    const setup = (agentCtx: Context): void => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
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
      ? await agents.resume({ resumeSessionId: SessionId(resumeId), agentOptions, setup })
      : await agents.create({ sessionId: SessionId(`session-${randomUUID()}`), meta: { cwd: process.cwd() }, agentOptions, setup })
    await agent.whenIdle()

    // Seed the store from persisted history, then follow the same log live; the
    // store's seq boundary keeps one rendering pass per event across replay and
    // live phases, and `--resume` starts with any pending inbox already shown.
    const store = new TuiStore({ events: agent.session.events })
    store.setStatus(agent.status)
    store.setQueued([...agent.inbox.nextStep, ...agent.inbox.nextTurn])
    store.setPermission(permissionState(agent.session.events))
    store.setStats(statsSnapshot(agent.session))

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
        if (key !== 'sessionStats' && key !== 'tokenUsage' && key !== 'contextPressure' && key !== 'contextBreakdown') return
        store.setStats(statsSnapshot(agent.session))
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
      shutdown() {
        void shutdown()
      },
      status() {
        store.setNotice(`session ${String(agent.session.id)} · ${agent.status} · ${agent.session.events.length} logged events`)
      },
      recordHistory: persistHistory,
      clear() {
        void clearSession()
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

      openContext() {
        store.openContext()
      },
      closeContext() {
        store.closeOverlay()
      },
    }

    // Clear the screen before Ink takes over so the banner opens on a fresh page.
    internals.stdout.write('\x1b[2J\x1b[3J\x1b[H')

    const instance = mountTui({
      store,
      actions,
      sessionId: String(agent.session.id),
      provider: selection.provider,
      model: selection.model,
      version: readPackageVersion(),
      cwd: abbreviateHome(process.cwd()),
      stdout: internals.stdout,
      stdin: process.stdin,
      promptHistory,
    })
    mounted.instance = instance

    return { agent, store, instance, disposeAgent: dispose, unsubscribers, closing: false }
  }

  let current = await attachSession(config.resume)

  async function shutdown(): Promise<void> {
    if (current.closing) return
    current.closing = true
    current.agent.cancel({ kind: 'user' })
    await current.agent.whenIdle()
    await sessions.flush(current.agent.session)
    current.instance.unmount()
    io.write(`resume with: dsh --profile tui --resume ${String(current.agent.session.id)}\n`)
    io.exit(0)
  }

  /** Flush and drop the live session, then attach a brand-new one in a freshly cleared screen. */
  async function clearSession(): Promise<void> {
    if (current.closing) return
    const old = current
    old.closing = true
    old.agent.cancel({ kind: 'user' })
    await old.agent.whenIdle()
    await sessions.flush(old.agent.session)
    await old.disposeAgent()
    for (const off of old.unsubscribers) off()
    old.instance.unmount()
    // Ink's own raw-mode teardown (from the old PromptInput's `useInput` cleanup)
    // is scheduled via a passive-effect flush and a nested microtask, not run
    // synchronously by `unmount()` — mounting the new instance before that
    // settles lets the old instance's deferred `stdin.setRawMode(false)` clobber
    // the new instance's raw mode right after it enables it, so arrow keys (and
    // all other input) stop working post-`/clear`. Waiting for exit here
    // serializes teardown before the new instance takes over stdin.
    await old.instance.waitUntilExit()
    current = await attachSession(undefined)
  }

  // The Ink instance is the effect: plugin disposal must always release stdin.
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
  const mounted: { instance?: Instance } = {}
  void run(ctx, config, io, mounted).catch((error: unknown) => { fail(io, error, mounted.instance) })
}
