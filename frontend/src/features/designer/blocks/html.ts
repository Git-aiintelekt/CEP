import { BRAND } from './brand'
import type { CepBlock } from './types'

/**
 * Hand-written HTML, placed between sections. MJML passes an mj-raw through untouched, so the block starts as the
 * full-width table an email client expects there; the markup itself is edited in the settings panel.
 */
export const html: CepBlock = {
  id: 'html',
  label: 'Custom HTML',
  category: 'content',
  icon: 'Code',
  mjml: `<mj-raw><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;background:${BRAND.surface};"><tr><td style="padding:16px 24px;font-family:Arial, Helvetica, sans-serif;font-size:15px;line-height:24px;color:${BRAND.body};">Your HTML here</td></tr></table></mj-raw>`,
}
