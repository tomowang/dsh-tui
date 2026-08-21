/**
 * Best-effort startup check for a newer npm-published version of this
 * package, so a long-running interactive session can nudge the reader
 * towards `dsh plugin --profile tui add @tomowang/dsh-tui` instead of
 * silently drifting behind. Fire-and-forget from `src/index.ts`: any
 * network failure or timeout resolves to `undefined` rather than throwing,
 * since this is a courtesy nudge, not a required startup step.
 * @module @tomowang/dsh-tui/updateCheck
 */

const REGISTRY_TIMEOUT_MS = 2000

/**
 * Compares plain `X.Y.Z` version strings numerically, part by part. Not a
 * full semver parser — this repo only ever publishes plain dotted-numeric
 * releases (see `## Releasing` in AGENTS.md) — so a pre-release/build
 * suffix on either side just falls back to `0` for that part's non-numeric
 * tail rather than being compared lexically.
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const toParts = (v: string): number[] => v.split('.').map(part => Number.parseInt(part, 10) || 0)
  const a = toParts(candidate)
  const b = toParts(current)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff > 0
  }
  return false
}

export interface CheckForUpdateOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
}

/**
 * Fetches `name`'s `latest` dist-tag from the public npm registry and
 * returns it when newer than `currentVersion`, `undefined` otherwise —
 * including on a non-2xx response, a malformed body, a timeout, or any
 * other network error.
 */
export async function checkForUpdate(
  name: string,
  currentVersion: string,
  options: CheckForUpdateOptions = {},
): Promise<string | undefined> {
  const { fetchImpl = fetch, timeoutMs = REGISTRY_TIMEOUT_MS } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${name}/latest`, { signal: controller.signal })
    if (!response.ok) return undefined
    const data: unknown = await response.json()
    const latest = typeof data === 'object' && data !== null && 'version' in data && typeof data.version === 'string'
      ? data.version
      : undefined
    return latest !== undefined && isNewerVersion(latest, currentVersion) ? latest : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}
