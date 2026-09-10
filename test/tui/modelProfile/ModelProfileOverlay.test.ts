import { describe, expect, it, vi } from 'vitest'
import type { TuiActions } from '../../../src/tui/actions.js'
import { ModelProfileOverlay } from '../../../src/tui/modelProfile/ModelProfileOverlay.js'
import type { ProviderDraft, ProviderRow } from '../../../src/tui/modelProfile/types.js'
import { TuiStore } from '../../../src/tui/store.js'

/** Every action is a spy; only the ones a test names are asserted on. */
function stubActions(): TuiActions {
  return {
    send: vi.fn(),
    cancel: vi.fn(),
    shutdown: vi.fn(),
    help: vi.fn(),
    recordHistory: vi.fn(),
    clear: vi.fn(),
    cyclePermission: vi.fn(),
    compact: vi.fn(),
    plan: vi.fn(),
    goal: vi.fn(),
    rename: vi.fn(),
    resume: vi.fn(),
    ensureFileIndex: vi.fn(),
    openModelProfile: vi.fn(),
    closeModelProfile: vi.fn(),
    backToProviderList: vi.fn(),
    selectProvider: vi.fn(),
    createProvider: vi.fn(),
    editProvider: vi.fn(),
    saveProvider: vi.fn(),
    deleteProvider: vi.fn(),
    discoverModelsForDraft: vi.fn(),
    clearModelProfileError: vi.fn(),
    openModelPicker: vi.fn(),
    selectModel: vi.fn(),
    closeModelPicker: vi.fn(),
    setActiveModel: vi.fn(),
    openTrajectory: vi.fn(),
    closeTrajectory: vi.fn(),
    openContext: vi.fn(),
    closeContext: vi.fn(),
    openPlugins: vi.fn(),
    closePlugins: vi.fn(),
    openAgentPresets: vi.fn(),
    closeAgentPresets: vi.fn(),
    selectAgentPresetRow: vi.fn(),
    applyAgentPreset: vi.fn(),
    cycleAgentsStrip: vi.fn(),
    closeAgentDetail: vi.fn(),
    openResume: vi.fn(),
    closeResume: vi.fn(),
    selectResumeRow: vi.fn(),
    applyResume: vi.fn(),
  }
}

function provider(overrides: Partial<ProviderRow>): ProviderRow {
  return {
    route: 'deepseek',
    displayName: 'DeepSeek',
    settingsNs: 'llm-pi-ai',
    settingsPath: ['providers', 'deepseek'],
    configured: true,
    live: true,
    api: 'openai-completions',
    baseURL: undefined,
    apiKeyRef: 'DEEPSEEK_API_KEY',
    apiKeyConfigured: true,
    models: [
      { id: 'deepseek-chat' },
      { id: 'deepseek-reasoner' },
      { id: 'deepseek-flash' },
    ],
    revision: 1,
    ...overrides,
  }
}

/** The overlay embeds ANSI SGR codes around each line; the labels under test stay contiguous inside them. */
const ESC = '\x1b'
const DOWN = '\x1b[B'
const ENTER = '\r'

function openWith(actions: TuiActions, patch: Record<string, unknown>): { overlay: ModelProfileOverlay; store: TuiStore } {
  const store = new TuiStore({ events: [] })
  store.openModelProfile()
  store.updateModelProfile(patch)
  return { overlay: new ModelProfileOverlay(store, actions), store }
}

/** Mirrors `run()`'s `selectModel`: the store's cursor is the source the overlay re-reads each input. */
function wireSelectModel(store: TuiStore, actions: TuiActions): void {
  vi.mocked(actions.selectModel).mockImplementation((index: number) => {
    const overlay = store.getSnapshot().overlay
    if (overlay.kind !== 'modelProfile' || overlay.modelProfile.picker === undefined) return
    const picker = overlay.modelProfile.picker
    const row = overlay.modelProfile.providers?.find(candidate => candidate.route === picker.route)
    const clamped = Math.max(0, Math.min((row?.models.length ?? 1) - 1, index))
    store.updateModelProfile({ picker: { ...picker, selected: clamped } })
  })
}

function pickerSelected(store: TuiStore): number | undefined {
  const overlay = store.getSnapshot().overlay
  return overlay.kind === 'modelProfile' ? overlay.modelProfile.picker?.selected : undefined
}

describe('ModelProfileOverlay model picker', () => {
  it('renders every catalog model, marking the active one', () => {
    const actions = stubActions()
    const { overlay } = openWith(actions, {
      providers: [provider({})],
      activeModel: { provider: 'deepseek', model: 'deepseek-flash' },
      view: 'picker',
      picker: { route: 'deepseek', selected: 2 },
    })

    const lines = overlay.render(80)

    expect(lines.some(line => line.includes('Model for DeepSeek'))).toBe(true)
    expect(lines.some(line => line.includes('deepseek-chat'))).toBe(true)
    expect(lines.some(line => line.includes('deepseek-reasoner'))).toBe(true)
    expect(lines.some(line => /● deepseek-flash.*\(active\)/.test(line))).toBe(true)
    // A non-active model keeps the hollow marker.
    expect(lines.some(line => /○ deepseek-chat/.test(line))).toBe(true)
  })

  it('moves the cursor and activates the highlighted model on enter', () => {
    const actions = stubActions()
    const { overlay, store } = openWith(actions, {
      providers: [provider({})],
      activeModel: { provider: 'deepseek', model: 'deepseek-chat' },
      view: 'picker',
      picker: { route: 'deepseek', selected: 0 },
    })
    wireSelectModel(store, actions)

    overlay.handleInput(DOWN)
    expect(actions.selectModel).toHaveBeenLastCalledWith(1)

    overlay.handleInput(ENTER)
    expect(actions.setActiveModel).toHaveBeenCalledWith('deepseek', 'deepseek-reasoner')
  })

  it('clamps the selection at the catalog bounds', () => {
    // The overlay hands the raw adjacent index to `selectModel` and relies on
    // that action (shared with `openModelPicker`) to clamp — see
    // `clampModelIndex` in modelProfile/types.ts — so this asserts the
    // settled store state rather than the overlay pre-clamping its own call.
    const actions = stubActions()
    const { overlay, store } = openWith(actions, {
      providers: [provider({})],
      view: 'picker',
      picker: { route: 'deepseek', selected: 0 },
    })
    wireSelectModel(store, actions)

    overlay.handleInput('\x1b[A') // up at the top
    expect(actions.selectModel).toHaveBeenLastCalledWith(-1)
    expect(pickerSelected(store)).toBe(0)

    overlay.handleInput(DOWN)
    overlay.handleInput(DOWN)
    overlay.handleInput(DOWN) // past the last entry

    expect(actions.selectModel).toHaveBeenLastCalledWith(3)
    expect(pickerSelected(store)).toBe(2)
  })

  it('returns to the provider list on escape without changing the selection', () => {
    const actions = stubActions()
    const { overlay } = openWith(actions, {
      providers: [provider({})],
      view: 'picker',
      picker: { route: 'deepseek', selected: 1 },
    })

    overlay.handleInput(ESC)

    expect(actions.closeModelPicker).toHaveBeenCalledTimes(1)
    expect(actions.setActiveModel).not.toHaveBeenCalled()
  })

  it('opens the picker from the provider list on s', () => {
    const actions = stubActions()
    const { overlay } = openWith(actions, {
      providers: [provider({})],
      activeModel: { provider: 'deepseek', model: 'deepseek-flash' },
    })

    overlay.handleInput('s')

    expect(actions.openModelPicker).toHaveBeenCalledWith('deepseek')
  })

  it('shows the active model next to its provider in the list', () => {
    const actions = stubActions()
    const { overlay } = openWith(actions, {
      providers: [provider({})],
      activeModel: { provider: 'deepseek', model: 'deepseek-flash' },
    })

    const lines = overlay.render(80)

    expect(lines.some(line => line.includes('(active: deepseek-flash)'))).toBe(true)
  })

  it('flags a configured provider that is not registered as live', () => {
    const actions = stubActions()
    const { overlay } = openWith(actions, {
      providers: [provider({ live: false, apiKeyConfigured: false })],
      activeModel: { provider: 'deepseek', model: 'deepseek-flash' },
    })

    const lines = overlay.render(80)

    expect(lines.some(line => line.includes('[no api key] [not registered]'))).toBe(true)
  })
})

describe('ModelProfileOverlay models editor', () => {
  const TAB = '\t'

  function draft(): ProviderDraft {
    return {
      route: 'deepseek',
      isNew: false,
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'deepseek'],
      displayName: 'DeepSeek',
      api: 'openai-completions',
      baseURL: 'https://api.deepseek.com',
      apiKeyRef: 'DEEPSEEK_API_KEY',
      apiKeyConfigured: true,
      apiKeyDraft: '',
      models: [{ id: 'deepseek-chat' }],
      revision: 1,
    }
  }

  /** Tab off the last text field onto the `Models` row, then open the editor. */
  function openModelsEditor(overlay: ModelProfileOverlay): void {
    for (let index = 0; index < 4; index += 1) overlay.handleInput(TAB)
    overlay.handleInput(ENTER)
  }

  it('renders a discovery error inside the editor, where `g` was pressed', () => {
    const actions = stubActions()
    const { overlay, store } = openWith(actions, {
      providers: [provider({})],
      view: 'form',
      draft: draft(),
    })
    openModelsEditor(overlay)

    store.updateModelProfile({ error: 'no model discovery is registered for "llm-deepseek"' })

    expect(overlay.render(80).some(line => line.includes('no model discovery is registered'))).toBe(true)
  })

  it('triggers discovery for the draft on g', () => {
    const actions = stubActions()
    const { overlay } = openWith(actions, {
      providers: [provider({})],
      view: 'form',
      draft: draft(),
    })
    openModelsEditor(overlay)

    overlay.handleInput('g')

    expect(actions.discoverModelsForDraft).toHaveBeenCalledTimes(1)
  })

  it('clears a stale error when backing out to the form', () => {
    const actions = stubActions()
    const { overlay } = openWith(actions, {
      providers: [provider({})],
      view: 'form',
      draft: draft(),
    })
    openModelsEditor(overlay)
    vi.mocked(actions.clearModelProfileError).mockClear()

    overlay.handleInput(ESC)

    expect(actions.clearModelProfileError).toHaveBeenCalledTimes(1)
  })

  it('clears a stale error when entering the editor', () => {
    const actions = stubActions()
    const { overlay } = openWith(actions, {
      providers: [provider({})],
      view: 'form',
      draft: draft(),
    })

    openModelsEditor(overlay)

    expect(actions.clearModelProfileError).toHaveBeenCalledTimes(1)
  })
})
