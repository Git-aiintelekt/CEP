import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'

import { ToastProvider } from '@/components/Toast'
import { ApiError, api } from '@/lib/api'
import type { ReceiptLayoutSummary } from '@/lib/types'

import { ReceiptLayoutLibrary } from './ReceiptLayoutLibrary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const row = (over: Partial<ReceiptLayoutSummary>): ReceiptLayoutSummary => ({
  id: 'lay-1', name: 'Citi Register', layout_preset: 'REGISTER', kind: 'SETTINGS', used_by: 3, version_number: 2, updated_at: '2026-11-21T10:00:00Z', updated_by: 'Aby John', archived: false, ...over,
})

function setup(rows: ReceiptLayoutSummary[], canEdit = true) {
  const get = vi.spyOn(api, 'get').mockImplementation(async () => rows as never)
  const post = vi.spyOn(api, 'post')
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/templates']}>
        <ToastProvider>
          <Routes>
            <Route path="/templates" element={<ReceiptLayoutLibrary canEdit={canEdit} />} />
            <Route path="/templates/receipt-layouts/:id" element={<p>Layout editor</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { user, get, post }
}

test('lists each layout with its kind and the templates that use it', async () => {
  setup([row({}), row({ id: 'lay-2', name: 'Holiday Receipt', layout_preset: 'CUSTOM_HTML', kind: 'CUSTOM_HTML', used_by: 1 })])
  const table = await screen.findByRole('table')
  const lines = within(table).getAllByRole('row').slice(1).map((line) => line.textContent)
  expect(lines[0]).toContain('Citi Register')
  expect(lines[0]).toContain('3 templates')
  expect(lines[1]).toContain('Custom HTML')
  expect(lines[1]).toContain('1 template')
})

test('an empty library says what a layout is and offers New Layout', async () => {
  setup([])
  expect(await screen.findByText('No Receipt Layouts Yet')).toBeTruthy()
  expect(screen.getAllByRole('button', { name: 'New Layout' }).length).toBeGreaterThan(0)
})

test('New Layout posts the name and the Store Register defaults, then opens the layout', async () => {
  const { user, post } = setup([])
  post.mockImplementation(async () => ({ ...row({ id: 'lay-9', name: 'Store 2001' }), sections: [], custom_html: null, custom_css: null, item_row: null, register: null, templates: [] }) as never)
  await user.click((await screen.findAllByRole('button', { name: 'New Layout' }))[0])
  await user.type(screen.getByLabelText(/Name/), 'Store 2001')
  await user.click(screen.getByRole('button', { name: 'Create Layout' }))
  await waitFor(() => expect(post).toHaveBeenCalled())
  const [url, body] = post.mock.calls[0] as [string, Record<string, unknown>]
  expect(url).toBe('/receipt-layouts/')
  expect(body).toMatchObject({ name: 'Store 2001', layout_preset: 'REGISTER' })
  expect((body.register as { title: string }).title).toBe('YOUR RECEIPT')
  expect(await screen.findByText('Layout editor')).toBeTruthy()
})

test('archiving a layout a template uses shows the server\'s refusal', async () => {
  const { user, post } = setup([row({})])
  post.mockRejectedValue(new ApiError(409, { detail: 'Used by Citi receipt. Pick another layout in those templates first.' }))
  await user.click(await screen.findByRole('button', { name: 'Actions for Citi Register' }))
  await user.click(screen.getByRole('button', { name: /^Archive$/ }))
  await user.click(screen.getByRole('button', { name: 'Archive Layout' }))
  expect(await screen.findByText(/Pick another layout in those templates first/)).toBeTruthy()
})

test('without template.edit there is nothing to create or change', async () => {
  setup([row({})], false)
  await screen.findByRole('table')
  expect(screen.queryByRole('button', { name: 'New Layout' })).toBeNull()
})
