import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { installMockApi, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App')
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const table = () => screen.getByRole('table', { name: 'Personalization tags' })

test('Tags: every tag with where it reads from and its origin; a platform tag cannot be edited here; the channel filter narrows the list', async () => {
  installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/tags')
  await screen.findByRole('table', { name: 'Personalization tags' }, { timeout: 5000 })   // the app's cold import can take most of a second
  const first = within(table()).getByText('{{first_name}}').closest('tr')!
  expect(within(first).getByText('Platform')).toBeTruthy()
  expect(within(first).getByText('Changed in the back-office')).toBeTruthy()
  expect(within(first).getByText(/Customer/).textContent).toContain('first_name')
  const offer = within(table()).getByText('{{offer_code}}').closest('tr')!
  expect(within(offer).getByText('Workspace')).toBeTruthy()
  expect(within(offer).getByRole('button', { name: 'Edit' })).toBeTruthy()
  await user.click(screen.getByRole('radio', { name: 'E-Receipt' }))
  expect(screen.queryByRole('table', { name: 'Personalization tags' })).toBeNull()                        // neither sample tag is offered for receipts
  expect(screen.getByText('No tags here yet')).toBeTruthy()
})

test('Add Tag: the key is checked, the data point comes from the catalogue, the tag is posted with CUSTOM / CEP and appears in the list', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/tags')
  await screen.findByRole('table', { name: 'Personalization tags' }, { timeout: 5000 })   // the app's cold import can take most of a second
  await user.click(screen.getByRole('button', { name: 'Add Tag' }))
  const dialog = await screen.findByRole('dialog', { name: 'New Tag' })
  await user.type(within(dialog).getByLabelText(/^Tag Key/), 'Store Total')
  await user.type(within(dialog).getByLabelText(/^Label/), 'Store total')
  await user.click(within(dialog).getByRole('button', { name: 'Add Tag' }))
  expect(within(dialog).getByText(/Lower-case letters, digits and underscores/)).toBeTruthy()
  await user.clear(within(dialog).getByLabelText(/^Tag Key/))
  await user.type(within(dialog).getByLabelText(/^Tag Key/), 'store_total')
  await user.selectOptions(within(dialog).getByLabelText(/^Reads From/), 'TRANSACTION')
  await user.selectOptions(within(dialog).getByLabelText(/^Data Point/), 'grand_total')
  expect((within(dialog).getByLabelText(/^Type/) as HTMLSelectElement).value).toBe('NUMBER')                   // the point's own type
  await user.type(within(dialog).getByLabelText(/^Sample Value/), '144.11')
  await user.click(within(dialog).getByRole('button', { name: 'Add Tag' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const post = calls.find((call) => call.method === 'POST' && call.url.endsWith('/personalization-tags/'))!
  expect(post.body).toMatchObject({ tag_key: 'store_total', label: 'Store total', tag_kind: 'CUSTOM', source_system: 'CEP', resolution_source: 'TRANSACTION', source_path: 'grand_total', data_type: 'NUMBER', sample_value: '144.11', static_value: null })
  expect(within(table()).getByText('{{store_total}}')).toBeTruthy()
})

test('a static tag, a customer attribute key, and removing a workspace tag', async () => {
  const calls = installMockApi()
  const user = userEvent.setup()
  await renderAppAt('/settings/tags')
  await screen.findByRole('table', { name: 'Personalization tags' }, { timeout: 5000 })   // the app's cold import can take most of a second
  await user.click(screen.getByRole('button', { name: 'Add Tag' }))
  let dialog = await screen.findByRole('dialog', { name: 'New Tag' })
  await user.type(within(dialog).getByLabelText(/^Tag Key/), 'brand')
  await user.type(within(dialog).getByLabelText(/^Label/), 'Brand')
  await user.selectOptions(within(dialog).getByLabelText(/^Reads From/), 'STATIC')
  await user.click(within(dialog).getByRole('button', { name: 'Add Tag' }))
  expect(within(dialog).getByText('Type the value this tag always carries.')).toBeTruthy()
  await user.type(within(dialog).getByLabelText(/^Static Value/), 'Northwind')
  await user.click(within(dialog).getByRole('button', { name: 'Add Tag' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((call) => call.method === 'POST').at(-1)!.body).toMatchObject({ resolution_source: 'STATIC', source_path: null, static_value: 'Northwind' })

  await user.click(screen.getByRole('button', { name: 'Add Tag' }))
  dialog = await screen.findByRole('dialog', { name: 'New Tag' })
  await user.type(within(dialog).getByLabelText(/^Tag Key/), 'shoe_size')
  await user.type(within(dialog).getByLabelText(/^Label/), 'Shoe size')
  await user.selectOptions(within(dialog).getByLabelText(/^Data Point/), 'custom_attributes.')
  await user.type(within(dialog).getByLabelText(/^Key/), 'shoe_size')
  await user.click(within(dialog).getByRole('button', { name: 'Add Tag' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.filter((call) => call.method === 'POST').at(-1)!.body).toMatchObject({ resolution_source: 'CUSTOMER_MASTER', source_path: 'custom_attributes.shoe_size' })

  const offer = within(table()).getByText('{{offer_code}}').closest('tr')!
  await user.click(within(offer).getByRole('button', { name: 'Remove' }))
  await waitFor(() => expect(within(table()).queryByText('{{offer_code}}')).toBeNull())
  expect(calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/personalization-tags/offer_code/'))).toBe(true)
})
