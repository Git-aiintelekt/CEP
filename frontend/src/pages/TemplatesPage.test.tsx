import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { promotion } from '@/features/templates/presets/promotion'
import { smsPromotion } from '@/features/templates/presets/smsPromotion'
import { installMockApi, me, presetTags, problem, signIn, tags as fewTags } from '@/test/mockApi'
import { withEmailFont } from '@/features/designer/emailFonts'

// the editors themselves are tested on their own; here only where each template leads
vi.mock('@/pages/TemplateDesignerPage', () => ({ default: () => <p>designer opened</p> }))
vi.mock('@/pages/ReceiptEditorPage', () => ({ default: () => <p>receipt editor opened</p> }))

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const cardNames = () => Array.from(document.querySelectorAll('ul > li .truncate')).map((node) => node.textContent)

/** A preset opens its preview; the copy is the preview's footer button. */
async function copyPreset(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `${name}, CEP Preset` }))
  const dialog = await screen.findByRole('dialog', { name })
  await user.click(within(dialog).getByRole('button', { name: 'Copy This Template' }))
}

const FRONTEND_PRESETS = [
  'Announce a sale', 'Welcome a new member', 'Run a flash sale', 'Final markdowns', 'Introduce new arrivals', 'Seasonal campaign', 'Share your brand story', 'Loyalty statement', 'Win-back offer', 'Personal coupon',
  'SMS offer', 'Opt-in confirmation + welcome', 'Last call', 'SMS points reminder', 'We miss you', 'SMS coupon',
  'Flash sale graphic', 'Holiday campaign', 'Store opening/event invite', 'MMS lookbook',
]

/** The workspace has every tag the marketing presets use, unless a test says otherwise. */
async function openLanding(options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi({ tags: presetTags, ...options })
  await renderAppAt('/templates')
  await screen.findByText('Fall Email')
  await screen.findByText('Announce a sale') // presets arrive after the workspace's templates
  return calls
}

test('shows the workspace templates, then the presets the workspace can fill', async () => {
  await openLanding()
  // server starters come first in the server's order, each swapped for its frontend definition (the mock lists promotion, then newsletter);
  // e-receipt presets are offered whatever the tags (they come last: E-Receipt is the last channel)
  const serverFirst = ['Announce a sale', 'Share your brand story']
  expect(cardNames()).toEqual(['Fall Email', 'Fall SMS', 'Retired Email', 'Northline order receipt', ...serverFirst, ...FRONTEND_PRESETS.filter((name) => !serverFirst.includes(name)), ...RECEIPT_PRESET_NAMES])
  // a server-only starter that uses {{points_balance}}, which the workspace has no tag for
  expect(screen.queryByText('Points balance update')).toBeNull()
  const preset = screen.getByRole('button', { name: 'Announce a sale, CEP Preset' })
  expect(within(preset).getByText('CEP Preset')).toBeTruthy()
  expect(within(preset).getByText('Starter')).toBeTruthy()
})

test('a preset whose tags the workspace lacks is not offered', async () => {
  const noTier = presetTags.filter((tag) => tag.tag_key !== 'loyalty_tier')
  await openLanding({ tags: noTier })
  expect(screen.queryByText('Loyalty statement')).toBeNull()
  expect(screen.queryByText('SMS points reminder')).toBeNull()
  expect(screen.getByText('Win-back offer')).toBeTruthy()
})

test('with only a few tags, the presets that need more step aside; the opt-in text needs only a first name', async () => {
  installMockApi({ tags: fewTags })
  await renderAppAt('/templates')
  await screen.findByText('Fall Email')
  await waitFor(() => expect(cardNames()).toEqual(['Fall Email', 'Fall SMS', 'Retired Email', 'Northline order receipt', 'Opt-in confirmation + welcome', ...RECEIPT_PRESET_NAMES]))
})

test('channel tabs filter the templates and the presets', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'SMS' }))

  await waitFor(() => expect(cardNames()).toEqual(['Fall SMS', 'SMS offer', 'Opt-in confirmation + welcome', 'Last call', 'SMS points reminder', 'We miss you', 'SMS coupon']))
  expect(screen.getByRole('tab', { name: 'SMS' }).getAttribute('aria-selected')).toBe('true')
  expect(calls.some((call) => call.method === 'GET' && /\/templates\/\?.*channel=SMS/.test(call.url))).toBe(true)
})

test('search filters the templates and the presets', async () => {
  await openLanding()
  const user = userEvent.setup()
  await user.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'retired')

  await waitFor(() => expect(cardNames()).toEqual(['Retired Email']))
  await user.clear(screen.getByRole('searchbox', { name: 'Search templates' }))
  await user.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'nothing like this')
  expect(await screen.findByText('No matching templates')).toBeTruthy()
  expect(screen.getByText('Try a different channel filter or clear the search.')).toBeTruthy()
})

test('the status filter stays, and presets step aside because they have no status', async () => {
  await openLanding()
  const user = userEvent.setup()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'ARCHIVED')
  await waitFor(() => expect(cardNames()).toEqual(['Retired Email']))
})

test('a quick-create card shows for every channel the workspace can use', async () => {
  await openLanding()
  for (const name of ['Email', 'SMS', 'MMS', 'E-Receipt']) expect(screen.getByRole('button', { name: `Create ${name} template` })).toBeTruthy()   // the card reads the channel's name, no "New"
  expect(screen.getByRole('button', { name: 'Create MMS template' }).textContent).not.toMatch(/video/i)
})

test('E-Receipt is offered even with the e-receipt switch off, as on Create Campaign', async () => {
  await openLanding({ me: { features: { ereceipt: false } } })
  expect(screen.getByRole('button', { name: 'Create Email template' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Create E-Receipt template' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: 'E-Receipt' })).toBeTruthy()
})

test('a channel switched off loses its card and tab', async () => {
  await openLanding({ me: { features: { mms: false } } })
  expect(screen.queryByRole('button', { name: 'Create MMS template' })).toBeNull()
  expect(screen.queryByRole('tab', { name: 'MMS' })).toBeNull()
})

test('without template.edit the cards are hidden and presets cannot be clicked', async () => {
  await openLanding({ me: { principal: { ...me.principal, kind: 'user', permissions: me.principal.permissions.filter((code) => code !== 'template.edit') } } })
  expect(screen.queryByRole('button', { name: 'Create Email template' })).toBeNull()
  expect(screen.queryByRole('button', { name: /, CEP preset$/ })).toBeNull()
  expect(screen.getByText('Announce a sale')).toBeTruthy()
})

test('clicking an e-receipt card opens its preview, whose Edit leads to the receipt editor', async () => {
  await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByText('Northline order receipt'))
  const dialog = await screen.findByRole('dialog', { name: 'Northline order receipt' })
  await user.click(within(dialog).getByRole('button', { name: 'Edit' }))
  expect(await screen.findByText('receipt editor opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-receipt/receipt')
})

test('an email preset is created empty, then filled with its design, and opens with no confirmation', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await copyPreset(user, 'Announce a sale')

  expect(await screen.findByText('designer opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-new/design')
  const posts = calls.filter((call) => call.method === 'POST').map((call) => [call.url.replace(/^.*\/api\/v1/, ''), call.body])
  const content = promotion.content.kind === 'design' ? promotion.content : null
  expect(posts).toEqual([
    ['/templates/', { name: 'Announce a sale', channel: 'EMAIL' }],
    ['/templates/tpl-new/design/', { editor_state: { kind: 'preset', key: 'promotion' }, mjml_source: withEmailFont(content?.mjml ?? ''), subject_line: content?.subject_line, preheader: content?.preheader, base_version: 0 }],
  ])
})

test('an SMS preset is created empty, then filled with its message', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await copyPreset(user, 'SMS offer')

  await waitFor(() => expect(window.location.pathname).toBe('/templates/tpl-new/message'))
  const posts = calls.filter((call) => call.method === 'POST').map((call) => [call.url.replace(/^.*\/api\/v1/, ''), call.body])
  const body = smsPromotion.content.kind === 'message' ? smsPromotion.content.sms_body : ''
  expect(posts).toEqual([
    ['/templates/', { name: 'SMS offer', channel: 'SMS' }],
    ['/templates/tpl-new/message/', { sms_body: body, subject_line: '', media_asset: null, base_version: 0 }],
  ])
})

test('a server-only preset is still copied by the server from its starter, in one call', async () => {
  const calls = await openLanding({ tags: [...presetTags, { ...presetTags[0], id: 'points_balance', tag_key: 'points_balance', label: 'Points balance' }] })
  const user = userEvent.setup()
  await copyPreset(user, 'Points balance update')

  expect(await screen.findByText('designer opened')).toBeTruthy()
  const posts = calls.filter((call) => call.method === 'POST').map((call) => call.body)
  expect(posts).toEqual([{ name: 'Points balance update', channel: 'EMAIL', starter: 'points_update' }])
})

test('when the fill fails, the empty draft still opens and a toast says so', async () => {
  await openLanding({ onSaveDesign: () => problem(500, { title: 'Server error', detail: 'The design service is down.' }) })
  const user = userEvent.setup()
  await copyPreset(user, 'Announce a sale')

  expect(await screen.findByText('designer opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-new/design')
  expect(await screen.findByText('The Announce a sale content was not added')).toBeTruthy()
  expect(screen.getByText('Your draft “Announce a sale” is empty; add content in the editor.')).toBeTruthy()
})

test('a preset whose name is taken is copied as "{name} 2"', async () => {
  const calls = await openLanding({
    onSaveTemplate: (call) => (call.body?.name === 'Announce a sale' ? problem(400, { title: 'Invalid input', errors: { name: ['A template with this name already exists.'] } }) : null),
  })
  const user = userEvent.setup()
  await copyPreset(user, 'Announce a sale')

  expect(await screen.findByText('designer opened')).toBeTruthy()
  const names = calls.filter((call) => call.method === 'POST' && call.url.endsWith('/templates/')).map((call) => call.body?.name)
  expect(names).toEqual(['Announce a sale', 'Announce a sale 2'])
})

test('a preset that cannot be copied says so in a toast', async () => {
  await openLanding({ onSaveTemplate: () => problem(500, { title: 'Server error', detail: 'The template service is down.' }) })
  const user = userEvent.setup()
  await copyPreset(user, 'Announce a sale')
  expect(await screen.findByText('The template was not created')).toBeTruthy()
  expect(screen.getByText(/^CEP had a problem at \d{1,2}:\d{2}/)).toBeTruthy()
  expect(window.location.pathname).toBe('/templates')
})

test('a channel card opens the two-step create pop-up on that channel: a name, then Blank or a starter; it sends the description and opens the editor', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Create SMS template' }))

  const dialog = await screen.findByRole('dialog', { name: 'Create Template' })
  expect(within(dialog).getByText(/^Step 1 of 2/)).toBeTruthy()
  expect(within(dialog).getByRole('radio', { name: 'SMS' }).getAttribute('aria-checked')).toBe('true')
  const next = within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(next.disabled).toBe(true)
  await user.type(within(dialog).getByLabelText(/^Template Name/), 'Weekend flash')
  await user.type(within(dialog).getByLabelText(/^Description/), 'Saturday only')
  await user.click(next)

  expect(await within(dialog).findByText(/^Step 2 of 2/)).toBeTruthy()
  expect((await within(dialog).findByRole('radio', { name: /Blank/ })).getAttribute('aria-checked')).toBe('true')
  await user.click(within(dialog).getByRole('button', { name: 'Create Template' }))

  await waitFor(() => expect(window.location.pathname).toBe('/templates/tpl-new/message'))
  const body = calls.find((call) => call.method === 'POST' && call.url.endsWith('/templates/'))?.body
  expect(body).toEqual({ name: 'Weekend flash', channel: 'SMS', description: 'Saturday only' })
})

test('the create pop-up takes the person back to step 1 to show the server refusing the name under the field', async () => {
  await openLanding({ onSaveTemplate: () => problem(400, { title: 'Invalid input', errors: { name: ['A template with this name already exists.'] } }) })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Create Email template' }))
  const dialog = await screen.findByRole('dialog', { name: 'Create Template' })
  await user.type(within(dialog).getByLabelText(/^Template Name/), 'Fall Email')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await user.click(await within(dialog).findByRole('button', { name: 'Create Template' }))

  expect(await within(dialog).findByText('A template with this name already exists.')).toBeTruthy()
  expect(within(dialog).getByLabelText(/^Template Name/).getAttribute('aria-invalid')).toBe('true')
})

test('list view keeps the open-editor link in each row menu', async () => {
  await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List View' }))

  const row = screen.getByRole('button', { name: 'Fall Email' }).closest('tr') as HTMLElement
  expect(within(row).getByText('Active')).toBeTruthy()
  await user.click(within(row).getByRole('button', { name: 'Actions for Fall Email' }))
  await user.click(screen.getByRole('button', { name: 'Open Designer' }))
  expect(await screen.findByText('designer opened')).toBeTruthy()
})

test('the row menu duplicates a template as a draft copy and opens it in its editor, without opening the row itself', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List View' }))

  await user.click(screen.getByRole('button', { name: 'Actions for Fall Email' }))
  expect(window.location.pathname).toBe('/templates') // the menu button did not open the preview or the designer under it
  await user.click(screen.getByRole('button', { name: /Duplicate/ }))

  expect(await screen.findByText('designer opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-email-copy/design')
  expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/templates/tpl-email/clone/'))).toBe(true)
})

test('a grid card carries the same menu, so Duplicate is one click away in either view', async () => {
  await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Actions for Fall SMS' }))
  expect(screen.getByRole('button', { name: /Duplicate/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Open Editor' })).toBeTruthy()
})

test('deleting asks first, then removes the row', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List View' }))

  await user.click(screen.getByRole('button', { name: 'Actions for Fall SMS' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(screen.getByRole('dialog', { name: 'Delete this template?' })).toBeTruthy()
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

  await user.click(screen.getByRole('button', { name: 'Delete Template' }))
  await waitFor(() => expect(screen.queryByText('Fall SMS')).toBeNull())
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/templates/tpl-sms/'))).toBe(true)
})

test('a template a campaign uses cannot be deleted: the dialog says why and stays open', async () => {
  await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List View' }))

  await user.click(screen.getByRole('button', { name: 'Actions for Fall Email' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  await user.click(screen.getByRole('button', { name: 'Delete Template' }))

  expect((await screen.findByRole('alert')).textContent).toContain('This template is used by a campaign. Archive it instead.')
  expect(screen.getByRole('dialog', { name: 'Delete this template?' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Fall Email' })).toBeTruthy()
})

test('without template.edit the menu offers no Duplicate or Delete', async () => {
  await openLanding({ me: { principal: { ...me.principal, kind: 'user', permissions: ['campaign.view'] } } })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List View' }))
  await user.click(screen.getByRole('button', { name: 'Actions for Fall SMS' }))
  expect(screen.queryByRole('button', { name: /Duplicate/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Open Editor' })).toBeTruthy()
})

test('list view: an e-receipt row opens its preview, and Open Editor in its menu leads to the receipt editor', async () => {
  await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'List View' }))
  const row = screen.getByRole('button', { name: 'Northline order receipt' }).closest('tr') as HTMLElement
  await user.click(within(row).getByText('E-Receipt'))
  expect(await screen.findByRole('dialog', { name: 'Northline order receipt' })).toBeTruthy()
  await user.keyboard('{Escape}')

  await user.click(within(row).getByRole('button', { name: 'Actions for Northline order receipt' }))
  await user.click(screen.getByRole('button', { name: 'Open Editor' }))
  expect(await screen.findByText('receipt editor opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-receipt/receipt')
})

test('Rename in the menu asks for the new name and writes it, a duplicate\'s "(copy)" included; a taken name is refused', async () => {
  const calls = await openLanding()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Actions for Fall SMS' }))
  await user.click(screen.getByRole('button', { name: 'Rename' }))
  const dialog = await screen.findByRole('dialog', { name: 'Rename Template' })
  const input = within(dialog).getByLabelText(/Template Name/) as HTMLInputElement
  expect(input.value).toBe('Fall SMS')
  expect((within(dialog).getByRole('button', { name: 'Save Name' }) as HTMLButtonElement).disabled).toBe(true)  // unchanged

  await user.clear(input)
  await user.type(input, 'fall email')                                                                // another template's name, case aside
  await user.click(within(dialog).getByRole('button', { name: 'Save Name' }))
  expect(await within(dialog).findByText('Another template already has this name.')).toBeTruthy()
  expect(within(dialog).queryByRole('alert')).toBeNull()                                             // the field says it: no banner repeating it
  expect(dialog.textContent).not.toMatch(/Invalid input|Bad Request/)

  await user.clear(input)
  await user.type(input, 'Fall SMS, October{Enter}')
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rename Template' })).toBeNull())
  expect(await screen.findByText('Fall SMS, October')).toBeTruthy()
  const written = calls.filter((call) => call.method === 'PATCH' && call.url.endsWith('/templates/tpl-sms/')).at(-1)    // after the refused one
  expect(written?.body).toEqual({ name: 'Fall SMS, October' })
  expect(screen.getByText('Template renamed')).toBeTruthy()
})

// ---- e-receipt presets ----

const RECEIPT_TAGS = ['receipt_number', 'transaction_date', 'store_name', 'store_address', 'subtotal', 'discount_total', 'tax_total', 'grand_total',
  'payment_method', 'order_number', 'shipping_address', 'delivery_estimate']
const withReceiptTags = [...presetTags, ...RECEIPT_TAGS.map((key) => ({ ...presetTags[0], id: key, tag_key: key, label: key }))]
const RECEIPT_PRESET_NAMES = ['Standard store receipt', 'Savings + points', 'Online order', 'BOPIS']

async function openReceiptTab(options: Parameters<typeof installMockApi>[0]) {
  const calls = installMockApi(options)
  await renderAppAt('/templates')
  await screen.findByText('Fall Email')
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: 'E-Receipt' }))
  await waitFor(() => expect(cardNames()[0]).toBe('Northline order receipt'))
  return { calls, user }
}

test('the four e-receipt presets are offered whether or not the workspace has the receipt tags yet', async () => {
  // presetTags has no receipt tags at all
  await openReceiptTab({ tags: presetTags })
  await waitFor(() => expect(cardNames()).toEqual(['Northline order receipt', ...RECEIPT_PRESET_NAMES]))

  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  await openReceiptTab({ tags: withReceiptTags })
  await waitFor(() => expect(cardNames()).toEqual(['Northline order receipt', ...RECEIPT_PRESET_NAMES]))
})

test('an e-receipt preset is created, then filled with its outer design, then its receipt layout, in that order', async () => {
  const { calls, user } = await openReceiptTab({ tags: withReceiptTags })
  await copyPreset(user, 'BOPIS')                                                                     // its preview first, then the copy

  expect(await screen.findByText('receipt editor opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-new/receipt')
  const posts = calls.filter((call) => call.method === 'POST').map((call) => [call.url.replace(/^.*\/api\/v1/, ''), call.body])
  expect(posts.map(([url]) => url)).toEqual(['/templates/', '/templates/tpl-new/design/', '/templates/tpl-new/receipt/'])
  expect(posts[0][1]).toEqual({ name: 'BOPIS', channel: 'E_RECEIPT' })
  expect(posts[1][1]).toMatchObject({ editor_state: { kind: 'preset', key: 'receipt_bopis' }, subject_line: 'Order {{order_number}}: pick up at {{store_name}}', base_version: 0 })
  expect(String((posts[1][1] as { mjml_source: string }).mjml_source)).toContain('CEP:RECEIPT_SLOT_START')
  const layout = posts[2][1] as { layout_preset: string; sections: { key: string; address_mode?: string }[]; custom_html: null; custom_css: null; base_version: number }
  expect(layout).toMatchObject({ layout_preset: 'STANDARD', custom_html: null, custom_css: null, base_version: 0 })
  expect(layout.sections.find((item) => item.key === 'customer_fulfillment')?.address_mode).toBe('PICKUP')
})

test('when the receipt layout fails to save, the draft still opens, with the same toast as any failed fill', async () => {
  const { user } = await openReceiptTab({ tags: withReceiptTags, onSaveReceiptLayout: () => problem(500, { title: 'Server error', detail: 'The receipt service is down.' }) })
  await copyPreset(user, 'Online order')

  expect(await screen.findByText('receipt editor opened')).toBeTruthy()
  expect(window.location.pathname).toBe('/templates/tpl-new/receipt')
  expect(await screen.findByText('The Online order content was not added')).toBeTruthy()
  expect(screen.getByText('Your draft “Online order” is empty; add content in the editor.')).toBeTruthy()
})
