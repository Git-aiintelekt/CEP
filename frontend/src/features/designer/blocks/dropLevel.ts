import type { CepBlock } from './types'

export type DropLevel = 'section' | 'column'

/** Where a block belongs: beside the sections (a section, a wrapper, raw HTML), or inside somebody else's mj-column. */
export function dropLevel(block: CepBlock): DropLevel {
  return /^\s*<mj-(section|wrapper|raw)[\s>]/.test(block.mjml) ? 'section' : 'column'
}
