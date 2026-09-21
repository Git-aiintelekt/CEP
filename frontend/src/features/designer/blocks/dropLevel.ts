import type { CepBlock } from './types'

export type DropLevel = 'section' | 'column'

/** Where a block belongs: its own mj-section, or inside somebody else's mj-column. */
export function dropLevel(block: CepBlock): DropLevel {
  return /^\s*<mj-section[\s>]/.test(block.mjml) ? 'section' : 'column'
}
