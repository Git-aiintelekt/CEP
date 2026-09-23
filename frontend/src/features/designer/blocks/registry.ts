/** The palette: every block the editor offers, in the order it is shown. */
import { button } from './button'
import { columns1 } from './columns-1'
import { columns2 } from './columns-2'
import { columns3 } from './columns-3'
import { columns4 } from './columns-4'
import { coupon } from './coupon'
import { divider } from './divider'
import { footer } from './footer'
import { header } from './header'
import { heading } from './heading'
import { image } from './image'
import { productCard } from './product-card'
import { social } from './social'
import { spacer } from './spacer'
import { text } from './text'
import { ASSET_IMAGE_TOKEN } from './brand'
import type { CepBlock } from './types'

export const CEP_BLOCKS: CepBlock[] = [
  columns1,
  columns2,
  columns3,
  columns4,
  spacer,
  divider,
  heading,
  text,
  image,
  button,
  header,
  social,
  footer,
  productCard,
  coupon,
]

export const BLOCK_CATEGORIES: { id: CepBlock['category']; label: string }[] = [
  { id: 'structure', label: 'Structure' },
  { id: 'content', label: 'Content' },
  { id: 'brand', label: 'Brand' },
  { id: 'commerce', label: 'Commerce' },
]

export function blocksByCategory(): { id: CepBlock['category']; label: string; blocks: CepBlock[] }[] {
  return BLOCK_CATEGORIES.map((category) => ({ ...category, blocks: CEP_BLOCKS.filter((block) => block.category === category.id) }))
}

/** Blocks that cannot be offered until the workspace library has a picture to put in them. */
export function needsImage(block: CepBlock): boolean {
  return block.mjml.includes(ASSET_IMAGE_TOKEN)
}

/** The block's MJML with a real picture in it. The token never survives this, so it never reaches a design. */
export function withImage(block: CepBlock, url: string): string {
  return block.mjml.split(ASSET_IMAGE_TOKEN).join(url)
}
