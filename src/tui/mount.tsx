/**
 * The one non-component JSX call site: mounts `<App>` onto the process
 * streams. Kept separate from `index.ts` so the plugin entry point itself
 * stays a plain `.ts` module.
 * @module @tomowang/dsh-tui/tui/mount
 */

import { render } from 'ink'
import type { Instance } from 'ink'
import { App } from './App.js'
import type { TuiActions } from './App.js'
import type { TuiStore } from './store.js'

export interface MountOptions {
  readonly store: TuiStore
  readonly actions: TuiActions
  readonly sessionId: string
  readonly provider: string
  readonly model: string
  readonly version: string
  readonly cwd: string
  readonly stdout: NodeJS.WriteStream
  readonly stdin: NodeJS.ReadStream
  /** Submitted-line history for the prompt's up/down-arrow recall; owned outside the Ink tree so `/clear` can preserve it. */
  readonly promptHistory: string[]
}

/**
 * Mount the interactive front door.
 * @param options - store/actions bridge plus the streams Ink should own.
 * @returns the Ink instance; unmount it to release stdin.
 */
export function mountTui(options: MountOptions): Instance {
  return render(
    <App
      store={options.store}
      actions={options.actions}
      sessionId={options.sessionId}
      provider={options.provider}
      model={options.model}
      version={options.version}
      cwd={options.cwd}
      // `?? ` alone won't catch it: a size-less pty reports `0`, not `undefined`.
      columns={options.stdout.columns || 80}
      promptHistory={options.promptHistory}
    />,
    {
      stdout: options.stdout,
      stdin: options.stdin,
      // Raw-mode stdin ignores Ctrl+C by default; PromptInput's useInput
      // handler owns cancel-vs-shutdown semantics instead.
      exitOnCtrlC: false,
      // Keep other plugins' console.* output from tearing up the live region.
      patchConsole: true,
    },
  )
}
