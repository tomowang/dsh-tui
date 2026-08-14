/**
 * Add/edit form for one provider draft: a small parent owning a focused-row
 * index, rendering each field as a live `ink-text-input` only while it holds
 * focus (Tab/Shift+Tab move focus, Enter on a field advances). The trailing
 * "Models" row opens `ModelListEditor` in place; "Save" submits the draft
 * built from local field state up to `ctx.settings`/`ctx.credentials`.
 * @module @tomowang/dsh-tui/tui/modelProfile/ProviderForm
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { TuiActions } from '../PromptInput.js'
import type { DiscoveredModel, ModelEntry, ProviderDraft } from './types.js'
import { ModelListEditor } from './ModelListEditor.js'

export interface ProviderFormProps {
  readonly draft: ProviderDraft
  readonly discovered: readonly DiscoveredModel[] | undefined
  readonly busy: boolean
  readonly error: string | undefined
  readonly actions: TuiActions
}

type TextField = 'route' | 'displayName' | 'api' | 'baseURL' | 'apiKey'

export function ProviderForm({ draft, discovered, busy, error, actions }: ProviderFormProps) {
  const [route, setRoute] = useState(draft.route)
  const [displayName, setDisplayName] = useState(draft.displayName)
  const [api, setApi] = useState(draft.api)
  const [baseURL, setBaseURL] = useState(draft.baseURL)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [models, setModels] = useState<readonly ModelEntry[]>(draft.models)
  const [showModels, setShowModels] = useState(false)
  const [focused, setFocused] = useState(0)

  const textFields: TextField[] = draft.isNew
    ? ['route', 'displayName', 'api', 'baseURL', 'apiKey']
    : ['displayName', 'api', 'baseURL', 'apiKey']
  const modelsRow = textFields.length
  const saveRow = textFields.length + 1
  const rowCount = textFields.length + 2

  function buildDraft(): ProviderDraft {
    return { ...draft, route: draft.isNew ? route.trim() : draft.route, displayName, api, baseURL, apiKeyDraft, models }
  }

  useInput((input, key) => {
    if (showModels) return
    if (key.escape) {
      actions.backToProviderList()
      return
    }
    if (key.tab && key.shift) {
      setFocused(current => (current - 1 + rowCount) % rowCount)
      return
    }
    if (key.tab) {
      setFocused(current => (current + 1) % rowCount)
      return
    }
    if (key.return && focused === modelsRow) {
      setShowModels(true)
      return
    }
    if (key.return && focused === saveRow) {
      actions.saveProvider(buildDraft())
    }
  })

  if (showModels) {
    return (
      <ModelListEditor
        models={models}
        discovered={discovered}
        busy={busy}
        onChange={next => setModels(next)}
        onDiscover={() => actions.discoverModelsForDraft(buildDraft())}
        onClose={() => setShowModels(false)}
      />
    )
  }

  function textRow(field: TextField, label: string, value: string, onChange: (next: string) => void, mask?: string) {
    const index = textFields.indexOf(field)
    const isFocused = focused === index
    return (
      <Box key={field}>
        <Text>
          {isFocused ? '› ' : '  '}
          {label}:{' '}
        </Text>
        <TextInput
          value={value}
          onChange={onChange}
          focus={isFocused}
          mask={mask}
          onSubmit={() => setFocused(current => (current + 1) % rowCount)}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text bold>{draft.isNew ? 'Add provider' : `Edit ${draft.displayName || draft.route}`}</Text>
      {error === undefined ? null : <Text color="red">{error}</Text>}
      {draft.isNew ? textRow('route', 'Route', route, setRoute) : null}
      {textRow('displayName', 'Name', displayName, setDisplayName)}
      {textRow('api', 'Protocol', api, setApi)}
      {textRow('baseURL', 'Base URL', baseURL, setBaseURL)}
      {textRow(
        'apiKey',
        draft.apiKeyConfigured ? 'API key (set — leave blank to keep)' : 'API key',
        apiKeyDraft,
        setApiKeyDraft,
        '*',
      )}
      <Text inverse={focused === modelsRow}>
        {focused === modelsRow ? '› ' : '  '}
        Models ({models.length}) — enter to edit
      </Text>
      <Text inverse={focused === saveRow}>
        {focused === saveRow ? '› ' : '  '}
        {busy ? 'Saving…' : 'Save'}
      </Text>
      <Text dimColor>tab/shift+tab move · enter confirm field / activate row · esc cancel</Text>
    </Box>
  )
}
