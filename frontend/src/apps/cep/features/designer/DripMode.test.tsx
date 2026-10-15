/**
 * The email designer opened for a drip message (?drip={campaign}&step={message}): the way back to the message, the
 * context, the neighbouring messages behind the leave guard, the subject it can't change, and the message's own test.
 * The canvas is a stand-in (GrapesJS hangs under jsdom) with the same handle.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef, useImperativeHandle } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import type { DripStep, Template } from '@/lib/types'
import { cepReady, installMockApi, makeCampaign, makeDesign, makeStep, signIn } from '@/test/mockApi'

import type { EmailDesignerHandle } from './EmailDesigner'

vi.mock('@/apps/cep/features/designer/EmailDesigner', () => ({
  EmailDesigner: forwardRef<EmailDesignerHandle, { onDirtyChange: (dirty: boolean) => void; onCanvasChange?: () => void }>(function FakeDesigner(props, ref) {
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
    return <button type="button" onClick={() => { props.onDirtyChange(true); props.onCanvasChange?.() }}>Change the Canvas</button>
  }),
}))

async function renderAppAt(path: string) {
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
}

type Call = { method: string; url: string; body: unknown }
const tpl = (id: string) => ({ id, name: `Loyalty Welcome · ${id}`, channel: 'EMAIL' as const, status: 'DRAFT' })
const steps = (): DripStep[] => [
  makeStep({ id: 's1', day: 0, name: 'Welcome', template: tpl('t1'), subject_line: 'Welcome to Rewards' }),
  makeStep({ id: 's2', day: 3, name: 'How Points Work', template: tpl('t2'), subject_line: '3 ways to earn points', preheader: 'Shop, review and refer.',
    test: { status: 'CHANGED', sent_at: '2026-10-06T10:00:00Z', error: null, run_id: 'r1' } }),
  makeStep({ id: 's3', day: 7, name: 'First Reward', template: tpl('t3'), subject_line: 'Your first reward' }),
]
const template = (id: string): Template => ({ id, name: `Loyalty Welcome · ${id}`, description: null, channel: 'EMAIL', status: 'DRAFT', cloned_from: null,
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', row_version: 1 } as unknown as Template)
const setup = () => installMockApi({
  campaign: makeCampaign({ name: 'Loyalty Welcome', status: 'DRAFT', campaign_type: 'DRIP', send_type: 'DRIP', setup_step: 2, scheduled_at: '2026-10-12T14:00:00Z', send_timezone: 'America/Chicago', sender_profile: 'snd-email' }),
  dripSteps: { c1: steps() }, template: template('t2'), design: makeDesign({ template: 't2', subject_line: 'The template’s own subject', mjml_source: '<mjml><mj-body></mj-body></mjml>' }),
}) as Call[]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('drip mode: Back to Drip Campaign Setup, the context, the drip tracker, the strip, the subject read-only and the changed-since-test strip', async () => {
  setup()
  await renderAppAt('/templates/t2/design?drip=c1&step=s2')

  const back = await screen.findByRole('link', { name: 'Back to Drip Campaign Setup' })
  expect(back.getAttribute('href')).toBe('/campaigns/c1/edit?step=sequence&message=s2')
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Loyalty Welcome · Message 2 of 3 · How Points Work')
  const tracker = screen.getByRole('navigation', { name: 'Campaign Steps' })
  expect(within(tracker).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Audience', 'Drip Campaign Setup', 'Targets', 'Test & Publish'])
  expect(within(tracker).getByText('Drip Campaign Setup').closest('[aria-current]')?.getAttribute('aria-current')).toBe('step')
  expect(document.querySelector('[data-drip-strip]')?.textContent).toBe('Loyalty Welcome · t2Changes apply to this message only.')

  const header = document.querySelector<HTMLElement>('[data-drip-header]')!
  expect(within(header).getByText('3 ways to earn points')).toBeTruthy()
  expect(within(header).getByText('Shop, review and refer.')).toBeTruthy()
  expect(within(header).getByText('Northwind Rewards · rewards@northwind.example')).toBeTruthy()
  expect(within(header).getByText('Set on the Drip Campaign Setup step.')).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: /Subject/ })).toBeNull()
  expect(screen.queryByText('The template’s own subject')).toBeNull()
  expect(screen.getByText('Changed since the test. Send this message’s test again before you publish.')).toBeTruthy()
})

test('Previous and Next go to the neighbouring messages in drip mode, behind the leave guard', async () => {
  setup()
  const user = userEvent.setup()
  await renderAppAt('/templates/t2/design?drip=c1&step=s2')
  await screen.findByRole('link', { name: 'Back to Drip Campaign Setup' })

  await user.click(screen.getByRole('button', { name: 'Change the Canvas' }))
  await user.click(screen.getByRole('button', { name: 'Next Message' }))
  const ask = await screen.findByRole('dialog', { name: 'Leave without saving?' })
  await user.click(within(ask).getByRole('button', { name: 'Keep Editing' }))
  expect(window.location.pathname).toBe('/templates/t2/design')
  await user.click(screen.getByRole('button', { name: 'Previous Message' }))
  await user.click(within(await screen.findByRole('dialog', { name: 'Leave without saving?' })).getByRole('button', { name: 'Leave Without Saving' }))
  await vi.waitFor(() => expect(`${window.location.pathname}${window.location.search}`).toBe('/templates/t1/design?drip=c1&step=s1'))
  expect(((await screen.findByRole('button', { name: 'Previous Message' })) as HTMLButtonElement).disabled).toBe(true)     // message 1 has none before it
})

test('a save marks the way back, and Send Test sends this message’s own test', async () => {
  const calls = setup()
  const user = userEvent.setup()
  await renderAppAt('/templates/t2/design?drip=c1&step=s2')
  await screen.findByRole('link', { name: 'Back to Drip Campaign Setup' })

  await user.click(screen.getByRole('button', { name: 'Change the Canvas' }))
  await user.click(screen.getByRole('button', { name: /^Save/ }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.includes('/templates/t2/design/'))).toBe(true))
  await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Back to Drip Campaign Setup' }).getAttribute('href')).toBe('/campaigns/c1/edit?step=sequence&message=s2&saved=1'))

  await user.click(screen.getByRole('button', { name: 'Send Test' }))
  const dialog = await screen.findByRole('dialog', { name: 'Send a Test' })
  expect(within(dialog).getByText(/Sends this message's test, labelled Test 2 of 3\./)).toBeTruthy()
  const to = within(dialog).getByLabelText('Other Addresses')
  await user.clear(to)                                                               // it starts with the signed-in person's address
  await user.type(to, 'me@example.com')
  await user.click(within(dialog).getByRole('button', { name: 'Send Test' }))
  await vi.waitFor(() => expect(calls.find((call) => call.method === 'POST' && call.url.includes('/campaigns/c1/steps/s2/test/'))?.body).toMatchObject({ to: ['me@example.com'] }))
  expect(await within(dialog).findByText('Sent to me@example.com')).toBeTruthy()
})
