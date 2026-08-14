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
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
// Empty type imports carry the loader Context merge for the mount await
// and the cmdline Context merge for the appExit host value.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type { Instance } from 'ink'

import { TuiStore } from './tui/store.js'
import type { ModelProfileOverlayState } from './tui/store.js'
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
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while settlement is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return
  // Not every profile mounts these — the `/model` overlay degrades to an error
  // notice instead of the whole TUI refusing to start, so they stay outside
  // `inject` and are re-checked at the point of use.
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  const llm = ctx.get('llm')

  const selection = defaultModel.currentSelection()
  const sessionId = SessionId(config.resume ?? `session-${randomUUID()}`)
  const { agent } = await agents.create({
    sessionId,
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await agent.whenIdle()

  // Seed the store from persisted history, then follow the same log live; the
  // store's seq boundary keeps one rendering pass per event across replay and
  // live phases, and `--resume` starts with any pending inbox already shown.
  const store = new TuiStore({ events: agent.session.events })
  store.setStatus(agent.status)
  store.setQueued([...agent.inbox.nextStep, ...agent.inbox.nextTurn])

  ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    store.appendEvent(event)
  })
  ctx.on('agent/status', (payload) => {
    if (payload.agent !== agent) return
    store.setStatus(payload.status)
  })
  const resnapshotQueue = (): void => {
    store.setQueued([...agent.inbox.nextStep, ...agent.inbox.nextTurn])
  }
  ctx.on('agent/inbox/inserted', (payload) => {
    if (payload.agent !== agent) return
    resnapshotQueue()
  })
  ctx.on('agent/inbox/claimed', (payload) => {
    if (payload.agent !== agent) return
    resnapshotQueue()
  })
  ctx.on('agent/inbox/discarded', (payload) => {
    if (payload.agent !== agent) return
    resnapshotQueue()
  })

  let closing = false
  async function shutdown(): Promise<void> {
    if (closing) return
    closing = true
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    await sessions?.flush(agent.session)
    instance.unmount()
    io.exit(0)
  }

  /** Guard for the three optional model-profile services, together or not at all. */
  function requireModelProfileServices():
    | { settings: NonNullable<typeof settings>; credentials: NonNullable<typeof credentials>; llm: NonNullable<typeof llm> }
    | undefined {
    if (settings === undefined || credentials === undefined || llm === undefined) return undefined
    return { settings, credentials, llm }
  }

  /** The open `/model` overlay's sub-state, or `undefined` while it's closed. */
  function currentModelProfile(): ModelProfileOverlayState | undefined {
    const overlay = store.getSnapshot().overlay
    return overlay.kind === 'modelProfile' ? overlay.modelProfile : undefined
  }

  /** Re-join `ctx.llm`'s provider directory with `ctx.settings`/`ctx.credentials` and refresh the list. */
  async function loadProviders(): Promise<void> {
    const services = requireModelProfileServices()
    if (services === undefined) {
      store.updateModelProfile({
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
    store.updateModelProfile({
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
      store.updateModelProfile({ error: 'Route is required.' })
      return
    }
    store.updateModelProfile({ busy: true, error: undefined })
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
      store.updateModelProfile({ view: 'list', draft: undefined })
      await loadProviders()
    } catch (error) {
      store.updateModelProfile({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Unset a provider's credential, then its settings section, and reload the list. */
  async function removeProvider(row: ProviderRow): Promise<void> {
    const services = requireModelProfileServices()
    if (services === undefined) return
    store.updateModelProfile({ busy: true, error: undefined })
    try {
      await services.credentials.unset(credentialRef(row.apiKeyRef))
      await services.settings.mutate(settingsNamespace(row.settingsNs), [{ op: 'unset', path: row.settingsPath }], row.revision)
      await loadProviders()
    } catch (error) {
      store.updateModelProfile({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

  /** Probe a draft's endpoint (or its adapter's own catalog knowledge) for available models. */
  async function probeModels(draft: ProviderDraft): Promise<void> {
    const services = requireModelProfileServices()
    if (services === undefined) return
    store.updateModelProfile({ busy: true, error: undefined })
    try {
      const results = await services.llm.discoverModels(draft.isNew ? CUSTOM_PROVIDER_NAMESPACE : draft.settingsNs, {
        provider: draft.isNew ? undefined : draft.route,
        baseURL: draft.baseURL === '' ? undefined : draft.baseURL,
        api: draft.api === '' ? undefined : draft.api,
        apiKey: draft.apiKeyDraft === '' ? undefined : draft.apiKeyDraft,
      })
      store.updateModelProfile({ discovered: results, busy: false })
    } catch (error) {
      store.updateModelProfile({ busy: false, error: error instanceof Error ? error.message : String(error) })
    }
  }

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
  })
  mounted.instance = instance
  // The Ink instance is the effect: plugin disposal must always release stdin.
  ctx.effect(() => () => instance.unmount())
}

/**
 * Mount the interactive front door. Requires real TTYs on both stdin and
 * stdout and fails loud instead of silently degrading, so pipes and CI keep
 * using headless mode.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup config.
 */
export function apply(ctx: Context, config: Config): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('dsh-tui: stdin and stdout must both be TTYs; use `dsh --profile headless` for pipes')
  }
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('dsh-tui: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: TuiIo = { write: chunk => internals.stdout.write(chunk), exit }
  const mounted: { instance?: Instance } = {}
  void run(ctx, config, io, mounted).catch((error: unknown) => { fail(io, error, mounted.instance) })
}
