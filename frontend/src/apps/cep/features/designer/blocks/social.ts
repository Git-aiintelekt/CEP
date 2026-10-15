import { BRAND } from './brand'
import type { CepBlock } from './types'

/**
 * Every href is empty: the profile addresses belong to the workspace, not to the block. The names carry MJML's
 * "-noshare" suffix so each icon links to that profile, rather than to a page for sharing the email.
 */
export const social: CepBlock = {
  id: 'social',
  label: 'Social Links',
  category: 'brand',
  icon: 'Share2',
  mjml: `<mj-section background-color="${BRAND.surface}" padding="8px 24px">
    <mj-column>
      <mj-social font-size="13px" icon-size="24px" mode="horizontal" align="center" color="${BRAND.muted}">
        <mj-social-element name="facebook-noshare" href=""></mj-social-element>
        <mj-social-element name="instagram" href=""></mj-social-element>
        <mj-social-element name="linkedin-noshare" href=""></mj-social-element>
      </mj-social>
    </mj-column>
  </mj-section>`,
}
