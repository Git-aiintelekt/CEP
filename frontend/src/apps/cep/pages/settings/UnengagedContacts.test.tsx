/** Settings → Governance → Unengaged Contacts (docs/mockups/unengaged-contacts.html, option A): the rule as a sentence, what it does
 * today, editing it with a live count, switching it off, the new-install wait, and a workspace with no rule yet. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, governance, installMockApi, me, signIn, unengagedCard } from '@/test/mockApi'

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

beforeEach(() => {
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const editor = { me: { principal: { ...me.principal, kind: 'user' as const, permissions: [...me.principal.permissions, 'governance.edit'] } } as never }
const card = async () => (await screen.findByRole('group', { name: 'Unengaged Contacts' })).closest('section') as HTMLElement

test('the card reads the rule, counts who it leaves out today, and the dialog shows the effect of fewer days before saving', async () => {
  const calls = installMockApi(editor)
  const user = userEvent.setup()
  await renderAppAt('/settings/governance')
  const section = await card()
  expect(section.textContent).toContain('no engagement in 180 days')
  expect(within(section).getAllByText('2,940').length).toBeGreaterThan(0)
  expect(section.textContent).toContain('of 48,210 email contacts left out (6.1%)')
  expect(within(section).getByText('Too new to judge')).toBeTruthy()
  expect(within(section).getByText('Purchase or e-receipt')).toBeTruthy()
  expect(section.textContent).toContain('186 people came back')
  expect(within(section).getByRole('button', { name: /Download the 2,940 People/ })).toBeTruthy()

  await user.click(within(section).getByRole('button', { name: 'Edit' }))
  const dialog = await screen.findByRole('dialog', { name: 'Unengaged Contacts' })
  await user.clear(within(dialog).getByLabelText(/^No Engagement In/))
  await user.type(within(dialog).getByLabelText(/^No Engagement In/), '120')
  await vi.waitFor(() => expect(dialog.querySelector('[data-unengaged-preview]')?.textContent).toContain('5,115 would be left out today'))
  await user.click(within(dialog).getByRole('button', { name: 'Save Rule' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/workspace/governance/unengaged/'))?.body).toEqual({ days: 120, min_emails: 5, is_active: true })
  await vi.waitFor(() => expect((section.querySelector('[data-unengaged-rule]') as HTMLElement).textContent).toContain('no engagement in 120 days'))

  await user.click(within(section).getByRole('switch', { name: 'Unengaged Contacts in use' }))
  await vi.waitFor(() => expect(calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/unengaged/')).at(-1)?.body).toEqual({ is_active: false }))
  await vi.waitFor(() => expect(section.textContent).toContain('Switched off: nobody is left out.'))
})

test('more days than the platform allows is refused on the field', async () => {
  const saved = governance.unengaged
  governance.unengaged = unengagedCard({ limit: { days: 270, min_emails: 5 } })
  try {
    installMockApi(editor)
    const user = userEvent.setup()
    await renderAppAt('/settings/governance')
    const section = await card()
    expect(section.textContent).toContain('Platform: at most 270 days and 5 marketing emails')
    await user.click(within(section).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Unengaged Contacts' })
    await user.clear(within(dialog).getByLabelText(/^No Engagement In/))
    await user.type(within(dialog).getByLabelText(/^No Engagement In/), '300')
    await user.click(within(dialog).getByRole('button', { name: 'Save Rule' }))
    expect(await within(dialog).findByText(/the platform allows at most 270/)).toBeTruthy()
  } finally {
    governance.unengaged = saved
  }
})

test('a new install says when the rule starts, and a workspace with no rule adds the recommended one', async () => {
  const saved = governance.unengaged
  governance.unengaged = unengagedCard({ today: { total: 12406, engaged: 0, unengaged: 0, too_new: 12406, starts_on: '2027-05-18' }, recent: { days: 30, left_out: 0, came_back: 0 } })
  try {
    installMockApi(editor)
    await renderAppAt('/settings/governance')
    const section = await card()
    expect(within(section).getByText('Starts 18 May 2027')).toBeTruthy()
    expect(within(section).getByText('Nobody is left out yet')).toBeTruthy()
    expect(within(section).queryByRole('button', { name: /Download/ })).toBeNull()
  } finally {
    governance.unengaged = saved
  }
  cleanup()
  governance.unengaged = unengagedCard({ own: null, applies: null })
  try {
    const calls = installMockApi(editor)
    const user = userEvent.setup()
    await renderAppAt('/settings/governance')
    await user.click(await screen.findByRole('button', { name: 'Use 180 Days' }))
    await vi.waitFor(() => expect(calls.find((call) => call.method === 'PUT' && call.url.endsWith('/unengaged/'))?.body).toEqual({ days: 180, min_emails: 5, is_active: true }))
    expect((await card()).textContent).toContain('no engagement in 180 days')
  } finally {
    governance.unengaged = saved
  }
})

test('without governance.edit the card is read-only', async () => {
  installMockApi()
  await renderAppAt('/settings/governance')
  const section = await card()
  expect(within(section).queryByRole('button', { name: 'Edit' })).toBeNull()
  expect(within(section).queryByRole('switch')).toBeNull()
})
