/** Template tags from the list on a campaign's Audience step: the Tag Check card with Fill From Database, and an upload's Tag Values step
 * for the campaign's template (docs/mockups/list-tag-values.html, option A with B's card). */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, makeCampaign, signIn } from '@/test/mockApi'
import { TAG_CHECK } from '@/test/mockAttributes'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

async function openStep(campaign = makeCampaign({ status: 'DRAFT' }), options: Parameters<typeof installMockApi>[0] = {}) {
  const calls = installMockApi({ campaign, ...options })
  await renderAppAt('/campaigns/c1/edit?step=audience')
  await screen.findByRole('heading', { level: 2, name: 'Send To' }, { timeout: 5000 })
  return { calls, user: userEvent.setup() }
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('Tag Check: each tag of the template, how many have a value and from where; what the others get; Fill From Database for the short ones', async () => {
  const { calls, user } = await openStep()
  const card = await screen.findByRole('region', { name: 'Tag Check' }, { timeout: 5000 })
  await within(card).findByText('2 Tags Short')
  expect(calls.find((call) => call.url.endsWith('/customer-attributes/tag-check/'))?.body).toEqual({ template: 'tpl-email', include: ['cl-master'], exclude: [] })
  const row = (key: string) => within(card).getByText(`{{${key}}}`, { selector: 'th' }).closest('tr')!
  expect(within(row('first_name')).getByText('Customer record')).toBeTruthy()
  expect(within(row('store_name')).getByText('12,476')).toBeTruthy()
  expect(within(row('points_balance')).getByText('Nowhere yet')).toBeTruthy()
  expect(within(card).getByText(/everyone gets “your”/)).toBeTruthy()
  expect(within(card).getByText(/4 people get/)).toBeTruthy()

  await user.click(within(card).getByRole('button', { name: 'Fill From Database' }))
  const dialog = await screen.findByRole('dialog', { name: 'Fill From Database' })
  expect((within(dialog).getByLabelText('Database field for {{points_balance}}') as HTMLSelectElement).value).toBe('points_balance')
  expect((within(dialog).getByLabelText('Database field for {{store_name}}') as HTMLSelectElement).value).toBe('')          // nothing reads a store from a database
  await user.click(within(dialog).getByRole('button', { name: 'Fill 1 Tag' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Fill From Database' })).toBeNull(), { timeout: 5000 })
  expect(calls.find((call) => call.url.endsWith('/customer-attributes/fill/'))?.body).toEqual({ include: ['cl-master'], exclude: [], campaign: 'c1', tags: [{ tag: 'points_balance', attribute: 'points_balance' }] })
  await waitFor(() => expect(calls.filter((call) => call.url.endsWith('/customer-attributes/tag-check/')).length).toBeGreaterThan(1))   // counted again
})

test('Tag Check: every tag has a value: one line, with the details a click away', async () => {
  const all = { ...TAG_CHECK, short: 0, fillable: [], tags: TAG_CHECK.tags.map((tag) => ({ ...tag, with_value: 12480, missing: 0, from: 'LIST' as const })) }
  const { user } = await openStep(makeCampaign({ status: 'DRAFT' }), { tagCheck: all })
  const card = await screen.findByRole('region', { name: 'Tag Check' }, { timeout: 5000 })
  expect(await within(card).findByText(/3 tags, a value for all 12,480 people/)).toBeTruthy()
  expect(within(card).getByText('All Tags Have Values')).toBeTruthy()
  await user.click(within(card).getByRole('button', { name: 'Details' }))
  expect(within(card).getByRole('table')).toBeTruthy()
})

test('Tag Check before a template is chosen: where it comes from', async () => {
  await openStep(makeCampaign({ status: 'DRAFT', template: null, template_name: null }))
  const card = await screen.findByRole('region', { name: 'Tag Check' }, { timeout: 5000 })
  expect(within(card).getByText(/Choose the template on the Content step/)).toBeTruthy()
})

test('an upload from the campaign asks where each of its template’s tags gets its value, sends the answer with the mapping, and the review counts it', async () => {
  const { calls, user } = await openStep(makeCampaign({ status: 'DRAFT', contact_lists: [], contact_list_details: [] }))
  await user.click(within(screen.getByRole('region', { name: 'Send To' })).getAllByRole('button', { name: 'Add Contact List' })[0])
  const dialog = await screen.findByRole('dialog', { name: 'Add Contact List' })
  await user.click(within(dialog).getByRole('radio', { name: 'Upload New' }))
  await user.type(within(dialog).getByLabelText(/^List Name/), 'Black Friday file')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await user.upload(await within(dialog).findByLabelText('CSV File'), new File(['Email Address,First Name,Notes\na@x.example,Ana,Midtown\n'], 'leads.csv', { type: 'text/csv' }))
  await within(dialog).findByText('leads.csv')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await within(dialog).findByRole('table', { name: /Columns of leads\.csv/ })
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))

  const step = await waitFor(() => { const found = dialog.querySelector<HTMLElement>('[data-tag-values-step]'); expect(found).not.toBeNull(); return found! })
  expect((within(step).getByLabelText(/^Template/) as HTMLSelectElement).value).toBe('tpl-email')          // the campaign's own
  await within(step).findByRole('table')
  expect((within(step).getByLabelText('Value from, for {{first_name}}') as HTMLSelectElement).value).toBe('CUSTOMER')
  expect((within(step).getByLabelText('Value from, for {{points_balance}}') as HTMLSelectElement).value).toBe('ATTRIBUTE')
  const storeFrom = within(step).getByLabelText('Value from, for {{store_name}}') as HTMLSelectElement
  expect(storeFrom.value).toBe('FILE')
  await user.selectOptions(storeFrom, 'DEFAULT')
  expect(within(step).getByText('“your nearest store” for everyone')).toBeTruthy()
  await user.selectOptions(storeFrom, 'FILE')
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  await within(dialog).findByRole('heading', { name: 'How did these people opt in?' })
  const posted = calls.find((call) => call.url.endsWith('/review/'))?.body as { tag_values: { template_id: string; tags: Record<string, unknown> } }
  expect(posted.tag_values.template_id).toBe('tpl-email')
  expect(posted.tag_values.tags).toEqual({ first_name: { from: 'CUSTOMER' }, store_name: { from: 'FILE', column: expect.any(String) }, points_balance: { from: 'ATTRIBUTE', attribute: 'points_balance' } })

  await user.click(within(dialog).getByRole('radio', { name: /Signed up on our website or app/ }))
  await user.click(within(dialog).getByLabelText(/^I confirm these people agreed/))
  await user.click(within(dialog).getByRole('button', { name: 'Next' }))
  const section = await within(dialog).findByRole('region', { name: 'Tag Values' }, { timeout: 5000 })
  expect(within(section).getByText('3 of 4')).toBeTruthy()
  expect(within(section).getByText(/People without a value get the tag’s default/)).toBeTruthy()
})
