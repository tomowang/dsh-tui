/**
 * Arrow-key list of configured and configurable LLM provider routes, opened
 * by `/model`. Enter edits, `a` starts a new custom provider, `d` deletes
 * (pressed twice to confirm), `s` activates a provider's first model, Esc
 * closes the overlay.
 * @module @tomowang/dsh-tui/tui/modelProfile/ProviderList
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import type { TuiActions } from '../PromptInput.js'
import type { ModelProfileOverlayState } from '../store.js'

export interface ProviderListProps {
  readonly modelProfile: ModelProfileOverlayState
  readonly actions: TuiActions
}

export function ProviderList({ modelProfile, actions }: ProviderListProps) {
  const { providers, selected, busy, error } = modelProfile
  const [confirmDelete, setConfirmDelete] = useState<number | undefined>(undefined)

  useInput((input, key) => {
    if (key.escape) {
      actions.closeModelProfile()
      return
    }
    if (providers === undefined || providers.length === 0) {
      if (input === 'a') actions.createProvider()
      return
    }
    if (key.upArrow) {
      setConfirmDelete(undefined)
      actions.selectProvider(Math.max(0, selected - 1))
      return
    }
    if (key.downArrow) {
      setConfirmDelete(undefined)
      actions.selectProvider(Math.min(providers.length - 1, selected + 1))
      return
    }
    if (key.return) {
      actions.editProvider(providers[selected].route)
      return
    }
    if (input === 'a') {
      actions.createProvider()
      return
    }
    if (input === 's') {
      const row = providers[selected]
      const model = row.models[0]
      if (model !== undefined) actions.setActiveModel(row.route, model.id)
      return
    }
    if (input === 'd') {
      if (confirmDelete === selected) {
        setConfirmDelete(undefined)
        actions.deleteProvider(providers[selected])
      } else {
        setConfirmDelete(selected)
      }
      return
    }
    setConfirmDelete(undefined)
  })

  return (
    <Box flexDirection="column">
      <Text bold>Model providers</Text>
      {error === undefined ? null : <Text color="red">{error}</Text>}
      {busy && providers === undefined ? <Text dimColor>Loading…</Text> : null}
      {providers?.map((row, index) => (
        <Text key={row.route} inverse={index === selected}>
          {index === selected ? '› ' : '  '}
          {row.configured ? '● ' : '○ '}
          {row.displayName}
          {row.live ? ' (active)' : ''}
          {row.apiKeyConfigured ? '' : ' [no api key]'}
          {confirmDelete === index ? ' — press d again to delete' : ''}
        </Text>
      ))}
      {providers?.length === 0 ? <Text dimColor>No providers configured yet — press a to add one.</Text> : null}
      <Text dimColor>↑↓ select · enter edit · a add · d delete · s set active model · esc close</Text>
    </Box>
  )
}
