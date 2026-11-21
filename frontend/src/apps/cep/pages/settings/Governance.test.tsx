/** Settings → Governance (docs/mockups/governance.html, option A): the last 30 days, the platform's caps locked beside the
 * workspace's own, and adding, switching off and removing a cap of the workspace's own. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, governance, governanceCap, installMockApi, me, signIn } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

test('the platform cap is locked, the workspace adds, switches off and removes its own, and the figures and fixed rules are shown', async () => {
  const calls = installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: [...me.principal.permissions, 'governance.edit'] } } as never })
  const user = userEvent.setup()
  await renderAppAt('/settings/governance')
  const table = await screen.findByRole('table', { name: 'Frequency Caps' })
  expect(screen.getByText('212,480')).toBeTruthy()
  expect(screen.getByText('98.2%')).toBeTruthy()

  const platformRow = within(table).getByText('3 emails per 7 days').closest('tr') as HTMLElement
  expect(within(platformRow).getByText('Platform')).toBeTruthy()
  expect(within(platformRow).getByText('Locked')).toBeTruthy()
  expect(within(platformRow).queryByRole('button', { name: 'Edit' })).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Add Cap' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Cap' })
  await user.selectOptions(within(dialog).getByLabelText(/^Channel/), 'ALL')
  await user.clear(within(dialog).getByLabelText(/^Most/))
  await user.type(within(dialog).getByLabelText(/^Most/), '5')
  await user.click(within(dialog).getByRole('button', { name: 'Add Cap' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.find((call) => call.method === 'POST' && call.url.endsWith('/workspace/governance/caps/'))?.body).toEqual({ channel: 'ALL', max_messages: 5, period_days: 7 })
  expect(await within(table).findByText('5 messages per 7 days')).toBeTruthy()

  const ownRow = within(table).getByText('4 texts per 30 days').closest('tr') as HTMLElement
  await user.click(within(ownRow).getByRole('switch', { name: '4 texts per 30 days in use' }))
  await vi.waitFor(() => expect(calls.find((call) => call.method === 'PATCH' && call.url.endsWith('/caps/cap-own/'))?.body).toEqual({ is_active: false }))
  await user.click(within(ownRow).getByRole('button', { name: 'Remove' }))
  await vi.waitFor(() => expect(within(table).queryByText('4 texts per 30 days')).toBeNull())

  expect(within(screen.getByRole('heading', { name: 'List Hygiene' }).closest('section') as HTMLElement).getByRole('link', { name: 'Suppressions' }).getAttribute('href')).toBe('/settings/suppressions')
})

test('without governance.edit the page is read-only: no Add Cap, no Edit, no Remove', async () => {
  installMockApi()
  await renderAppAt('/settings/governance')
  const table = await screen.findByRole('table', { name: 'Frequency Caps' })
  expect(screen.queryByRole('button', { name: 'Add Cap' })).toBeNull()
  expect(within(table).queryByRole('button', { name: 'Edit' })).toBeNull()
  expect(within(table).queryByRole('switch')).toBeNull()
})

test('a workspace with no caps of its own adds the recommended ones in one go, and can then change them', async () => {
  const saved = governance.caps
  governance.caps = [governanceCap({ id: 'cap-platform', channel: 'EMAIL', max_messages: 1, period_days: 1, platform: true })]
  try {
    const calls = installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: [...me.principal.permissions, 'governance.edit'] } } as never })
    const user = userEvent.setup()
    await renderAppAt('/settings/governance')
    await user.click(await screen.findByRole('button', { name: 'Use the Recommended Caps' }))
    const table = screen.getByRole('table', { name: 'Frequency Caps' })
    for (const rule of ['3 emails per 7 days', '4 texts per 30 days', '2 WhatsApp messages per 7 days', '5 messages per 7 days']) expect(await within(table).findByText(rule)).toBeTruthy()
    expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/workspace/governance/standard/'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Use the Recommended Caps' })).toBeNull()
    expect(within(within(table).getByText('3 emails per 7 days').closest('tr') as HTMLElement).getByRole('button', { name: 'Edit' })).toBeTruthy()
  } finally {
    governance.caps = saved
  }
})

test('gap between messages: switched on at the recommended hours, changed, switched off; the platform gap is locked', async () => {
  const calls = installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: [...me.principal.permissions, 'governance.edit'] } } as never })
  const user = userEvent.setup()
  await renderAppAt('/settings/governance')
  const gaps = await screen.findByRole('group', { name: 'Gap Between Messages' })
  expect(within(gaps).getByText('Off: no gap of your own between emails.')).toBeTruthy()
  expect((within(gaps).getByLabelText('Email gap in hours') as HTMLInputElement).value).toBe('16')

  await user.click(within(gaps).getByRole('switch', { name: 'Email gap in use' }))
  expect(await within(gaps).findByText('Skip a person who received a marketing email in the last 16 hours.')).toBeTruthy()
  expect(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/workspace/governance/gaps/EMAIL/'))?.body).toEqual({ hours: 16, is_active: true })

  const hours = within(gaps).getByLabelText('Email gap in hours')
  await user.clear(hours)
  await user.type(hours, '20{Enter}')
  expect(await within(gaps).findByText('Skip a person who received a marketing email in the last 20 hours.')).toBeTruthy()

  await user.click(within(gaps).getByRole('switch', { name: 'Text gap in use' }))
  expect(await within(gaps).findByText('Off: no gap of your own between texts.')).toBeTruthy()
  expect(calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/gaps/SMS/')).at(-1)?.body).toEqual({ is_active: false })

  expect(within(gaps).getByText('24 hours between WhatsApp messages')).toBeTruthy()
  expect(within(gaps).getAllByText('Locked')).toHaveLength(1)
})

test('send windows: email switched on at the recommended hours, a day taken off, the text window narrowed; the platform window is locked', async () => {
  const calls = installMockApi({ me: { principal: { ...me.principal, kind: 'user' as const, permissions: [...me.principal.permissions, 'governance.edit'] } } as never })
  const user = userEvent.setup()
  await renderAppAt('/settings/governance')
  const box = await screen.findByRole('group', { name: 'Send Windows' })
  expect(within(box).getByText('Off: no window of your own for emails.')).toBeTruthy()
  expect((within(box).getByLabelText('Email window from') as HTMLInputElement).value).toBe('07:00')

  await user.click(within(box).getByRole('switch', { name: 'Email send window in use' }))
  expect(await within(box).findByText(/Marketing emails go out 07:00–21:00, every day\./)).toBeTruthy()
  expect(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/workspace/governance/windows/EMAIL/'))?.body)
    .toEqual({ start: '07:00', end: '21:00', days: [1, 2, 3, 4, 5, 6, 7], is_active: true })

  const sunday = within(within(box).getByRole('group', { name: 'Email window days' })).getByRole('button', { name: 'Sun' })
  await user.click(sunday)
  await vi.waitFor(() => expect(calls.filter((call) => call.url.endsWith('/windows/EMAIL/')).at(-1)?.body).toEqual({ days: [1, 2, 3, 4, 5, 6] }))
  expect(await within(box).findByText(/Marketing emails go out 07:00–21:00, Mon, Tue, Wed, Thu, Fri, Sat\./)).toBeTruthy()

  expect(within(box).getByText(/Marketing texts go out 10:00–20:00, Mon–Fri\./)).toBeTruthy()
  const from = within(box).getByLabelText('Text window from')
  await user.clear(from)
  await user.type(from, '11:00')
  await user.tab()
  await vi.waitFor(() => expect(calls.filter((call) => call.url.endsWith('/windows/SMS/')).at(-1)?.body).toEqual({ start: '11:00' }))
  expect(within(box).getByText('Texts 08:00–21:00, every day')).toBeTruthy()
  expect(within(box).getAllByText('Locked')).toHaveLength(1)
})

test('without governance.edit the windows are shown, not edited', async () => {
  installMockApi()
  await renderAppAt('/settings/governance')
  const box = await screen.findByRole('group', { name: 'Send Windows' })
  expect(within(box).queryByRole('switch')).toBeNull()
  expect(within(box).queryByLabelText('Text window from')).toBeNull()
  expect(within(box).getByText(/Marketing texts go out 10:00–20:00, Mon–Fri\./)).toBeTruthy()
})
