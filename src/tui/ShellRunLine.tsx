/**
 * Rendering for local shell-escape runs (`!` prompt-mode): a settled
 * `ShellRunLine` for the permanent `<Static>` transcript (mirroring
 * `EventLine`), and a `LiveShellRunLine` for the mutable region below it
 * while the command is still running (mirroring `StreamingLine`).
 * @module @tomowang/dsh-tui/tui/ShellRunLine
 */

import { Text } from 'ink'
import { formatShellRun, formatShellRunLive } from '../render.js'
import type { ShellRunRecord, ShellRunState } from './store.js'

export interface ShellRunLineProps {
  readonly run: ShellRunRecord
}

export function ShellRunLine({ run }: ShellRunLineProps) {
  return <Text>{formatShellRun(run.command, run.output, run.exitCode)}</Text>
}

export interface LiveShellRunLineProps {
  readonly run: ShellRunState | undefined
}

export function LiveShellRunLine({ run }: LiveShellRunLineProps) {
  if (run === undefined) return null
  return <Text>{formatShellRunLive(run.command, run.output)}</Text>
}
