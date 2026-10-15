/** The Content tab: the Message card with its header controls, the Details card per channel, and Send a test. */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, makeDesign, makeMessage, me, mediaLibrary, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const emailDesign = makeDesign({ template: 'tpl-email', html_content: '<p>Hello</p>', mjml_source: null, subject_line: 'Fall is here, {{first_name}}', preheader: 'New arrivals inside' })
const sms = (overrides = {}) => makeCampaign({ channel: 'SMS', status: 'DRAFT', sender_profile: 'snd-sms', sender_profile_name: 'Northwind SMS', template: 'tpl-sms', template_name: 'Fall SMS', ...overrides })
const receipt = () => makeCampaign({ campaign_type: 'E_RECEIPT', status: 'ACTIVE', template: 'tpl-receipt', template_name: 'Northline order receipt', contact_lists: [], contact_list_details: [] })
const completed = () => makeCampaign({ status: 'COMPLETED', completed_at: '2026-09-18T10:02:00Z' })

async function openContent(campaign: ReturnType<typeof makeCampaign>, options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi({ campaign, design: emailDesign, ...options })
  await renderAppAt(`/campaigns/${campaign.id}?tab=content`)
  await screen.findByRole('region', { name: 'Message' })
  return calls
}

const details = () => screen.getByRole('region', { name: 'Details' })
const detail = (label: string) => details().querySelector(`[data-detail="${label}"]`) as HTMLElement
const labels = () => [...details().querySelectorAll('[data-detail]')].map((item) => item.getAttribute('data-detail'))

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Message: the device switch and "Preview As" sit in the card header and work as before; no toolbar row above the preview', async () => {
  const user = userEvent.setup()
  const calls = await openContent(makeCampaign({ status: 'DRAFT' }))
  const card = screen.getByRole('region', { name: 'Message' })
  const frame = await within(card).findByTitle('Email preview')
  expect(frame.className).toContain('max-w-[680px]')
  expect(within(card).queryByText(/· version/)).toBeNull()                                           // the toolbar's template line moved to Details

  await user.click(within(card).getByRole('radio', { name: 'Mobile' }))
  expect(within(card).getByTitle('Email preview').className).toContain('w-[375px]')

  const previewAs = await within(card).findByLabelText('Preview As')
  await user.selectOptions(previewAs, 'P-1')
  await vi.waitFor(() => expect(calls.some((call) => call.url.includes('/campaigns/c1/preview/') && call.url.includes('party_id=P-1'))).toBe(true))
  expect(within(card).getByTitle('Email preview').getAttribute('srcdoc')).toContain('Dolores')
})

test('Message header: the title on the left and the controls on the right in one row; the description opens the body', async () => {
  await openContent(makeCampaign({ status: 'DRAFT' }))
  const card = screen.getByRole('region', { name: 'Message' })
  const [header, body] = [...card.children] as HTMLElement[]
  expect(header.className).toContain('justify-between')
  expect(within(header).getByRole('heading', { name: 'Message' })).toBeTruthy()
  expect(within(header).getByRole('radio', { name: 'Mobile' })).toBeTruthy()
  expect(within(header).queryByText(/sample values, or as one customer/)).toBeNull()
  const description = within(body).getByText("With the catalogue's sample values, or as one customer of the audience would get it.")
  expect(description.className).toContain('text-helper')
  expect(description.className).toContain('text-ink-800')
})

test('the email frame is exactly as tall as the email, in one 1px hairline with no grey box around it', async () => {
  const user = userEvent.setup()
  await openContent(makeCampaign({ status: 'DRAFT' }))
  const card = screen.getByRole('region', { name: 'Message' })
  const measured = async () => {
    const frame = await within(card).findByTitle('Email preview') as HTMLIFrameElement
    const body = frame.contentDocument?.body
    if (body) Object.defineProperty(body, 'scrollHeight', { configurable: true, value: 812 })
    fireEvent.load(frame)
    return frame
  }
  const frame = await measured()
  const bodyStyle = getComputedStyle(frame.contentDocument!.body)
  const margins = (parseFloat(bodyStyle.marginTop) || 0) + (parseFloat(bodyStyle.marginBottom) || 0)
  expect(frame.style.height).toBe(`${812 + margins + 2}px`)                                          // the email, its body margins and the two 1px edges
  expect(frame.className).toContain('border-line')
  expect(frame.className).not.toMatch(/h-\[\d+px\]/)
  expect(frame.closest('.bg-surface-sunken')).toBeNull()

  await user.click(within(card).getByRole('radio', { name: 'Mobile' }))                                // a new width is measured again
  expect((await measured()).className).toContain('w-[375px]')
})

test('MMS: the template image above the text in the full-size preview, or "No image yet"', async () => {
  const mms = () => sms({ channel: 'MMS' })
  await openContent(mms(), { message: makeMessage({ channel: 'MMS', media_asset: mediaLibrary[0] }) })
  const card = () => screen.getByRole('region', { name: 'Message' })
  const image = await within(card()).findByRole('img', { name: 'Attached image' })
  expect(image.getAttribute('src')).toBe('http://cdn.test/lookbook.jpg')
  expect(image.compareDocumentPosition(within(card()).getByLabelText('Text message preview')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

  cleanup()
  await openContent(mms(), { message: makeMessage({ channel: 'MMS' }) })
  expect(await within(card()).findByText('No image yet')).toBeTruthy()

  cleanup()
  await openContent(sms())
  await within(card()).findByLabelText('Text message preview')
  expect(within(card()).queryByText('No image yet')).toBeNull()                                     // an SMS has no picture
})

test('Details for an email: template and version, subject and preheader with sample values, sender with its address, the checks line', async () => {
  await openContent(makeCampaign({ status: 'DRAFT' }))
  expect(labels()).toEqual(['Template', 'Subject Line', 'Preheader', 'Sender'])
  expect(within(detail('Template')).getByText('Based on Fall Email')).toBeTruthy()
  expect(await within(detail('Template')).findByText('Version 3')).toBeTruthy()
  expect(await within(detail('Subject Line')).findByText('Fall is here, Jordan')).toBeTruthy()
  expect(within(detail('Subject Line')).getByText('Shown with sample values')).toBeTruthy()
  expect(within(detail('Preheader')).getByText('New arrivals inside')).toBeTruthy()
  expect(await within(detail('Sender')).findByText('rewards@northwind.example')).toBeTruthy()
  expect((await within(details()).findByTestId('checks-line')).textContent).toBe('No errors')
  expect(within(details()).getByRole('link', { name: 'Edit Content' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=content')
  expect(within(details()).getByRole('link', { name: /Open in the Designer/ }).getAttribute('href')).toBe('/templates/tpl-email/design')
})

test('Details for a text: sender number, and length in characters and segments with Unicode noted; the message on the Templates phone', async () => {
  await openContent(sms())
  expect(labels()).toEqual(['Template', 'Sender', 'Length'])
  expect(await within(detail('Sender')).findByText('55512')).toBeTruthy()
  expect(await within(detail('Length')).findByText('44 characters · 1 segment')).toBeTruthy()
  expect(within(details()).getByRole('link', { name: /Open in the Message Editor/ }).getAttribute('href')).toBe('/templates/tpl-sms/message')
  expect(await screen.findByText('Text Message')).toBeTruthy()                                           // PhoneFrame's header

  cleanup()
  await openContent(sms(), { message: makeMessage({ sms_body: 'Northwind: fall is here 🍂 Reply STOP to opt out.' }) })
  expect(await within(detail('Length')).findByText('Unicode')).toBeTruthy()
})

test('Details for an e-receipt: subject, sender and receipt layout', async () => {
  await openContent(receipt(), { design: makeDesign({ html_content: '<p>Receipt</p>', subject_line: 'Your receipt for order {{order_number}}' }) })
  expect(labels()).toEqual(['Template', 'Subject Line', 'Sender', 'Receipt Layout'])
  expect(await within(detail('Receipt Layout')).findByText('Standard')).toBeTruthy()
})

test('without template.edit there is no link to the editor; a published campaign says which version a send uses', async () => {
  await openContent(completed(), { me: { principal: { ...me.principal, permissions: ['campaign.view', 'campaign.edit', 'campaign.publish'] } } as never })
  expect(within(details()).queryByRole('link', { name: /Open in the/ })).toBeNull()
  expect(within(details()).getByText('A send uses the template version that is current when the run starts.')).toBeTruthy()
  expect(within(details()).getByTestId('checks-line').textContent).toBe('Sent as shown')
  expect(within(details()).queryByRole('link', { name: 'Edit Content' })).toBeNull()
})

test('Send a test shows only when allowed, and still sends', async () => {
  const user = userEvent.setup()
  const calls = await openContent(makeCampaign({ status: 'DRAFT' }))
  const card = screen.getByRole('region', { name: 'Send a Test' })
  await user.clear(within(card).getByLabelText(/Other Addresses/))                                   // it starts with the signed-in person's address
  await user.type(within(card).getByLabelText(/Other Addresses/), 'devon@example.com')
  await user.click(within(card).getByRole('button', { name: 'Send Test' }))
  expect(await within(card).findByText('Sent to devon@example.com')).toBeTruthy()
  expect(calls.some((call) => call.url.endsWith('/campaigns/c1/test-publish/') && call.method === 'POST')).toBe(true)

  cleanup()
  await openContent(completed())
  expect(screen.queryByRole('region', { name: 'Send a Test' })).toBeNull()
})

test('no template: the "No content yet" box with the way to choose one, and Details still there', async () => {
  await openContent(makeCampaign({ status: 'DRAFT', template: null, template_name: null }))
  const card = screen.getByRole('region', { name: 'Message' })
  expect(within(card).getByText('No template chosen yet')).toBeTruthy()
  expect(within(card).getByRole('link', { name: 'Choose a Template' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=content')
  expect(within(card).queryByRole('radio', { name: 'Mobile' })).toBeNull()
  expect(within(detail('Template')).getByText('Not chosen yet')).toBeTruthy()
})
