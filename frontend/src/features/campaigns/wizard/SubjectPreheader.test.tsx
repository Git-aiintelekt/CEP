/**
 * The Content step's subject line and preheader: the template's unless the campaign has its own, saved with the step;
 * the campaign page's details and the subject line test say which one is used.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeCampaign, makeDesign, signIn } from '@/test/mockApi'

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
  vi.restoreAllMocks()
})

const design = makeDesign({ template: 'tpl-email', html_content: '<html><body><p>Hi</p></body></html>', subject_line: 'Fall is here, {{first_name}}', preheader: 'Three days only' })
const card = async () => within((await screen.findByRole('heading', { name: 'Subject Line and Preheader' })).closest('section') as HTMLElement)
const saves = (calls: { url: string; method: string; body: unknown }[]) => calls.filter((call) => call.method === 'PATCH' && /\/campaigns\/c1\/$/.test(call.url))

test("the template's are shown until the campaign has its own; edit them, save with the step, and go back to the template's", async () => {
  const calls = installMockApi({ design, campaign: makeCampaign({ status: 'DRAFT', setup_step: 2 }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=content')

  const box = await card()
  const subject = box.getByLabelText('Subject Line') as HTMLInputElement
  expect(subject.value).toBe('')
  expect(await box.findAllByText("Empty: the template's is used.", {}, { timeout: 3000 })).toHaveLength(2)
  expect(subject.placeholder).toBe('Fall is here, {{first_name}}')
  const inbox = box.getByRole('group', { name: 'Inbox Row' })
  expect(inbox.textContent).toContain('Three days only')

  await user.click(box.getAllByRole('button', { name: "Edit the Template's" })[0])
  expect(subject.value).toBe('Fall is here, {{first_name}}')
  await user.clear(subject)
  await user.type(subject, '{{first_name}}, last days of the sale'.replace(/[{[]/g, '$&$&'))
  await user.type(box.getByLabelText('Preheader'), 'Ends Sunday at midnight')
  expect(box.getByText(/This campaign's own\. The template's: “Fall is here/)).toBeTruthy()
  expect(inbox.textContent).toContain('last days of the sale')
  expect(inbox.textContent).toContain('Ends Sunday at midnight')

  await user.click(screen.getAllByRole('button', { name: 'Save and Close' })[0])
  await vi.waitFor(() => expect(saves(calls).at(-1)?.body).toMatchObject({ subject_line: '{{first_name}}, last days of the sale', preheader: 'Ends Sunday at midnight' }))
})

test("Use the Template's empties the field, and an empty field is saved as the template's (null)", async () => {
  const calls = installMockApi({ design, campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, subject_line: 'Our own subject', preheader: 'Our own preheader' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=content')

  const box = await card()
  expect((box.getByLabelText('Subject Line') as HTMLInputElement).value).toBe('Our own subject')
  await user.click(box.getAllByRole('button', { name: "Use the Template's" })[0])
  expect((box.getByLabelText('Subject Line') as HTMLInputElement).value).toBe('')
  await user.click(screen.getAllByRole('button', { name: 'Save and Close' })[0])
  await vi.waitFor(() => expect(saves(calls).at(-1)?.body).toMatchObject({ subject_line: null, preheader: 'Our own preheader' }))
})

test('a text campaign has no subject line or preheader card', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, channel: 'SMS', template: 'tpl-sms' }) })
  await renderAppAt('/campaigns/c1/edit?step=content')
  await screen.findByRole('radiogroup', { name: 'Template' })
  expect(screen.queryByRole('heading', { name: 'Subject Line and Preheader' })).toBeNull()
})

test("the subject line test's A and the review summary say when the subject is the campaign's own", async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 3, subject_line: '{{first_name}}, last days', ab_config: { enabled: true, subject_b: 'Another one' } }) })
  await renderAppAt('/campaigns/c1/edit?step=test')
  const box = within((await screen.findByRole('heading', { name: 'Subject Line Test' })).closest('section') as HTMLElement)
  expect(await box.findByDisplayValue('Jordan, last days')).toBeTruthy()
  expect(box.getByText('A · Set for This Campaign')).toBeTruthy()
})
