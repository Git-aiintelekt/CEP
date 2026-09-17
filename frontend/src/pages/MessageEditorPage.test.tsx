import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, makeMessage, problem, signIn, templates } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

const counter = () => document.getElementById('sms-counter')?.textContent ?? ''

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('SMS: loads the stored text, previews it with sample values and counts parts on the rendered length', async () => {
  installMockApi()
  await renderAppAt('/templates/tpl-sms/message')

  const body = (await screen.findByLabelText('Message')) as HTMLTextAreaElement
  expect(body.value).toBe('Northwind: Hi {{first_name}}. Reply STOP to opt out.')
  expect(screen.getByTestId('sms-preview').textContent).toBe('Northwind: Hi Jordan. Reply STOP to opt out.')
  expect(counter()).toContain('44 characters') // "Jordan" replaces the 14-character tag
  expect(counter()).toContain('1 part')
  expect(counter()).toContain('GSM-7')
  expect(screen.getByText('Version 1')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true) // nothing changed yet
})

test('SMS: a tag is inserted at the caret, pasted smart punctuation is flagged and can be made plain, and the save carries the version lock', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/templates/tpl-sms/message')

  const body = (await screen.findByLabelText('Message')) as HTMLTextAreaElement
  await user.clear(body)
  await user.type(body, 'Use  today')
  body.setSelectionRange(4, 4)
  await user.selectOptions(screen.getByLabelText('Insert personalization tag'), '{{offer_code}}')
  expect(body.value).toBe('Use {{offer_code}} today')

  await user.click(body)
  await user.paste(' – it’s “yours”')
  expect(counter()).toContain('UCS-2')
  expect(screen.getByText(/outside the standard SMS alphabet/)).toBeTruthy()
  expect(screen.getByText(/No opt-out wording/)).toBeTruthy()

  await user.click(screen.getByRole('button', { name: /Replace curly quotes/ }))
  expect(counter()).toContain('GSM-7')
  expect(body.value).toBe('Use {{offer_code}} today - it\'s "yours"')

  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect((await screen.findByRole('status')).textContent).toContain('Saved as version 2')
  const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/message/'))
  expect(post?.body).toEqual({ sms_body: 'Use {{offer_code}} today - it\'s "yours"', subject_line: '', media_asset: null, base_version: 1 })
})

test('MMS: only MMS-safe pictures are offered, the chosen one is previewed and saved with the subject', async () => {
  const calls = installMockApi({ template: { ...templates[1], id: 'tpl-mms', name: 'Fall MMS', channel: 'MMS', status: 'DRAFT' },
                                 message: makeMessage({ template: 'tpl-mms', channel: 'MMS', version_number: 0, latest_version: 0, sms_body: '', saved_at: null, saved_by: null }) })
  const user = userEvent.setup()
  await renderAppAt('/templates/tpl-mms/message')

  await user.type(await screen.findByLabelText('Message'), 'The lookbook is here. Reply STOP to opt out.')
  await user.type(screen.getByLabelText(/^Subject/), 'Fall lookbook')
  expect(screen.getByText(/No picture yet/)).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Choose from library' }))
  expect(screen.queryByRole('button', { name: 'Use modern.webp' })).toBeNull() // WebP is not reliably delivered over MMS
  await user.click(await screen.findByRole('button', { name: 'Use lookbook.jpg' }))
  expect(screen.queryByText(/No picture yet/)).toBeNull()
  expect(within(screen.getByLabelText('Preview')).getByAltText('Attached picture').getAttribute('src')).toBe('http://cdn.test/lookbook.jpg')

  await user.click(screen.getByRole('button', { name: 'Save' }))
  await screen.findByRole('status')
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/message/'))?.body).toEqual(
    { sms_body: 'The lookbook is here. Reply STOP to opt out.', subject_line: 'Fall lookbook', media_asset: 'img-1', base_version: 0 })
})

test('a save refused by the API explains why: field errors, and a concurrent save', async () => {
  let attempt = 0
  installMockApi({ onSaveMessage: () => (++attempt === 1
    ? problem(400, { title: 'Invalid input', errors: { sms_body: ['A message can be at most 1600 characters (10 segments).'] } })
    : problem(409, { title: 'Conflict', detail: 'This template was saved by someone else (now at version 2). Reload before saving again.' })) })
  const user = userEvent.setup()
  await renderAppAt('/templates/tpl-sms/message')

  await user.type(await screen.findByLabelText('Message'), ' More.')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect((await screen.findByRole('alert')).textContent).toContain('at most 1600 characters')
  expect(screen.getByLabelText('Message').getAttribute('aria-invalid')).toBe('true')

  await user.type(screen.getByLabelText('Message'), '!')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect((await screen.findByRole('alert')).textContent).toContain('saved by someone else')
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toContain('More.!') // the text is not lost
})

test('an email template is pointed to the email designer instead', async () => {
  installMockApi({ template: templates[0] })
  await renderAppAt('/templates/tpl-email/message')

  expect(await screen.findByText('This is not a text message template')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Open the email designer' }).getAttribute('href')).toBe('/templates/tpl-email/design')
})
