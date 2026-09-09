/**
 * `/model` overlay: provider list, add/edit form, and the form's nested
 * model-catalog editor, as one component. The three used to be three
 * separate Ink components (`ProviderList`/`ProviderForm`/`ModelListEditor`)
 * switched by conditional mounting, with the form's local field state reset
 * via a React `key={formKey}` remount trick. pi-tui has no nested-focus
 * delegation (only one `Component` is ever focused at a time) and no
 * remount-to-reset-state idiom, so this is one class instead: `showModels`
 * picks which of the three views is active, and `syncFormState` reinitializes
 * the form's local fields from the store's draft whenever `formKey` changes
 * — the direct equivalent of the old remount, just explicit.
 * @module @tomowang/dsh-tui/tui/modelProfile/ModelProfileOverlay
 */

import type { Component } from '@earendil-works/pi-tui'
import { Key, matchesKey } from '@earendil-works/pi-tui'
import type { TuiActions } from '../actions.js'
import type { ModelPickerState, ModelProfileOverlayState, TuiStore } from '../store.js'
import { emptyMiniTextField, miniTextFieldInput, renderMiniTextField, type MiniTextFieldState } from '../miniTextField.js'
import { clampModelIndex, type ModelEntry, type ProviderDraft } from './types.js'
import { theme, fg } from '../theme.js'

const bold = (s: string): string => `\x1b[1m${s}\x1b[0m`
const secondary = fg(theme.secondary)
const muted = fg(theme.muted)
const errorColor = fg(theme.error)
const invert = (s: string): string => `\x1b[7m${s}\x1b[0m`

type TextField = 'route' | 'displayName' | 'api' | 'baseURL' | 'apiKey'

export class ModelProfileOverlay implements Component {
  // --- list view: selection lives in the store; only the delete-confirm arm is local ---
  private confirmDelete: number | undefined

  // --- form view: local until Save, reset whenever `formKey` changes ---
  private formKeySeen = -1
  private route: MiniTextFieldState = emptyMiniTextField()
  private displayName: MiniTextFieldState = emptyMiniTextField()
  private api: MiniTextFieldState = emptyMiniTextField()
  private baseURL: MiniTextFieldState = emptyMiniTextField()
  private apiKeyDraft: MiniTextFieldState = emptyMiniTextField()
  private models: ModelEntry[] = []
  private showModels = false
  private focused = 0

  // --- nested model-list editor, valid while `showModels` ---
  private modelDraftId: MiniTextFieldState = emptyMiniTextField()
  private modelSelected = 0
  private modelInputFocused = false

  constructor(
    private readonly store: TuiStore,
    private readonly actions: TuiActions,
  ) {}

  invalidate(): void {}

  private textFields(draft: ProviderDraft): TextField[] {
    return draft.isNew ? ['route', 'displayName', 'api', 'baseURL', 'apiKey'] : ['displayName', 'api', 'baseURL', 'apiKey']
  }

  /** Reinitialize form-local state from the store's draft when `formKey` changes — the equivalent of the old `key={formKey}` remount. */
  private syncFormState(mp: ModelProfileOverlayState): ProviderDraft | undefined {
    if (mp.view !== 'form' || mp.draft === undefined) return undefined
    const draft = mp.draft
    if (mp.formKey !== this.formKeySeen) {
      this.formKeySeen = mp.formKey
      this.route = emptyMiniTextField(draft.route)
      this.displayName = emptyMiniTextField(draft.displayName)
      this.api = emptyMiniTextField(draft.api)
      this.baseURL = emptyMiniTextField(draft.baseURL)
      this.apiKeyDraft = emptyMiniTextField('')
      this.models = [...draft.models]
      this.showModels = false
      this.focused = 0
      this.modelDraftId = emptyMiniTextField()
      this.modelSelected = 0
      this.modelInputFocused = false
    }
    return draft
  }

  private buildDraft(draft: ProviderDraft): ProviderDraft {
    return {
      ...draft,
      route: draft.isNew ? this.route.value.trim() : draft.route,
      displayName: this.displayName.value,
      api: this.api.value,
      baseURL: this.baseURL.value,
      apiKeyDraft: this.apiKeyDraft.value,
      models: this.models,
    }
  }

  render(_width: number): string[] {
    const overlay = this.store.getSnapshot().overlay
    if (overlay.kind !== 'modelProfile') return []
    const mp = overlay.modelProfile
    if (mp.view === 'picker' && mp.picker !== undefined) return this.renderPicker(mp.picker, mp)
    const draft = this.syncFormState(mp)
    if (draft !== undefined) return this.showModels ? this.renderModelListEditor(mp) : this.renderForm(draft, mp)
    return this.renderList(mp)
  }

  private renderList(mp: ModelProfileOverlayState): string[] {
    const { providers, selected, busy, error } = mp
    const lines: string[] = [bold(secondary('Model providers'))]
    if (error !== undefined) lines.push(errorColor(error))
    if (busy && providers === undefined) lines.push(muted('Loading…'))
    providers?.forEach((row, index) => {
      const marker = row.configured ? '● ' : '○ '
      const active = mp.activeModel?.provider === row.route ? ` (active: ${mp.activeModel.model})` : ''
      const noKey = row.apiKeyConfigured ? '' : ' [no api key]'
      const notRegistered = row.live ? '' : ' [not registered]'
      const confirm = this.confirmDelete === index ? ' — press d again to delete' : ''
      const text = `${index === selected ? '› ' : '  '}${marker}${row.displayName}${active}${noKey}${notRegistered}${confirm}`
      lines.push(index === selected ? invert(text) : text)
    })
    if (providers?.length === 0) lines.push(muted('No providers configured yet — press a to add one.'))
    lines.push(muted('↑↓ select · s set active model · enter edit · a add · d delete · esc close'))
    return lines
  }

  private handleListInput(data: string, mp: ModelProfileOverlayState): void {
    const { providers, selected } = mp
    if (matchesKey(data, Key.escape)) {
      this.actions.closeModelProfile()
      return
    }
    if (providers === undefined || providers.length === 0) {
      if (data === 'a') this.actions.createProvider()
      return
    }
    if (matchesKey(data, Key.up)) {
      this.confirmDelete = undefined
      this.actions.selectProvider(Math.max(0, selected - 1))
      return
    }
    if (matchesKey(data, Key.down)) {
      this.confirmDelete = undefined
      this.actions.selectProvider(Math.min(providers.length - 1, selected + 1))
      return
    }
    if (matchesKey(data, Key.enter)) {
      this.actions.editProvider(providers[selected].route)
      return
    }
    if (data === 'a') {
      this.actions.createProvider()
      return
    }
    if (data === 's') {
      this.actions.openModelPicker(providers[selected].route)
      return
    }
    if (data === 'd') {
      if (this.confirmDelete === selected) {
        this.confirmDelete = undefined
        this.actions.deleteProvider(providers[selected])
      } else {
        this.confirmDelete = selected
      }
      return
    }
    this.confirmDelete = undefined
  }

  /**
   * The `s` pane: one provider's model catalog, with the persisted default
   * marked, so choosing among several models isn't limited to `models[0]`.
   */
  private renderPicker(picker: ModelPickerState, mp: ModelProfileOverlayState): string[] {
    const row = mp.providers?.find(candidate => candidate.route === picker.route)
    const models = row?.models ?? []
    const selected = Math.min(picker.selected, Math.max(0, models.length - 1))
    const lines: string[] = [bold(secondary(`Model for ${row?.displayName ?? picker.route}`))]
    if (mp.error !== undefined) lines.push(errorColor(mp.error))
    models.forEach((model, index) => {
      const isActive = mp.activeModel?.provider === picker.route && mp.activeModel.model === model.id
      const marker = isActive ? '● ' : '○ '
      const name = model.name === undefined || model.name === model.id ? '' : ` — ${model.name}`
      const text = `${index === selected ? '› ' : '  '}${marker}${model.id}${name}${isActive ? ' (active)' : ''}`
      lines.push(index === selected ? invert(text) : text)
    })
    if (models.length === 0) lines.push(muted('No models in this provider’s catalog.'))
    lines.push(muted('↑↓ select · enter set active model · esc back'))
    return lines
  }

  private handlePickerInput(data: string, picker: ModelPickerState, mp: ModelProfileOverlayState): void {
    if (matchesKey(data, Key.escape)) {
      this.actions.closeModelPicker()
      return
    }
    const row = mp.providers?.find(candidate => candidate.route === picker.route)
    if (row === undefined || row.models.length === 0) return
    if (matchesKey(data, Key.up)) {
      this.actions.selectModel(picker.selected - 1)
      return
    }
    if (matchesKey(data, Key.down)) {
      this.actions.selectModel(picker.selected + 1)
      return
    }
    if (matchesKey(data, Key.enter)) {
      const model = row.models[clampModelIndex(picker.selected, row.models.length)]
      if (model !== undefined) this.actions.setActiveModel(picker.route, model.id)
    }
  }

  private renderForm(draft: ProviderDraft, mp: ModelProfileOverlayState): string[] {
    const textFields = this.textFields(draft)
    const modelsRow = textFields.length
    const saveRow = textFields.length + 1
    const fieldState: Record<TextField, MiniTextFieldState> = {
      route: this.route,
      displayName: this.displayName,
      api: this.api,
      baseURL: this.baseURL,
      apiKey: this.apiKeyDraft,
    }
    const labels: Record<TextField, string> = {
      route: 'Route',
      displayName: 'Name',
      api: 'Protocol',
      baseURL: 'Base URL',
      apiKey: draft.apiKeyConfigured ? 'API key (set — leave blank to keep)' : 'API key',
    }
    const lines: string[] = [bold(secondary(draft.isNew ? 'Add provider' : `Edit ${draft.displayName || draft.route}`))]
    if (mp.error !== undefined) lines.push(errorColor(mp.error))
    textFields.forEach((field, index) => {
      const isFocused = this.focused === index
      const mask = field === 'apiKey' ? '*' : undefined
      const prefix = `${isFocused ? '› ' : '  '}${labels[field]}: `
      lines.push(`${prefix}${renderMiniTextField(fieldState[field], isFocused, mask)}`)
    })
    const modelsText = `${this.focused === modelsRow ? '› ' : '  '}Models (${this.models.length}) — enter to edit`
    lines.push(this.focused === modelsRow ? invert(modelsText) : modelsText)
    const saveText = `${this.focused === saveRow ? '› ' : '  '}${mp.busy ? 'Saving…' : 'Save'}`
    lines.push(this.focused === saveRow ? invert(saveText) : saveText)
    lines.push(muted('tab/shift+tab move · enter confirm field / activate row · esc cancel'))
    return lines
  }

  private handleFormInput(data: string, draft: ProviderDraft): void {
    const textFields = this.textFields(draft)
    const modelsRow = textFields.length
    const saveRow = textFields.length + 1
    const rowCount = textFields.length + 2
    if (matchesKey(data, Key.escape)) {
      this.actions.backToProviderList()
      return
    }
    if (matchesKey(data, 'shift+tab')) {
      this.focused = (this.focused - 1 + rowCount) % rowCount
      return
    }
    if (matchesKey(data, Key.tab)) {
      this.focused = (this.focused + 1) % rowCount
      return
    }
    if (matchesKey(data, Key.enter) && this.focused === modelsRow) {
      this.showModels = true
      return
    }
    if (matchesKey(data, Key.enter) && this.focused === saveRow) {
      this.actions.saveProvider(this.buildDraft(draft))
      return
    }
    if (matchesKey(data, Key.enter) && this.focused < textFields.length) {
      this.focused = (this.focused + 1) % rowCount
      return
    }
    if (this.focused < textFields.length) {
      const field = textFields[this.focused]
      const fieldState: Record<TextField, MiniTextFieldState> = {
        route: this.route,
        displayName: this.displayName,
        api: this.api,
        baseURL: this.baseURL,
        apiKey: this.apiKeyDraft,
      }
      const next = miniTextFieldInput(fieldState[field], data)
      if (next === undefined) return
      if (field === 'route') this.route = next
      else if (field === 'displayName') this.displayName = next
      else if (field === 'api') this.api = next
      else if (field === 'baseURL') this.baseURL = next
      else this.apiKeyDraft = next
    }
  }

  private renderModelListEditor(mp: ModelProfileOverlayState): string[] {
    const lines: string[] = [bold(secondary('Models'))]
    this.models.forEach((model, index) => {
      const isSelected = !this.modelInputFocused && index === this.modelSelected
      const text = `${isSelected ? '› ' : '  '}${model.id}${model.name === undefined ? '' : ` — ${model.name}`}`
      lines.push(isSelected ? invert(text) : text)
    })
    if (this.models.length === 0) lines.push(muted('No models yet.'))
    lines.push(`${this.modelInputFocused ? '› ' : '  '}Add id: ${renderMiniTextField(this.modelDraftId, this.modelInputFocused)}`)
    if (mp.busy) lines.push(muted('Discovering…'))
    if (mp.discovered !== undefined) {
      if (mp.discovered.length === 0) {
        lines.push(muted('No models discovered.'))
      } else {
        lines.push(muted('Discovered — tab to the id field and type one to adopt it:'))
        for (const model of mp.discovered) lines.push(muted(`  ${model.id}${model.name === undefined ? '' : ` — ${model.name}`}`))
      }
    }
    lines.push(muted('tab toggle list/input · ↑↓ select · x remove · g discover · esc back'))
    return lines
  }

  private addModel(id: string): void {
    const trimmed = id.trim()
    if (trimmed === '' || this.models.some(model => model.id === trimmed)) return
    const overlay = this.store.getSnapshot().overlay
    const discovered = overlay.kind === 'modelProfile' ? overlay.modelProfile.discovered : undefined
    const found = discovered?.find(model => model.id === trimmed)
    this.models = [...this.models, found === undefined ? { id: trimmed } : { ...found }]
    this.modelDraftId = emptyMiniTextField()
  }

  private handleModelListEditorInput(data: string, draft: ProviderDraft): void {
    if (matchesKey(data, Key.escape)) {
      this.showModels = false
      return
    }
    if (matchesKey(data, Key.tab)) {
      this.modelInputFocused = !this.modelInputFocused
      return
    }
    if (this.modelInputFocused) {
      if (matchesKey(data, Key.enter)) {
        this.addModel(this.modelDraftId.value)
        return
      }
      const next = miniTextFieldInput(this.modelDraftId, data)
      if (next !== undefined) this.modelDraftId = next
      return
    }
    if (data === 'g') {
      this.actions.discoverModelsForDraft(this.buildDraft(draft))
      return
    }
    if (this.models.length === 0) return
    if (matchesKey(data, Key.up)) {
      this.modelSelected = clampModelIndex(this.modelSelected - 1, this.models.length)
      return
    }
    if (matchesKey(data, Key.down)) {
      this.modelSelected = clampModelIndex(this.modelSelected + 1, this.models.length)
      return
    }
    if (data === 'x') {
      this.models = this.models.filter((_, index) => index !== this.modelSelected)
      this.modelSelected = clampModelIndex(this.modelSelected, this.models.length)
    }
  }

  handleInput(data: string): void {
    const overlay = this.store.getSnapshot().overlay
    if (overlay.kind !== 'modelProfile') return
    const mp = overlay.modelProfile
    if (mp.view === 'picker' && mp.picker !== undefined) {
      this.handlePickerInput(data, mp.picker, mp)
      return
    }
    const draft = this.syncFormState(mp)
    if (draft !== undefined) {
      if (this.showModels) this.handleModelListEditorInput(data, draft)
      else this.handleFormInput(data, draft)
      return
    }
    this.handleListInput(data, mp)
  }
}
