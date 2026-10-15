/**
 * The look every email preset shares. This is customer email content, not app UI: email clients read no CSS
 * variables and none of our stylesheets, so colours and fonts are written into the MJML as literal hex. The app's
 * own UI tokens live in src/index.css and do not apply here.
 *
 * The MJML keeps to what both renderers round-trip (mrml on the server, grapesjs-mjml in the designer): sections,
 * columns, groups, text, buttons, dividers and spacers. No images, and no mj-head (see DEFAULTS).
 */
import { EMAIL_FONT_STACK } from '@/apps/cep/features/designer/emailFonts'

export const EMAIL = {
  canvas: '#f4f3ef',
  surface: '#ffffff',
  ink: '#15171c',
  body: '#43474f',
  muted: '#767a84',
  line: '#e8e6e0',
  /** eyebrows and small highlights; the designer's own blocks use the same blue */
  accent: '#2753e4',
  /** text on the dark band */
  onInk: '#d7d9de',
  onInkMuted: '#a9adb6',
} as const

export const EMAIL_FONT = EMAIL_FONT_STACK

/**
 * Each element's look, written onto the element itself. The designer's canvas does not apply mj-head/mj-attributes
 * defaults (it draws MJML's own: a grey button, a 4px black divider, 25px text insets, and the head's button as an
 * empty block on the canvas), so a preset relies on nothing but its own attributes. Anything an element already sets wins.
 */
const DEFAULTS: Record<string, [string, string][]> = {
  'mj-text': [['font-family', EMAIL_FONT], ['font-size', '16px'], ['line-height', '26px'], ['color', EMAIL.body], ['padding', '8px 0']],
  'mj-button': [['font-family', EMAIL_FONT], ['background-color', EMAIL.ink], ['color', '#ffffff'], ['border-radius', '6px'], ['font-size', '15px'],
                ['font-weight', '700'], ['inner-padding', '15px 32px'], ['padding', '8px 0']],
  'mj-divider': [['border-width', '1px'], ['border-color', EMAIL.line], ['padding', '24px 0']],
}

function inlineDefaults(mjml: string): string {
  return mjml.replace(/<(mj-text|mj-button|mj-divider)(\s[^<>]*?)?(\s*\/?)>/g, (_whole, tag: string, attributes = '', close: string) => {
    const has = new Set(Array.from((attributes as string).matchAll(/([a-z-]+)="/g), (match) => match[1]))
    const missing = DEFAULTS[tag].filter(([name]) => !has.has(name)).map(([name, value]) => ` ${name}="${value}"`).join('')
    return `<${tag}${attributes}${missing}${close}>`
  })
}

const WORDMARK = `    <mj-section background-color="${EMAIL.surface}" border-bottom="1px solid ${EMAIL.line}" padding="28px 40px">
      <mj-column>
        <mj-text align="center" font-size="18px" line-height="24px" font-weight="700" letter-spacing="4px" color="${EMAIL.ink}" padding="0">YOUR BRAND</mj-text>
      </mj-column>
    </mj-section>`

/** css-class="cep-footer" is what the designer recognises and protects as the email's one footer. */
const FOOTER = `    <mj-section css-class="cep-footer" background-color="${EMAIL.canvas}" padding="32px 40px 40px">
      <mj-column>
        <mj-text align="center" font-size="12px" line-height="19px" color="${EMAIL.muted}" padding="0">
          You are receiving this email because you signed up for updates from Your Brand.<br />
          Your Brand &#183; 123 Market Street &#183; Your City<br />
          <a href="{{unsubscribe_url}}" style="color:${EMAIL.muted};text-decoration:underline">Unsubscribe</a>
        </mj-text>
      </mj-column>
    </mj-section>`

/** A whole email: wordmark, the preset's sections, then the marketing footer with the unsubscribe link. */
export function emailDocument(body: string): string {
  return inlineDefaults(`<mjml>
  <mj-body background-color="${EMAIL.canvas}" width="600px">
${WORDMARK}
${body}
${FOOTER}
  </mj-body>
</mjml>`)
}

/** Small uppercase label above a heading. */
export function eyebrow(text: string, options: { color?: string; align?: 'left' | 'center'; padding?: string } = {}): string {
  const { color = EMAIL.accent, align = 'left', padding = '0 0 12px' } = options
  return `<mj-text align="${align}" font-size="12px" line-height="16px" font-weight="700" letter-spacing="2px" text-transform="uppercase" color="${color}" padding="${padding}">${text}</mj-text>`
}

/** The email's one big heading. */
export function heading(text: string, options: { color?: string; align?: 'left' | 'center' } = {}): string {
  const { color = EMAIL.ink, align = 'left' } = options
  return `<mj-text align="${align}" font-size="34px" line-height="40px" font-weight="700" letter-spacing="-0.5px" color="${color}" padding="0 0 12px">${text}</mj-text>`
}

/** A text link styled as a quiet call to action, for secondary links next to the one primary button. */
export function textLink(label: string, href = '{{shop_url}}'): string {
  return `<a href="${href}" style="color:${EMAIL.ink};font-weight:700;text-decoration:none">${label} &#8594;</a>`
}
