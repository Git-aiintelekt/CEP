import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, signIn } from '@/test/mockApi'

import { timeLeftWords } from './ProgressCount'

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

async function wizard(stepName: string) {
  const dialog = await screen.findByRole('dialog', { name: 'Create Contact List' })
  await within(dialog).findByText(new RegExp(`· ${stepName}$`))
  return dialog
}

const ids = () => new File(['Customer ID\n10023456\n10023457\n'], 'customers.csv', { type: 'text/csv' })
const CRMS = [{ id: 'db-1', name: 'Citi-iCRM Prod', last_tested_at: '2026-11-24T08:00:00Z' }, { id: 'db-2', name: 'Citi-iCRM Archive', last_tested_at: null }]

test('Look Up in C360: the databases and the role on step 1, a file of Customer IDs on step 2, then consent and a review that says what C360 found', async () => {
  const calls = installMockApi({ listLookupSources: CRMS })
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  await user.click(await screen.findByRole('button', { name: 'Create List' }))

  let dialog = await wizard('List Details')
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Fall Clearance Text List')
  await user.click(within(dialog).getByRole('radio', { name: /Look Up in C360/ }))
  expect(within(dialog).getByText(/^Step 1 of 6/)).toBeTruthy()
  await user.click(within(dialog).getByRole('radio', { name: /^Texts/ }))
  // two databases offered: at least one has to be ticked, and the order they are ticked in is the order they are searched
  expect((within(dialog).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(within(dialog).getByLabelText('Citi-iCRM Archive'))
  await user.click(within(dialog).getByLabelText('Citi-iCRM Prod'))
  expect(within(dialog).getByLabelText('Citi-iCRM Archive (1)')).toBeTruthy()
  expect(within(dialog).getByLabelText('Citi-iCRM Prod (2)')).toBeTruthy()
  expect((within(dialog).getByLabelText(/^Role/) as HTMLSelectElement).value).toBe('CUSTOMER')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  // step 2: the file only, the IDs named for the role; no database or role here
  dialog = await wizard('Customer IDs')
  expect(within(dialog).getByText(/^Add your Customer IDs\. C360 looks each one up/)).toBeTruthy()
  expect(within(dialog).getByText(/2,000,000 Customer IDs/)).toBeTruthy()
  expect(within(dialog).getByText('Customer ID · required')).toBeTruthy()
  expect(within(dialog).queryByLabelText(/^Role/)).toBeNull()
  expect(within(dialog).queryByText('Citi-iCRM Prod')).toBeNull()
  await user.upload(within(dialog).getByLabelText('CSV File'), ids())
  expect(await within(dialog).findByText('customers.csv', { exact: false })).toBeTruthy()
  const upload = calls.find((call) => call.method === 'POST' && call.url.endsWith('/imports/'))
  expect([upload?.form?.get('lookup_connections'), upload?.form?.get('lookup_role')]).toEqual(['db-2,db-1', 'CUSTOMER'])
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  // no columns to match; the Tag Values step is answered while C360 looks the IDs up, and saved on its own
  dialog = await wizard('Tag Values')
  expect(within(dialog).getByRole('button', { name: 'Skip' })).toBeTruthy()
  const template = within(dialog).getByLabelText(/^Check Against a Template/) as HTMLSelectElement
  await vi.waitFor(() => expect(within(template).queryByRole('option', { name: 'Fall SMS' })).not.toBeNull())
  await user.selectOptions(template, 'tpl-sms')
  await within(dialog).findByRole('table', { name: /Where each tag of/ })
  expect((within(dialog).getByLabelText('Value from, for {{points_balance}}') as HTMLSelectElement).value).toBe('ATTRIBUTE')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await vi.waitFor(() => expect(calls.some((call) => call.url.endsWith('/tag-values/'))).toBe(true))
  const saved = calls.find((call) => call.url.endsWith('/tag-values/'))?.body as { tag_values: { template_id: string; tags: Record<string, { from: string }> } }
  expect(saved.tag_values.template_id).toBe('tpl-sms')
  expect(saved.tag_values.tags.points_balance).toEqual({ from: 'ATTRIBUTE', attribute: 'points_balance' })
  expect(calls.some((call) => call.url.endsWith('/review/'))).toBe(false)                            // the lookup queues its own check

  dialog = await wizard('Consent')
  await user.click(within(dialog).getByRole('radio', { name: /Signed up on our website or app/ }))
  await user.click(within(dialog).getByLabelText(/I confirm these people agreed/))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  dialog = await wizard('Review')
  const found = await within(dialog).findByRole('region', { name: 'Looked Up in C360' })
  expect(found.textContent).toContain('Citi-iCRM Archive, Citi-iCRM Prod · role Customer · 6 Customer IDs in 2 s')
  expect(within(found).getByText('Customer ID not found').nextElementSibling?.textContent).toBe('1')
  expect(within(found).getByText('Customer not open to solicitation: imported with no text consent')).toBeTruthy()
  expect(within(found).getByText('Mobile Number').nextElementSibling?.textContent).toContain('100%')
  expect(within(found).getByText('Text Consent').nextElementSibling?.textContent).toContain('75%')
  expect(found.textContent).not.toMatch(/iCRM Database|Check the iCRM Role/)
  const tagged = within(dialog).getByRole('region', { name: 'Tag Values' })
  expect(within(tagged).getByText('3 of 4')).toBeTruthy()                                             // points_balance, read from the database
})

test('without a database ticked for list generation, the way in is not offered; time left reads in plain words', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/contact-lists')
  await user.click(await screen.findByRole('button', { name: 'Create List' }))
  const dialog = await wizard('List Details')
  expect(within(dialog).getByRole('radio', { name: /Upload a File/ })).toBeTruthy()
  expect(within(dialog).queryByRole('radio', { name: /Look Up in C360/ })).toBeNull()
  expect([timeLeftWords(20), timeLeftWords(6 * 60), timeLeftWords(95 * 60)]).toEqual(['less than a minute left', 'about 6 min left', 'about 1 h 35 min left'])
})
