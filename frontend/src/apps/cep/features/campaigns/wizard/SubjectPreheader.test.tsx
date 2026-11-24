/**
 * The Content step's subject line and preheader: the template's unless the campaign has its own, saved with the step;
 * the campaign page's details and the subject line test say which one is used.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, makeDesign, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const design = makeDesign({ template: 'tpl-email', html_content: '<html><body><p>Hi</p></body></html>', subject_line: 'Fall is here, {{first_name}}', preheader: 'Three days only' })
/** the Subject and Preheader row, opened with Override when it is collapsed */
const card = async () => {
  const section = (await screen.findByRole('heading', { name: 'Subject and Preheader' })).closest('section') as HTMLElement
  const override = within(section).queryByRole('button', { name: 'Override' })
  if (override) await userEvent.click(override)
  return within(section)
}
const saves = (calls: { url: string; method: string; body: unknown }[]) => calls.filter((call) => call.method === 'PATCH' && /\/campaigns\/c1\/$/.test(call.url))

test("the template's are shown until the campaign has its own; edit them, save with the step, and go back to the template's", async () => {
  const calls = installMockApi({ design, campaign: makeCampaign({ status: 'DRAFT', setup_step: 2 }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=content')

  const box = await card()
  const subject = box.getByLabelText('Subject Line') as HTMLInputElement
  expect(subject.value).toBe('')
  await vi.waitFor(() => expect(subject.placeholder).toBe('Fall is here, {{first_name}}'), { timeout: 3000 })      // the template's, as the placeholder
  expect(box.queryByText(/is used\./)).toBeNull()                                                              // no helper lines under the fields
  expect(screen.queryByRole('tab', { name: 'In the Inbox' })).toBeNull()                                // no inbox preview any more

  await user.click(box.getAllByRole('button', { name: "Edit the Template's" })[0])
  expect(subject.value).toBe('Fall is here, {{first_name}}')
  await user.clear(subject)
  await user.type(subject, '{{first_name}}, last days of the sale'.replace(/[{[]/g, '$&$&'))
  await user.type(box.getByLabelText('Preheader'), 'Ends Sunday at midnight')

  await user.click(screen.getAllByRole('button', { name: 'Save and Close' })[0])
  await vi.waitFor(() => expect(saves(calls).at(-1)?.body).toMatchObject({ subject_line: '{{first_name}}, last days of the sale', preheader: 'Ends Sunday at midnight' }))
})

test("the row starts open when the campaign has its own; Use Template's clears both, closes it, and both are saved as the template's (null)", async () => {
  const calls = installMockApi({ design, campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, subject_line: 'Our own subject', preheader: 'Our own preheader' }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=content')

  const box = await card()
  expect(box.queryByRole('button', { name: 'Override' })).toBeNull()                                    // already overridden: open, with the way back
  expect((box.getByLabelText('Subject Line') as HTMLInputElement).value).toBe('Our own subject')
  expect(box.getByText('15 / 60')).toBeTruthy()                                                          // the counter and the emoji button are in the label row
  await user.click(box.getByRole('button', { name: 'Use Template’s' }))
  expect(box.queryByLabelText('Subject Line')).toBeNull()                                                // closed
  expect(box.getByRole('button', { name: 'Override' })).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: 'Save and Close' })[0])
  await vi.waitFor(() => expect(saves(calls).at(-1)?.body).toMatchObject({ subject_line: null, preheader: null }))
})

test('a text campaign has no subject line or preheader card', async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 2, channel: 'SMS', template: 'tpl-sms' }) })
  await renderAppAt('/campaigns/c1/edit?step=content')
  await screen.findByRole('group', { name: 'Template' })
  expect(screen.queryByRole('heading', { name: 'Subject and Preheader' })).toBeNull()
})

test("the subject line test's A and the review summary say when the subject is the campaign's own", async () => {
  installMockApi({ campaign: makeCampaign({ status: 'DRAFT', setup_step: 3, subject_line: '{{first_name}}, last days', ab_config: { enabled: true, subject_b: 'Another one' } }) })
  await renderAppAt('/campaigns/c1/edit?step=test')
  const box = within((await screen.findByRole('heading', { name: 'Subject Line Test' })).closest('section') as HTMLElement)
  expect(await box.findByDisplayValue('Jordan, last days')).toBeTruthy()
  expect(box.getByText('A · Set for This Campaign')).toBeTruthy()
})

test("an emoji picked while the subject is empty is added to the template's line, which becomes the campaign's own; then it goes in at the caret", async () => {
  installMockApi({ design, campaign: makeCampaign({ status: 'DRAFT', setup_step: 2 }) })
  const user = userEvent.setup()
  await renderAppAt('/campaigns/c1/edit?step=content')

  const box = await card()
  const subject = box.getByLabelText('Subject Line') as HTMLInputElement
  await vi.waitFor(() => expect((box.getByLabelText('Subject Line') as HTMLInputElement).placeholder).toBe('Fall is here, {{first_name}}'), { timeout: 3000 })
  await user.click(box.getAllByRole('button', { name: 'Insert Emoji' })[0])
  await user.click(await within(await screen.findByRole('region', { name: 'Insert Emoji' })).findByRole('option', { name: 'fire' }))
  await vi.waitFor(() => expect(subject.value).toBe('Fall is here, {{first_name}}🔥'))
  // the card puts the caret after the emoji on the next frame: let that frame pass, or it moves the caret set below back to the end
  await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))

  subject.setSelectionRange(0, 0)
  await user.click(box.getAllByRole('button', { name: 'Insert Emoji' })[0])
  await user.click(await within(await screen.findByRole('region', { name: 'Insert Emoji' })).findByRole('option', { name: 'fire' }))
  await vi.waitFor(() => expect(subject.value).toBe('🔥Fall is here, {{first_name}}🔥'))
})
