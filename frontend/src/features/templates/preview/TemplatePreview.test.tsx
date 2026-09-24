import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { renderWithSamples, smsMetrics } from '@/features/messaging/sms'
import { scrollIntoView, watchedCount } from '@/test/intersection'
import { installMockApi, makeMessage, me, presetTags, signIn } from '@/test/mockApi'

import { smsPromotion } from '../presets/smsPromotion'

vi.mock('@/pages/TemplateDesignerPage', () => ({ default: () => <p>designer opened</p> }))
vi.mock('@/pages/ReceiptEditorPage', () => ({ default: () => <p>receipt editor opened</p> }))

async function openLanding(options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi({ tags: presetTags, ...options })
  signIn('/templates')
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
  await screen.findByText('Fall Email')
  await screen.findByText('SMS offer')
  return calls
}

const posts = (calls: { method: string; url: string }[]) => calls.filter((call) => call.method === 'POST')

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const factsIn = (dialog: HTMLElement) => {
  const found = dialog.querySelector<HTMLElement>('[aria-label="Message facts"]')
  if (!found) throw new Error('no facts card yet')
  return found
}

/** Presets are copied on click, so their preview lives in the list view's row menu. */
async function previewPresetFromList(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: 'List view' }))
  const trigger = await screen.findByRole('button', { name: `Actions for ${name}` })
  await user.click(trigger)
  await user.click(within(screen.getByRole('region', { name: `Actions for ${name}` })).getByRole('button', { name: 'Preview' }))
  return trigger
}

const smsBody = smsPromotion.content.kind === 'message' ? smsPromotion.content.sms_body : ''

test('a preset preview: its name and tags, the resolved message in a phone, the facts, and no footer actions', async () => {
  await openLanding()
  const user = userEvent.setup()
  const trigger = await previewPresetFromList(user, 'SMS offer')

  const dialog = await screen.findByRole('dialog', { name: 'SMS offer' })
  for (const tag of ['SMS', 'Promotion', 'CEP preset']) expect(within(dialog).getByText(tag)).toBeTruthy()
  const resolved = renderWithSamples(smsBody, presetTags)
  expect((await within(dialog).findByTestId('preview-bubble')).textContent).toBe(resolved)

  const facts = factsIn(dialog)
  const counted = smsMetrics(resolved)
  expect(within(facts).getByText('Characters').nextElementSibling?.textContent).toBe(String(counted.units))
  expect(within(facts).getByText('Segments').nextElementSibling?.textContent).toBe('1')
  expect(within(facts).getByText('Media').nextElementSibling?.textContent).toBe('None')
  expect(within(facts).getByText('Opt-out').nextElementSibling?.textContent).toBe('In message body')
  expect(within(dialog).queryByRole('button', { name: /^(Edit|Open|Save|Activate|Use this template)/ })).toBeNull()

  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(document.activeElement).toBe(trigger)
})

test('a template preview reads its saved findings, and its footer offers Edit and nothing else', async () => {
  const findings = { ...makeMessage().findings, units: 212, segments: 2, per_segment: 153 }
  await openLanding({ message: makeMessage({ findings }) })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List view' }))
  const row = screen.getByRole('button', { name: 'Fall SMS' }).closest('tr') as HTMLElement
  const trigger = within(row).getByRole('button', { name: 'Actions for Fall SMS' })
  await user.click(trigger)
  const menu = screen.getByRole('region', { name: 'Actions for Fall SMS' })
  expect(within(menu).getAllByRole('button').map((button) => button.textContent)).toEqual(['Preview', 'Open editor', 'DuplicateA draft copy of the latest version', 'Delete'])
  await user.click(within(menu).getByRole('button', { name: 'Preview' }))

  const dialog = await screen.findByRole('dialog', { name: 'Fall SMS' })
  const facts = await waitFor(() => factsIn(dialog))
  expect(within(facts).getByText('Characters').nextElementSibling?.textContent).toBe('212')
  expect(within(facts).getByText('Segments').nextElementSibling?.textContent).toBe('2')
  expect(within(facts).getByText('Segment limit').nextElementSibling?.textContent).toBe('153 characters')
  expect(within(dialog).getByText('Active')).toBeTruthy()
  expect(within(dialog).getByText(/^Edited /)).toBeTruthy()
  expect(within(dialog).queryByText(/archive|duplicate|used \d/i)).toBeNull()

  // the scrim closes it, and focus goes back to the row's menu button
  fireEvent.mouseDown(dialog.parentElement as HTMLElement)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(document.activeElement).toBe(trigger)

  await user.click(trigger)
  await user.click(within(screen.getByRole('region', { name: 'Actions for Fall SMS' })).getByRole('button', { name: 'Preview' }))
  await user.click(await within(await screen.findByRole('dialog', { name: 'Fall SMS' })).findByRole('button', { name: 'Edit' }))
  await waitFor(() => expect(window.location.pathname).toBe('/templates/tpl-sms/message'))
})

test('an email preview shows the subject with samples and the compiled email, at desktop or phone width', async () => {
  await openLanding()
  const user = userEvent.setup()
  await previewPresetFromList(user, 'Announce a sale')

  const dialog = await screen.findByRole('dialog', { name: 'Announce a sale' })
  const frame = (await within(dialog).findByTitle('Email preview')) as HTMLIFrameElement
  expect(within(dialog).getByText('Jordan, 20% off this weekend only')).toBeTruthy()
  expect(frame.getAttribute('sandbox')).toBe('')
  expect(frame.srcdoc).toContain('YOUR BRAND')
  expect(frame.srcdoc).toContain('FALL017')
  expect(frame.srcdoc).not.toContain('{{offer_code}}')
  expect(frame.style.width).toBe('600px')

  await user.click(within(dialog).getByRole('radio', { name: 'Mobile' }))
  expect((within(dialog).getByTitle('Email preview') as HTMLIFrameElement).style.width).toBe('375px')
})

test('clicking a template card opens its preview, and Edit goes on to the editor', async () => {
  await openLanding()
  const user = userEvent.setup()
  const card = screen.getByText('Fall Email').closest('button') as HTMLElement
  await user.click(card)

  const dialog = await screen.findByRole('dialog', { name: 'Fall Email' })
  expect(window.location.pathname).toBe('/templates')
  expect(screen.queryByRole('button', { name: /^Preview /})).toBeNull() // no separate preview button on cards
  await user.click(within(dialog).getByRole('button', { name: 'Edit' }))
  expect(await screen.findByText('designer opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-email/design')
})

test('e-receipts have no preview: the card and row still open the editor, and the menu has no Preview', async () => {
  await openLanding()
  const user = userEvent.setup()
  expect(screen.getByText('Northline order receipt').closest('a')?.getAttribute('href')).toBe('/templates/tpl-receipt/receipt')

  await user.click(screen.getByRole('button', { name: 'List view' }))
  const row = screen.getByRole('link', { name: 'Northline order receipt' }).closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Actions for Northline order receipt' }))
  expect(within(screen.getByRole('region', { name: 'Actions for Northline order receipt' })).getAllByRole('button').map((button) => button.textContent)).toEqual(['Open editor', 'DuplicateA draft copy of the latest version', 'Delete'])
})

test('SMS and MMS cards show the first line of the real message; email and e-receipt show a content skeleton', async () => {
  await openLanding({ message: makeMessage({ sms_body: 'Northwind: Hi {{first_name}}.\nSecond line' }) })
  const card = (name: string) => screen.getAllByText(name).map((node) => node.closest('li')).find(Boolean) as HTMLElement

  // SMS / MMS: unchanged, the real first line in a bubble (MMS adds its picture square), for templates and presets alike
  await waitFor(() => expect(card('Fall SMS').querySelector('[data-tile="message"]')?.textContent).toBe('Northwind: Hi Jordan.'))
  expect(card('SMS offer').querySelector('[data-tile="message"]')?.textContent).toBe(renderWithSamples(smsBody, presetTags))
  expect(card('MMS lookbook').querySelector('[data-tile="message"]')?.textContent).toMatch(/^Your Brand: Jordan, the new season lookbook/)
  expect(card('MMS lookbook').querySelectorAll('[data-tile="message"] svg')).toHaveLength(1) // the picture square's glyph

  // email and e-receipt: see the thumbnail tests below
})

test('list rows start with the name: no leading tile for any channel', async () => {
  await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List view' }))
  const rows = await screen.findAllByRole('row')
  expect(rows.length).toBeGreaterThan(10)
  expect(document.querySelectorAll('table [data-tile]')).toHaveLength(0)
  const firstCell = (screen.getByRole('button', { name: 'Fall SMS' }).closest('td') as HTMLElement)
  expect(firstCell.querySelector('svg, img')).toBeNull()
})

test('clicking a preset card opens its preview, not a copy; the footer offers the copy and no edited time', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'SMS offer, CEP preset' }))

  const dialog = await screen.findByRole('dialog', { name: 'SMS offer' })
  expect(posts(calls)).toEqual([])
  expect(window.location.pathname).toBe('/templates')
  expect(within(dialog).getByRole('button', { name: 'Copy this template' })).toBeTruthy()
  expect(within(dialog).queryByText(/Edited/)).toBeNull()
  expect(within(dialog).queryByRole('button', { name: 'Edit' })).toBeNull()
})

test('clicking a preset row in the list opens its preview, not a copy', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List view' }))
  const row = (await screen.findByRole('button', { name: 'Welcome a new member' })).closest('tr') as HTMLElement
  await user.click(within(row).getByText('Starter'))

  expect(await screen.findByRole('dialog', { name: 'Welcome a new member' })).toBeTruthy()
  expect(posts(calls)).toEqual([])
})

test('Copy this template makes the copy through the same path, closes the preview and opens the new draft', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'SMS offer, CEP preset' }))
  const copy = within(await screen.findByRole('dialog', { name: 'SMS offer' })).getByRole('button', { name: 'Copy this template' })
  await user.click(copy)
  await user.click(copy) // a second press while the copy runs does nothing

  await waitFor(() => expect(window.location.pathname).toBe('/templates/tpl-new/message'))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(posts(calls).map((call) => call.url.replace(/^.*\/api\/v1/, ''))).toEqual(['/templates/', '/templates/tpl-new/message/'])
})

test('without template.edit a preset card does nothing on click, and its preview has no copy button', async () => {
  await openLanding({ me: { principal: { ...me.principal, kind: 'user', permissions: me.principal.permissions.filter((code) => code !== 'template.edit') } } })
  const user = userEvent.setup()
  expect(screen.queryByRole('button', { name: 'SMS offer, CEP preset' })).toBeNull()

  // the list row's menu still previews, read-only
  await previewPresetFromList(user, 'SMS offer')
  const dialog = await screen.findByRole('dialog', { name: 'SMS offer' })
  expect(within(dialog).queryByRole('button', { name: 'Copy this template' })).toBeNull()
})

// ---- email and e-receipt thumbnails: the real email, scaled down, loaded only once in view ----

const cardOf = (name: string) => screen.getAllByText(name).map((node) => node.closest('li')).find(Boolean) as HTMLElement
const tileOf = (name: string) => cardOf(name).querySelector('[data-tile]') as HTMLElement
const inCard = (name: string) => (element: Element) => cardOf(name).contains(element)

test('an email card shows its channel placeholder until it is in view, then the real compiled email', async () => {
  const calls = await openLanding()
  // nothing has scrolled into view: every email card waits, and no design has been asked for
  expect(tileOf('Fall Email').dataset.tile).toBe('placeholder')
  expect(tileOf('Fall Email').querySelector('iframe')).toBeNull()
  expect(calls.some((call) => call.url.includes('/templates/tpl-email/design/'))).toBe(false)

  await act(async () => scrollIntoView(inCard('Fall Email')))
  await waitFor(() => expect(tileOf('Fall Email').dataset.tile).toBe('email'))
  expect(calls.some((call) => call.url.includes('/templates/tpl-email/design/'))).toBe(true)

  // a preset email is compiled from its own MJML, with the workspace's sample values in it
  await act(async () => scrollIntoView(inCard('Announce a sale')))
  await waitFor(() => expect(tileOf('Announce a sale').dataset.tile).toBe('email'))
  const frame = tileOf('Announce a sale').querySelector('iframe') as HTMLIFrameElement
  expect(frame.srcdoc).toContain('YOUR BRAND')
  expect(frame.srcdoc).toContain('FALL017')
  expect(frame.srcdoc).not.toContain('{{offer_code}}')
})

test('only cards in view load: the rest stay waiting and ask for nothing', async () => {
  const calls = await openLanding()
  const waiting = watchedCount()
  expect(waiting).toBeGreaterThan(10) // every email and e-receipt card on the page is waiting to be seen

  await act(async () => scrollIntoView(inCard('Fall Email')))
  await waitFor(() => expect(tileOf('Fall Email').dataset.tile).toBe('email'))
  expect(watchedCount()).toBe(waiting - 1)
  expect(calls.filter((call) => /\/(design|receipt)\/$/.test(call.url.split('?')[0])).map((call) => call.url.replace(/^.*\/api\/v1/, ''))).toEqual(['/templates/tpl-email/design/'])
  for (const name of ['Retired Email', 'Northline order receipt', 'Welcome a new member']) expect(tileOf(name).dataset.tile, name).toBe('placeholder')
})

test('an e-receipt gets a real thumbnail, with its receipt in the slot, and still no Preview action anywhere', async () => {
  const calls = await openLanding()
  await act(async () => scrollIntoView(inCard('Northline order receipt')))
  await waitFor(() => expect(tileOf('Northline order receipt').dataset.tile).toBe('email'))
  const frame = tileOf('Northline order receipt').querySelector('iframe') as HTMLIFrameElement
  expect(frame.srcdoc).toContain('data-section="items"') // the sample receipt, injected where the slot was
  expect(calls.some((call) => call.url.includes('/templates/tpl-receipt/receipt/'))).toBe(true)

  await act(async () => scrollIntoView(inCard('BOPIS')))
  await waitFor(() => expect(tileOf('BOPIS').dataset.tile).toBe('email'))
  expect((tileOf('BOPIS').querySelector('iframe') as HTMLIFrameElement).srcdoc).toContain('In store')

  // the card still opens the editor directly, and no menu offers a preview
  expect(cardOf('Northline order receipt').querySelector('a')?.getAttribute('href')).toBe('/templates/tpl-receipt/receipt')
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List view' }))
  const row = screen.getByRole('link', { name: 'Northline order receipt' }).closest('tr') as HTMLElement
  await user.click(within(row).getByRole('button', { name: 'Actions for Northline order receipt' }))
  expect(within(screen.getByRole('region', { name: 'Actions for Northline order receipt' })).queryByRole('button', { name: 'Preview' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Actions for BOPIS' })).toBeNull()
})

test('the thumbnail frame is sandboxed and inert: a click on it reaches the card', async () => {
  await openLanding()
  await act(async () => scrollIntoView(inCard('Fall Email')))
  await waitFor(() => expect(tileOf('Fall Email').dataset.tile).toBe('email'))
  const frame = tileOf('Fall Email').querySelector('iframe') as HTMLIFrameElement
  expect(frame.getAttribute('sandbox')).toBe('')
  expect(frame.getAttribute('tabindex')).toBe('-1')
  expect(frame.className).toContain('pointer-events-none')
  expect(frame.closest('[aria-hidden="true"]')).toBeTruthy()

  fireEvent.click(frame)
  expect(await screen.findByRole('dialog', { name: 'Fall Email' })).toBeTruthy()
})

test('list rows still carry no tile, and never load a thumbnail', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List view' }))
  await act(async () => scrollIntoView())
  expect(document.querySelectorAll('table [data-tile], table iframe')).toHaveLength(0)
  expect(calls.some((call) => /\/(design|receipt)\/$/.test(call.url.split('?')[0]))).toBe(false)
})
