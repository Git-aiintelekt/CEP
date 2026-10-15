/**
 * The one web font C360's emails use: IBM Plex Sans, the design system's typeface. Inboxes fetch it from a public
 * URL (the app's self-hosted copy is not reachable from a mail client), so it comes from Google Fonts. Apple Mail,
 * iOS Mail, Outlook for Mac and Samsung Mail show it; Gmail, Outlook for Windows and Yahoo ignore web fonts and
 * fall back to Helvetica, then Arial, which is why the stack is part of the design.
 */
export const EMAIL_FONT_NAME = 'IBM Plex Sans'
export const EMAIL_FONT_STACK = "'IBM Plex Sans', Helvetica, Arial, sans-serif"
export const EMAIL_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap'

export const EMAIL_FONT_LINK = `<link href="${EMAIL_FONT_HREF}" rel="stylesheet" type="text/css" />`
const MJ_FONT = `<mj-font name="${EMAIL_FONT_NAME}" href="${EMAIL_FONT_HREF}" />`

const usesPlex = (markup: string) => markup.includes(EMAIL_FONT_NAME)

/**
 * Adds the mj-font to MJML that uses Plex, so the server's render links the font. It goes in at save time rather
 * than living in the design: the designer's canvas draws mj-head children it does not know as empty blocks.
 */
export function withEmailFont(mjml: string): string {
  if (!usesPlex(mjml) || /<mj-font\b[^>]*IBM Plex Sans/i.test(mjml)) return mjml
  if (/<mj-head\b[^>]*>/i.test(mjml)) return mjml.replace(/<mj-head\b[^>]*>/i, (head) => `${head}\n    ${MJ_FONT}`)
  return mjml.replace(/<mjml\b[^>]*>/i, (root) => `${root}\n  <mj-head>\n    ${MJ_FONT}\n  </mj-head>`)
}

/** The reverse, before saved MJML goes back into the designer: the font is added again on the next save. */
export function withoutEmailFont(mjml: string): string {
  return mjml
    .replace(/[ \t]*<mj-font\b[^>]*IBM Plex Sans[^>]*?(\/>|>\s*<\/mj-font>)\n?/gi, '')
    .replace(/[ \t]*<mj-head\b[^>]*>\s*<\/mj-head>\n?/i, '')
}

/** The same link for HTML compiled without it (the designer's preview) or written by hand (the receipt layout). */
export function withEmailFontLink(html: string): string {
  if (!usesPlex(html) || html.includes(EMAIL_FONT_HREF)) return html
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}${EMAIL_FONT_LINK}`)
  return `${EMAIL_FONT_LINK}${html}`
}

const MJML_DEFAULT_FONT = 'font-family:Ubuntu, Helvetica, Arial, sans-serif'
const CANVAS_FONT_ID = 'cep-email-font'

/** The font the design's head gives every element (`<mj-all font-family>`), if it sets one. */
export function headFontOf(mjml: string): string | null {
  const all = /<mj-all\b[^>]*\bfont-family="([^"]+)"/i.exec(mjml)
  return all ? all[1] : null
}

/**
 * The designer's canvas draws each element with MJML's built-in font (Ubuntu) and ignores the head, while the server
 * render applies the head's mj-all. This links Plex into the frame and draws elements left on that built-in font in
 * the head's font instead, so the canvas shows what will be sent.
 */
export function linkEmailFont(frame: Document | undefined | null, mjml: string): void {
  if (!frame?.head) return
  if (!frame.querySelector(`link[href="${EMAIL_FONT_HREF}"]`)) {
    const link = frame.createElement('link')
    link.rel = 'stylesheet'
    link.href = EMAIL_FONT_HREF
    frame.head.appendChild(link)
  }
  frame.getElementById(CANVAS_FONT_ID)?.remove()
  const font = headFontOf(mjml)
  if (!font) return
  const style = frame.createElement('style')
  style.id = CANVAS_FONT_ID
  style.textContent = `[style*="${MJML_DEFAULT_FONT}"] { font-family: ${font} !important; }`
  frame.head.appendChild(style)
}
