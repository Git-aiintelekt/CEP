/**
 * A drip's message templates in the Templates library and the editors: together by name, "Last Used In" naming the
 * message, Locked while the drip is live (card, row, preview), read-only editors that say why, and the API's refusal
 * to delete one in its own words. The canvas is a stand-in (GrapesJS hangs under jsdom).
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef, useImperativeHandle } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { Template } from '@/lib/types'
import { cepReady, installMockApi, makeDesign, makeMessage, problem, signIn } from '@/test/mockApi'

import type { EmailDesignerHandle } from '@/apps/cep/features/designer/EmailDesigner'

vi.mock('@/apps/cep/features/designer/EmailDesigner', () => ({
  EmailDesigner: forwardRef<EmailDesignerHandle, { onDirtyChange: (dirty: boolean) => void }>(function FakeDesigner(props, ref) {
    useImperativeHandle(ref, () => ({
      getDesign: () => ({ editor_state: { pages: [] }, mjml_source: '<mjml><mj-body></mj-body></mjml>' }),
      getMjml: () => '<mjml><mj-body></mj-body></mjml>',
      compileHtml: () => ({ html: '<p>email</p>', errors: [] }),
      load: () => {},
      markSaved: () => props.onDirtyChange(false),
      openTagsPanel: () => {},
      insertBlock: () => null,
      commitEdit: async () => {},
      revealSetting: () => false,
    }))
    return <p>canvas</p>
  }),
}))

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

const LOCK = "Used by a live drip (Loyalty Welcome Series, message 3). It can't be changed until the drip finishes or is stopped."
const made = (id: string, name: string, used: Template['used_in_drip'] = null, channel = 'EMAIL'): Template => ({
  id, name, description: null, channel, status: 'ACTIVE', cloned_from: null, last_used_in: null, used_in_drip: used,
  tenant: 't1', created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', row_version: 1,
} as unknown as Template)
const drip = (position: number, locked: boolean) => ({ campaign_id: 'c-loyalty', campaign_name: 'Loyalty Welcome Series', position, count: 4, locked })
const dripTemplates = () => [
  made('tl2', 'Loyalty Welcome Series · 2 of 4', drip(2, true)),
  made('t-other', 'Autumn Newsletter Draft'),
  made('tl1', 'Loyalty Welcome Series · 1 of 4', drip(1, true)),
  made('tl3', 'Loyalty Welcome Series · 3 of 4', drip(3, true)),
]

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the library: a drip’s templates together by name, Last Used In names the message, and Locked on the card and the row', async () => {
  installMockApi({ moreTemplates: dripTemplates() })
  const user = userEvent.setup()
  await renderAppAt('/templates')
  await screen.findByText('Loyalty Welcome Series · 1 of 4')

  const names = [...document.querySelectorAll('ul > li .truncate.text-sm.font-semibold')].map((node) => node.textContent)
  expect(names.slice(0, 4)).toEqual(['Loyalty Welcome Series · 1 of 4', 'Loyalty Welcome Series · 2 of 4', 'Loyalty Welcome Series · 3 of 4', 'Autumn Newsletter Draft'])
  const card = screen.getByText('Loyalty Welcome Series · 2 of 4').closest('li')!
  expect(card.querySelector('[data-last-used]')?.textContent).toBe('Loyalty Welcome Series · Message 2 of 4')
  expect(within(card).getByText('Locked')).toBeTruthy()
  expect(within(screen.getByText('Autumn Newsletter Draft').closest('li')!).queryByText('Locked')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'List View' }))
  const row = (await screen.findByRole('button', { name: 'Loyalty Welcome Series · 3 of 4' })).closest('tr')!
  expect(within(row).getByText('Loyalty Welcome Series · Message 3 of 4')).toBeTruthy()
  expect(within(row).getByText('Locked')).toBeTruthy()
  expect(within(screen.getByRole('button', { name: 'Fall Email' }).closest('tr')!).getByText(/Used in Fall Launch/)).toBeTruthy()   // today's line stays
})

test('the preview of a locked template: the grey lock note, Locked, and Open (read-only) instead of Edit', async () => {
  installMockApi({ moreTemplates: dripTemplates() })
  const user = userEvent.setup()
  await renderAppAt('/templates')
  await user.click(await screen.findByRole('button', { name: 'Preview Loyalty Welcome Series · 3 of 4' }))
  const dialog = await screen.findByRole('dialog', { name: 'Loyalty Welcome Series · 3 of 4' })
  expect(dialog.querySelector('[data-lock-note]')?.textContent).toBe(LOCK)
  expect(within(dialog).getByText('Locked')).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: 'Edit' })).toBeNull()
  expect(within(dialog).getByRole('button', { name: 'Open' })).toBeTruthy()
})

test('deleting a locked template shows the API’s refusal, with the way to the drip', async () => {
  installMockApi({ moreTemplates: dripTemplates() })
  const user = userEvent.setup()
  await renderAppAt('/templates')
  await user.click(await screen.findByRole('button', { name: 'Actions for Loyalty Welcome Series · 3 of 4' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  const confirm = await screen.findByRole('dialog', { name: 'Delete this template?' })
  await user.click(within(confirm).getByRole('button', { name: 'Delete Template' }))
  const refused = await within(confirm).findByRole('alert')
  expect(within(refused).getByText('This Template Is in Use')).toBeTruthy()
  expect(within(refused).getByText("This template can't be deleted. Loyalty Welcome Series uses it for message 3, and the drip is still running.")).toBeTruthy()
  expect(within(refused).getByRole('link', { name: 'View Campaign' }).getAttribute('href')).toBe('/campaigns/c-loyalty')
})

test('the email designer opens a locked template read-only, saying why', async () => {
  installMockApi({ template: made('tl3', 'Loyalty Welcome Series · 3 of 4', drip(3, true)), design: makeDesign({ template: 'tl3' }) })
  await renderAppAt('/templates/tl3/design')
  expect(await screen.findByText(LOCK)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull()
})

test('the message editor: a locked template is read-only with the note; a save the API refuses for a live drip says so and stops editing', async () => {
  installMockApi({ template: made('tx3', 'Holiday Texts · 2 of 3', { ...drip(2, true), campaign_name: 'Holiday Reminder Texts' }, 'SMS'), message: makeMessage() })
  await renderAppAt('/templates/tx3/message')
  const note = await screen.findByText("Used by a live drip (Holiday Reminder Texts, message 2). It can't be changed until the drip finishes or is stopped.")
  expect(note.closest('[data-drip-lock]')).toBeTruthy()
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).disabled).toBe(true)
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()

  cleanup()
  const refusal = "Used by a live drip (Holiday Reminder Texts, message 2). It can't be changed until the drip finishes or is stopped."
  installMockApi({ template: made('tx3', 'Holiday Texts · 2 of 3', null, 'SMS'), message: makeMessage(), onSaveMessage: () => problem(409, { title: 'Conflict', detail: refusal }) })
  const user = userEvent.setup()
  await renderAppAt('/templates/tx3/message')
  const body = await screen.findByLabelText('Message')
  await user.type(body, ' Thanks.')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect((await screen.findByText(refusal)).closest('[data-drip-lock]')).toBeTruthy()
  expect(screen.queryByText('Open History to load the newest version. Your text stays here until you do.')).toBeNull()
  expect((screen.getByLabelText('Message') as HTMLTextAreaElement).disabled).toBe(true)
})
