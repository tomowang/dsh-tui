/**
 * Durable prompt history for up/down-arrow recall across process restarts:
 * one JSON-encoded line per submitted prompt, appended to a JSONL file under
 * the harness home (`$DSH_HOME/dsh-tui/history.jsonl`). A plain file rather
 * than a settings section — `dsh-settings` now only edits a plugin's own
 * `.volatile()` Config fields, persisted into the profile's Cordis patch,
 * which is no place for an ever-growing list of prompts. Every failure mode
 * degrades to in-memory-only history rather than an error.
 * @module @tomowang/dsh-tui/promptHistory
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Default history file: `$DSH_HOME/dsh-tui/history.jsonl` (`~/.dsh/…` when unset). */
export function defaultPromptHistoryPath(): string {
  return dshHomePath('dsh-tui', 'history.jsonl')
}

/**
 * Read previously submitted lines, oldest first. A missing or unreadable file
 * is an empty history; a malformed line (a torn concurrent append, a
 * hand-edit) is skipped rather than discarding the whole file.
 * @param path - history file to read.
 * @returns the persisted lines, oldest first.
 */
export function loadPromptHistory(path: string): string[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return []
  }
  const entries: string[] = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    try {
      const value = JSON.parse(line) as unknown
      if (typeof value === 'string') entries.push(value)
    } catch {
      // Skip a malformed line; keep the rest.
    }
  }
  return entries
}

/**
 * Best-effort append of one submitted line. A single `O_APPEND` write per
 * entry, so two `dsh-tui` processes appending around the same time interleave
 * whole lines instead of one replacing the other's history.
 * @param path - history file to append to; its directory is created on demand.
 * @param line - the submitted prompt text.
 */
export async function appendPromptHistory(path: string, line: string): Promise<void> {
  try {
    mkdirSync(dirname(path), { recursive: true })
    await appendFile(path, `${JSON.stringify(line)}\n`, 'utf8')
  } catch {
    // Courtesy persistence only: recall still works in memory for this process.
  }
}
