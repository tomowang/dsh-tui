/**
 * Thin Ink wrapper around the hand-rolled banner text builder.
 * @module @tomowang/dsh-tui/tui/Banner
 */

import { Text } from 'ink'
import { buildBannerText } from './bannerText.js'

export interface BannerProps {
  readonly version: string
  readonly provider: string
  readonly model: string
  readonly cwd: string
  readonly columns: number
}

export function Banner({ version, provider, model, cwd, columns }: BannerProps) {
  // buildBannerText embeds its own 24-bit ANSI colors (title, dim rows, the
  // chafa-rendered logo) — wrapping it in another Ink `color` would nest a
  // chalk-applied SGR code around a string that already contains `\x1b[0m`
  // resets, which terminate the outer color partway through the line.
  return <Text>{buildBannerText({ version, provider, model, cwd }, columns)}</Text>
}
