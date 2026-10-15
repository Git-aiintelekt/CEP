import { describe, expect, it } from 'vitest'

import { EMAIL_FONT_HREF, EMAIL_FONT_STACK, withEmailFont, withEmailFontLink, withoutEmailFont } from './emailFonts'
import { STARTER_MJML } from './starter'

const PLAIN = '<mjml><mj-body><mj-section><mj-column><mj-text font-family="Georgia, serif">Hi</mj-text></mj-column></mj-section></mj-body></mjml>'
const PLEX = `<mjml>\n  <mj-body><mj-section><mj-column><mj-text font-family="${EMAIL_FONT_STACK}">Hi</mj-text></mj-column></mj-section></mj-body>\n</mjml>`

describe('withEmailFont', () => {
  it('leaves MJML that never uses Plex alone', () => {
    expect(withEmailFont(PLAIN)).toBe(PLAIN)
  })

  it('adds a head with the mj-font when there is none', () => {
    const out = withEmailFont(PLEX)
    expect(out).toContain(`<mj-head>\n    <mj-font name="IBM Plex Sans" href="${EMAIL_FONT_HREF}" />\n  </mj-head>`)
  })

  it('puts the mj-font inside an existing head, once', () => {
    const once = withEmailFont(STARTER_MJML)
    expect(once.match(/<mj-font/g)).toHaveLength(1)
    expect(once.indexOf('<mj-font')).toBeGreaterThan(once.indexOf('<mj-head>'))
    expect(withEmailFont(once)).toBe(once)
  })
})

describe('withoutEmailFont', () => {
  it('undoes withEmailFont, including a head it had to add', () => {
    expect(withoutEmailFont(withEmailFont(PLEX))).toBe(PLEX)
    expect(withoutEmailFont(withEmailFont(STARTER_MJML))).toBe(STARTER_MJML)
  })
})

describe('withEmailFontLink', () => {
  it('links the font in the head of HTML that uses it', () => {
    const html = `<html><head><title>x</title></head><body style="font-family:${EMAIL_FONT_STACK}">Hi</body></html>`
    const out = withEmailFontLink(html)
    expect(out).toContain(`<head><link href="${EMAIL_FONT_HREF}"`)
    expect(withEmailFontLink(out)).toBe(out)
  })

  it('leaves HTML without Plex alone', () => {
    expect(withEmailFontLink('<html><head></head><body>Hi</body></html>')).toBe('<html><head></head><body>Hi</body></html>')
  })
})
