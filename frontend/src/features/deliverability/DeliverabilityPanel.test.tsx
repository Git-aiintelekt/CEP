import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'

import type { DeliverabilityAllowance, DeliverabilityTest } from '@/lib/types'

import { sampleDeliverability, type DeliverabilityBackend } from './backend'
import { DeliverabilityPanel } from './DeliverabilityPanel'

afterEach(cleanup)

function mount(backend: DeliverabilityBackend, props: Partial<{ active: boolean; savedVersion: number; dirty: boolean; readOnly: boolean }> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}><MemoryRouter>
      <DeliverabilityPanel backend={backend} active={props.active ?? true} savedVersion={props.savedVersion ?? 2} dirty={props.dirty ?? false} readOnly={props.readOnly} />
    </MemoryRouter></QueryClientProvider>,
  )
}

const allowance = (over: Partial<DeliverabilityAllowance> = {}): DeliverabilityAllowance => ({ enabled: true, used: 3, limit: 20, left: 17, month: '2026-10-01', plan: 'Growth', configured: true, ...over })
const backendWith = (tests: DeliverabilityTest[], over: Partial<DeliverabilityAllowance> = {}): DeliverabilityBackend => ({
  list: vi.fn(async () => ({ tests: tests.map((t) => ({ ...t, previews: [] })), allowance: allowance(over) })),
  start: vi.fn(async () => tests[0]),
  read: vi.fn(async (id: string) => tests.find((t) => t.id === id) as DeliverabilityTest),
  remove: vi.fn(async () => undefined),
})

test('a finished test: the allowance, the history, the three cards (previews, the spam and placement slots), the renders grouped by client kind, a failed one named', async () => {
  const sample = sampleDeliverability()
  const finished = await sample.read('sample-1')
  mount(backendWith([finished]))

  expect(await screen.findByLabelText('3 of 20 tests used this month')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Run Inbox Previews' }).hasAttribute('disabled')).toBe(false)
  expect(screen.getByText(/Tests use the last saved version \(v2\)\./)).toBeTruthy()
  const history = screen.getByRole('navigation', { name: 'Test history' })
  expect(within(history).getByText('Inbox previews · v2')).toBeTruthy()
  expect(within(history).getByText('Complete')).toBeTruthy()

  const result = await screen.findByRole('region', { name: 'Test result' })
  expect(await within(result).findByText('7 of 8 rendered, 1 failed')).toBeTruthy()
  expect(within(result).getByText('Spam Verdict')).toBeTruthy()
  expect(within(result).getByText('Not in your plan')).toBeTruthy()
  expect(within(result).getByText('Inbox Placement')).toBeTruthy()
  expect(within(result).getByText('Not available yet')).toBeTruthy()
  expect(within(result).getByRole('region', { name: 'Webmail' })).toBeTruthy()
  expect(within(within(result).getByRole('region', { name: 'Phones and Tablets' })).getByText('Did not render')).toBeTruthy()
  expect(within(result).getByText('The client did not load the message.')).toBeTruthy()
  expect(within(result).getAllByRole('button', { name: /^Open the .* render$/ })).toHaveLength(7)
})

test('opening a render shows the full screenshot in a dialog named after the client', async () => {
  const user = userEvent.setup()
  const sample = sampleDeliverability()
  mount(backendWith([await sample.read('sample-1')]))
  await user.click(await screen.findByRole('button', { name: 'Open the Gmail (Chrome) render' }))
  const dialog = await screen.findByRole('dialog', { name: 'Gmail (Chrome)' })
  expect(within(dialog).getByText('Windows · Chrome')).toBeTruthy()
  expect((within(dialog).getByRole('img', { name: 'Gmail (Chrome) render' }) as HTMLImageElement).src.startsWith('data:image/svg+xml')).toBe(true)
})

test('the open render steps through every render, desktop and mobile: Previous and Next, the arrow keys, the picker; a failed one is left out', async () => {
  const user = userEvent.setup()
  const sample = sampleDeliverability()
  mount(backendWith([await sample.read('sample-1')]))
  await user.click(await screen.findByRole('button', { name: 'Open the Gmail (Chrome) render' }))
  let dialog = await screen.findByRole('dialog', { name: 'Gmail (Chrome)' })
  expect(within(dialog).getByText(/1 of 7/)).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Previous Render' }).hasAttribute('disabled')).toBe(true)

  await user.click(within(dialog).getByRole('button', { name: 'Next Render' }))
  dialog = await screen.findByRole('dialog', { name: 'Outlook.com (Edge)' })
  expect(within(dialog).getByRole('img', { name: 'Outlook.com (Edge) render' })).toBeTruthy()
  await user.keyboard('{ArrowRight}')
  dialog = await screen.findByRole('dialog', { name: 'Yahoo! Mail (Chrome)' })
  await user.keyboard('{ArrowLeft}')
  dialog = await screen.findByRole('dialog', { name: 'Outlook.com (Edge)' })

  const picker = within(dialog).getByRole('combobox', { name: 'Render' }) as HTMLSelectElement
  expect(within(picker).getAllByRole('option')).toHaveLength(7)
  expect(within(picker).queryByRole('option', { name: /Outlook \(iPhone\)/ })).toBeNull()
  expect(within(picker).getAllByRole('group').map((group) => group.getAttribute('label'))).toEqual(['Webmail', 'Desktop Apps', 'Phones and Tablets'])
  await user.selectOptions(picker, 'gmail_android')
  dialog = await screen.findByRole('dialog', { name: 'Gmail (Pixel 8)' })
  expect(within(dialog).getByText(/7 of 7/)).toBeTruthy()
  expect(within(dialog).getByRole('button', { name: 'Next Render' }).hasAttribute('disabled')).toBe(true)
  await user.click(within(dialog).getByRole('button', { name: 'Previous Render' }))
  expect(await screen.findByRole('dialog', { name: 'iPhone 15' })).toBeTruthy()
})

test('Run Inbox Previews starts a test, selects it, and the panel keeps reading it while it renders', async () => {
  const user = userEvent.setup()
  const sample = sampleDeliverability()
  mount(sample)
  expect(await screen.findByText('Inbox previews · v2')).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Run Inbox Previews' }))
  const history = screen.getByRole('navigation', { name: 'Test history' })
  expect(await within(history).findByText('Inbox previews · v3')).toBeTruthy()
  expect(within(history).getAllByRole('button')[0].getAttribute('aria-current')).toBe('true')
  expect(await screen.findByText('Rendering in 8 clients')).toBeTruthy()
  expect(await screen.findByLabelText('2 of 20 tests used this month')).toBeTruthy()
})

test('the button is held back with the reason: no account, nothing saved, allowance spent, the plan without the feature, read-only', async () => {
  const sample = sampleDeliverability()
  const finished = await sample.read('sample-1')
  const cases: [Partial<DeliverabilityAllowance>, Partial<{ savedVersion: number; readOnly: boolean }>, RegExp][] = [
    [{ configured: false }, {}, /No inbox-preview account is available\./],
    [{}, { savedVersion: 0 }, /Save the design once before testing/],
    [{ used: 20, left: 0 }, {}, /No inbox previews left this month: all 20 for October are used\. More become available on Nov 1/],
    [{ used: 25, limit: 25, left: 0, plan_limit: 20, added: 5 }, {}, /all 25 for October are used \(20 on the Growth plan \+ 5 added\)/],
    [{ enabled: false }, {}, /not included in this workspace’s plan/],
    [{}, { readOnly: true }, /read-only here/],
  ]
  for (const [over, props, text] of cases) {
    const view = mount(backendWith([finished], over), props)
    expect(await screen.findByText(text)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run Inbox Previews' }).hasAttribute('disabled')).toBe(true)
    view.unmount()
  }
  mount(backendWith([finished], { configured: false }))
  expect(await screen.findByRole('link', { name: /add your own Mailgun Inspect account/ })).toBeTruthy()
})

test('the allowance line: the plan’s number through CEP’s account, no limit through the workspace’s own', async () => {
  const sample = sampleDeliverability()
  const finished = await sample.read('sample-1')
  const shared = mount(backendWith([finished], { account: 'PLATFORM' }))
  expect(await screen.findByText(/3 of 20 tests used this month/)).toBeTruthy()
  shared.unmount()
  mount(backendWith([finished], { account: 'OWN', limit: null, left: null }))
  expect(await screen.findByText(/3 tests this month · your own Mailgun account/)).toBeTruthy()
})

test('with no tests yet the panel says so; an inactive tab fetches nothing', async () => {
  const backend = backendWith([])
  mount(backend)
  expect(await screen.findByText('No tests yet')).toBeTruthy()
  const idle = backendWith([])
  mount(idle, { active: false })
  await waitFor(() => expect(idle.list).not.toHaveBeenCalled())
})
