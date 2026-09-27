/**
 * The inbox clients the Preview tab can stand in for. Each brings what is known to differ: how much of the preheader the
 * list shows, the quirks its renderer is known for (drawn into the email as CSS), and how it treats dark mode.
 *
 *  - Gmail clips a wide email and ignores <style> blocks with unsupported features; on Android its dark mode inverts colours.
 *  - Outlook (Windows) draws no rounded corners and no background images, and falls back to Arial; its dark mode inverts.
 *  - Apple Mail renders faithfully and honours the email's own @media (prefers-color-scheme: dark) rules.
 * A stand-in, not the real client: the sent email is rendered by each inbox itself.
 */
export type ClientId = 'generic' | 'gmail' | 'outlook' | 'apple'
export type Appearance = 'light' | 'dark'

export interface EmailClient {
  id: ClientId
  label: string
  /** characters of subject + preheader the inbox list shows before it cuts off */
  inboxChars: number
  /** the sender's initial sits in this shape */
  avatar: 'round' | 'square'
  /** CSS drawn into the email to mimic the renderer's limits */
  quirksCss: string
  /** how the client darkens an email: by inverting it, or by honouring the email's own dark rules */
  dark: 'invert' | 'media'
  /** one line the pane shows under the controls */
  note: string
}

export const EMAIL_CLIENTS: readonly EmailClient[] = [
  { id: 'generic', label: 'Generic', inboxChars: 110, avatar: 'round', quirksCss: '', dark: 'invert', note: 'A standards-following inbox: the email as it was built.' },
  { id: 'gmail', label: 'Gmail', inboxChars: 100, avatar: 'round', quirksCss: 'body { max-width: 640px; margin: 0 auto; }', dark: 'invert',
    note: 'Gmail shows the first 100 characters of subject and preheader, and its Android app darkens an email by inverting its colours.' },
  { id: 'outlook', label: 'Outlook', inboxChars: 60, avatar: 'square',
    quirksCss: '* { border-radius: 0 !important; background-image: none !important; font-family: Arial, Helvetica, sans-serif !important; }', dark: 'invert',
    note: 'Outlook for Windows draws no rounded corners or background images and falls back to Arial; its dark mode inverts colours.' },
  { id: 'apple', label: 'Apple Mail', inboxChars: 80, avatar: 'round', quirksCss: '', dark: 'media',
    note: 'Apple Mail renders the email as built and honours its own dark-mode rules (@media prefers-color-scheme).' },
]

export const clientById = (id: ClientId): EmailClient => EMAIL_CLIENTS.find((client) => client.id === id) ?? EMAIL_CLIENTS[0]

/** the inversion filter Gmail and Outlook are known for, images turned back */
export const INVERT_DARK_CSS = 'html { background: #ffffff; min-height: 100%; filter: invert(1) hue-rotate(180deg); } img, video, picture, [data-no-invert] { filter: invert(1) hue-rotate(180deg); }'
/** a client that honours the email's own dark rules: the media queries are switched on and form controls follow */
export const MEDIA_DARK_CSS = ':root { color-scheme: dark; } html { background: #1c1c1e; }'

/** rewrites `@media (prefers-color-scheme: dark)` so its rules apply, as a client in dark mode would apply them */
export function unlockDarkMedia(html: string): string {
  return html.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, '@media all')
}

/** how many characters of the preheader the list still shows after the subject, for this client */
export function preheaderRoom(client: EmailClient, subject: string): number {
  return Math.max(0, client.inboxChars - subject.trim().length - 3)
}
