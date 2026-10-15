import { ASSET_IMAGE_TOKEN, COLUMN_PADDING } from './brand'
import type { CepBlock } from './types'

/** alt is empty on purpose: the review pills flag it so nothing ships without a description. */
export const image: CepBlock = {
  id: 'image',
  label: 'Image',
  category: 'content',
  icon: 'Image',
  mjml: `<mj-image src="${ASSET_IMAGE_TOKEN}" alt="" padding="${COLUMN_PADDING}"></mj-image>`,
}
