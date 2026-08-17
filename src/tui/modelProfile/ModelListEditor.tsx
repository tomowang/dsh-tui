/**
 * Nested editor for one provider draft's model catalog: manual add/remove of
 * `{id, name, contextWindow, maxTokens}` rows, or probing the endpoint via
 * `ctx.llm.discoverModels` and typing a discovered id to adopt it. Tab moves
 * focus between the row list and the "Add id" field so the list's
 * single-letter shortcuts never collide with characters typed into it.
 * @module @tomowang/dsh-tui/tui/modelProfile/ModelListEditor
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { DiscoveredModel, ModelEntry } from './types.js'
import { theme } from '../theme.js'

export interface ModelListEditorProps {
  readonly models: readonly ModelEntry[]
  readonly discovered: readonly DiscoveredModel[] | undefined
  readonly busy: boolean
  readonly onChange: (models: ModelEntry[]) => void
  readonly onDiscover: () => void
  readonly onClose: () => void
}

export function ModelListEditor({ models, discovered, busy, onChange, onDiscover, onClose }: ModelListEditorProps) {
  const [draftId, setDraftId] = useState('')
  const [selected, setSelected] = useState(0)
  const [inputFocused, setInputFocused] = useState(false)

  useInput((input, key) => {
    if (key.escape) {
      onClose()
      return
    }
    if (key.tab) {
      setInputFocused(current => !current)
      return
    }
    if (inputFocused) return
    if (input === 'g') {
      onDiscover()
      return
    }
    if (models.length === 0) return
    if (key.upArrow) {
      setSelected(current => Math.max(0, current - 1))
      return
    }
    if (key.downArrow) {
      setSelected(current => Math.min(models.length - 1, current + 1))
      return
    }
    if (input === 'x') {
      onChange(models.filter((_, index) => index !== selected))
      setSelected(current => Math.max(0, Math.min(current, models.length - 2)))
    }
  })

  function addModel(id: string): void {
    const trimmed = id.trim()
    if (trimmed === '' || models.some(model => model.id === trimmed)) return
    const found = discovered?.find(model => model.id === trimmed)
    onChange([...models, found === undefined ? { id: trimmed } : { ...found }])
    setDraftId('')
  }

  return (
    <Box flexDirection="column">
      <Text bold color={theme.secondary}>Models</Text>
      {models.map((model, index) => (
        <Text key={model.id} inverse={!inputFocused && index === selected}>
          {!inputFocused && index === selected ? '› ' : '  '}
          {model.id}
          {model.name === undefined ? '' : ` — ${model.name}`}
        </Text>
      ))}
      {models.length === 0 ? <Text color={theme.muted}>No models yet.</Text> : null}
      <Box>
        <Text>{inputFocused ? '› ' : '  '}Add id: </Text>
        <TextInput value={draftId} onChange={setDraftId} onSubmit={addModel} focus={inputFocused} />
      </Box>
      {busy ? <Text color={theme.muted}>Discovering…</Text> : null}
      {discovered === undefined ? null : discovered.length === 0 ? (
        <Text color={theme.muted}>No models discovered.</Text>
      ) : (
        <Box flexDirection="column">
          <Text color={theme.muted}>Discovered — tab to the id field and type one to adopt it:</Text>
          {discovered.map(model => (
            <Text key={model.id} color={theme.muted}>
              {'  '}
              {model.id}
              {model.name === undefined ? '' : ` — ${model.name}`}
            </Text>
          ))}
        </Box>
      )}
      <Text color={theme.muted}>tab toggle list/input · ↑↓ select · x remove · g discover · esc back</Text>
    </Box>
  )
}
