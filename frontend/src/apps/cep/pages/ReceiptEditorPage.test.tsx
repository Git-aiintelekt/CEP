import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { ReceiptLayout, ReceiptLayoutSaveInput, Template } from '@/lib/types'
import { resetFakeCanvas } from '@/test/fakeCanvas'
import { cepReady, installMockApi, makeReceiptLayout, signIn, templates } from '@/test/mockApi'

// GrapesJS needs a real browser layout engine; the canvas is checked in the browser playground (/dev/receipt)
vi.mock('@/apps/cep/features/receipt/OuterDesignPane', () => import('@/test/fakeOuterDesignPane'))

const receipt = templates.find((item) => item.id === 'tpl-receipt') as Template

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  resetFakeCanvas()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('opens the real receipt editor on the template, its outer design and its receipt layout', async () => {
  const calls = installMockApi({ template: receipt })
  await renderAppAt('/templates/tpl-receipt/receipt')

  // the editor is a lazy route: under a full test run it can take a moment to arrive
  expect(await screen.findByRole('heading', { name: 'Northline order receipt' }, { timeout: 5000 })).toBeTruthy()
  expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Outer Design', 'Receipt Layout', 'Preview & Test'])
  expect(screen.queryByText(/coming soon/i)).toBeNull()
  expect(document.querySelector('header .cep-num')?.textContent).toContain('Outer design v1 · receipt layout v1')

  const got = (path: string) => calls.some((call) => call.method === 'GET' && call.url.split('?')[0].endsWith(path))
  expect(got('/templates/tpl-receipt/')).toBe(true)
  expect(got('/templates/tpl-receipt/design/')).toBe(true)
  expect(got('/templates/tpl-receipt/receipt/')).toBe(true)
})

test('Save sends both parts to their own endpoints, each with its version lock', async () => {
  const calls = installMockApi({ template: receipt })
  const user = userEvent.setup()
  await renderAppAt('/templates/tpl-receipt/receipt')
  await screen.findByRole('heading', { name: 'Northline order receipt' }, { timeout: 5000 })

  await user.click(screen.getByRole('button', { name: 'Remove the footer' }))
  await user.click(screen.getByRole('tab', { name: 'Receipt Layout' }))
  await user.click(screen.getByRole('switch', { name: 'Show Loyalty' }))
  await user.click(screen.getByRole('button', { name: 'Save Draft' }))

  await waitFor(() => expect(document.querySelector('header .cep-num')?.textContent).toContain('Outer design v2 · receipt layout v2'))
  const posted = (path: string) => calls.find((call) => call.method === 'POST' && call.url.endsWith(path))?.body
  expect(posted('/templates/tpl-receipt/design/')).toMatchObject({ base_version: 1 })
  const layout = posted('/templates/tpl-receipt/receipt/') as unknown as ReceiptLayoutSaveInput
  expect(layout.base_version).toBe(1)
  expect(layout.sections.find((section) => section.key === 'loyalty')?.visible).toBe(false)
})

test('an email template sent here says it belongs elsewhere', async () => {
  installMockApi({ template: templates.find((item) => item.id === 'tpl-email') })
  await renderAppAt('/templates/tpl-email/receipt')
  expect(await screen.findByText('This is not an e-receipt template')).toBeTruthy()
  expect(screen.queryByRole('tab', { name: 'Outer Design' })).toBeNull()
})

test('the mock receipt endpoints answer the layout, its versions, and a first save as version 1', async () => {
  const calls = installMockApi({ receiptLayout: makeReceiptLayout({ version_number: 0, latest_version: 0, saved_at: null, saved_by: null }) })
  signIn()
  vi.resetModules()
  const { api } = await import('@/lib/api')

  const layout = await api.get<ReceiptLayout>('/templates/tpl-receipt/receipt/')
  expect(calls.some((call) => call.url.includes('/templates/tpl-receipt/receipt/') && call.method === 'GET')).toBe(true)
  expect(layout.layout_preset).toBe('STANDARD')
  expect(layout.sections).toHaveLength(7)
  expect(layout.sections.map((section) => section.key)).toEqual(['header', 'customer_fulfillment', 'items', 'totals', 'payment', 'loyalty', 'support'])
  expect(layout.sections.filter((section) => section.locked).map((section) => section.key)).toEqual(['header', 'items', 'totals'])

  const input: ReceiptLayoutSaveInput = { layout_preset: 'COMPACT', sections: layout.sections, custom_html: null, custom_css: null, base_version: layout.version_number }
  const saved = await api.post<ReceiptLayout>('/templates/tpl-receipt/receipt/', input)
  expect(saved.version_number).toBe(1)
  expect(saved.layout_preset).toBe('COMPACT')

  expect(await api.get('/templates/tpl-receipt/receipt/versions/')).toEqual([{ version_number: 0, saved_at: '2026-09-02T10:00:00Z', saved_by: 'Devon Okafor' }])
})
