/** Networks with an icon of our own (TikTok): the element carries the icon and its colour, and MJML compiles it whole. */
import mjml2html from 'mjml-browser'
import { expect, test } from 'vitest'

import { OWN_ICONS, SOCIAL_NETWORKS, networkLabel, ownIconAttributes, socialElementMjml } from './social'

test('TikTok is offered, named, and every icon of our own is a file the app serves', () => {
  expect(SOCIAL_NETWORKS.find((option) => option.value === 'tiktok')?.label).toBe('TikTok')
  expect(networkLabel('tiktok')).toBe('TikTok')
  for (const own of Object.values(OWN_ICONS)) expect(own.src).toMatch(/^\/social-icons\/[a-z]+\.png$/)
})

test('a network MJML draws itself gets no icon attributes; ours gets the icon as a full address and its colour', () => {
  expect(ownIconAttributes('facebook')).toBeNull()
  expect(ownIconAttributes('facebook-noshare')).toBeNull()
  expect(ownIconAttributes(null)).toBeNull()
  const own = ownIconAttributes('tiktok')
  expect(own?.src).toMatch(/^https?:\/\/[^/]+\/social-icons\/tiktok\.png$/)   // absolute: an inbox has no idea where the email was designed
  expect(own?.['background-color']).toBe('#000000')
  expect(socialElementMjml('facebook')).toBe('<mj-social-element name="facebook-noshare" href=""></mj-social-element>')
  expect(socialElementMjml('tiktok')).toBe(`<mj-social-element name="tiktok" href="" src="${own?.src}" background-color="#000000"></mj-social-element>`)
})

test('MJML compiles a TikTok icon with our image and colour, and nothing undefined', () => {
  const { html, errors } = mjml2html(`<mjml><mj-body><mj-section><mj-column><mj-social>${socialElementMjml('tiktok')}</mj-social></mj-column></mj-section></mj-body></mjml>`)
  expect(errors).toEqual([])
  expect(html).toMatch(/<img[^>]+src="https?:\/\/[^"]+\/social-icons\/tiktok\.png"/)
  expect(html).toContain('background:#000000')
  expect(html).not.toContain('undefined')
})
