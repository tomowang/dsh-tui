/**
 * Top-level `/model` overlay: swaps between the provider list and the
 * add/edit form based on the store's `overlay.modelProfile.view`, keyed on
 * `formKey` so a fresh `editProvider`/`createProvider` always remounts the
 * form with clean local state instead of reusing a stale draft's inputs.
 * @module @tomowang/dsh-tui/tui/modelProfile/ModelProfileOverlay
 */

import { Box } from 'ink'
import type { TuiActions } from '../PromptInput.js'
import type { ModelProfileOverlayState } from '../store.js'
import { ProviderList } from './ProviderList.js'
import { ProviderForm } from './ProviderForm.js'

export interface ModelProfileOverlayProps {
  readonly modelProfile: ModelProfileOverlayState
  readonly actions: TuiActions
}

export function ModelProfileOverlay({ modelProfile, actions }: ModelProfileOverlayProps) {
  return (
    <Box flexDirection="column">
      {modelProfile.view === 'form' && modelProfile.draft !== undefined ? (
        <ProviderForm
          key={modelProfile.formKey}
          draft={modelProfile.draft}
          discovered={modelProfile.discovered}
          busy={modelProfile.busy}
          error={modelProfile.error}
          actions={actions}
        />
      ) : (
        <ProviderList modelProfile={modelProfile} actions={actions} />
      )}
    </Box>
  )
}
