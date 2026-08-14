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
  return <Text>{buildBannerText({ version, provider, model, cwd }, columns)}</Text>
}
