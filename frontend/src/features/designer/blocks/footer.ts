import { BRAND } from './brand'
import type { CepBlock } from './types'

/** The unsubscribe link and the reason line are what makes marketing mail sendable; they ship with the block. */
export const footer: CepBlock = {
  id: 'footer',
  label: 'Footer',
  category: 'brand',
  icon: 'AlignCenter',
  mjml: `<mj-section css-class="cep-footer" padding="16px 24px">
    <mj-column>
      <mj-text font-size="12px" line-height="18px" color="${BRAND.muted}" align="center">
        You are receiving this email because you subscribed to our updates.<br />
        Your company, 1 Example Street, Your city, 00000<br />
        <a href="{{unsubscribe_url}}" style="color:${BRAND.muted}">Unsubscribe</a>
      </mj-text>
    </mj-column>
  </mj-section>`,
}
