/**
 * Reads this package's own version from `package.json` at runtime. A
 * TS-level JSON import doesn't fit cleanly here (`tsconfig.json` has no
 * `resolveJsonModule`, and `package.json` sits outside `rootDir: src`), so
 * this sidesteps the TS module graph with a plain `fs` read instead.
 * @module @tomowang/dsh-tui/version
 */

import { readFileSync } from 'node:fs'

function readPackageJson(): { name: string; version: string } {
  const url = new URL('../package.json', import.meta.url)
  return JSON.parse(readFileSync(url, 'utf8')) as { name: string; version: string }
}

/** @returns the version field from this package's `package.json`. */
export function readPackageVersion(): string {
  return readPackageJson().version
}

/** @returns the name field from this package's `package.json` (its npm registry identity, e.g. for an update check). */
export function readPackageName(): string {
  return readPackageJson().name
}
