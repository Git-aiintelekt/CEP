/**
 * The email designer opened from a campaign's Content (?campaign={id}&return={path}, in its own tab): Back to Campaign, and Save &
 * Return to Campaign, which saves the latest changes, tells the campaign's tab, and closes this tab (or, where the browser will not
 * close it, opens the campaign here). The links on the campaign carry the campaign and the page to return to.
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { forwardRef, useImperativeHandle } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { campaignEditorLink } from '@/lib/editorRoute'
import type { Template } from '@/lib/types'
import { cepReady, installMockApi, makeDesign, signIn } from '@/test/mockApi'

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

const template = { id: 't9', name: 'Star Bag', description: null, channel: 'EMAIL', status: 'ACTIVE', cloned_from: null,
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z', row_version: 1 } as unknown as Template

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

test('the campaign links open every editor with the campaign and the page to return to', () => {
  const back = 'campaign=c1&return=%2Fcampaigns%2Fc1'
  expect(campaignEditorLink({ id: 't9', channel: 'EMAIL' }, 'c1', '/campaigns/c1/edit?step=content'))
    .toBe('/templates/t9/design?campaign=c1&return=%2Fcampaigns%2Fc1%2Fedit%3Fstep%3Dcontent')
  expect(campaignEditorLink({ id: 't8', channel: 'SMS' }, 'c1', '/campaigns/c1')).toBe(`/templates/t8/message?${back}`)
  expect(campaignEditorLink({ id: 't7', channel: 'MMS' }, 'c1', '/campaigns/c1')).toBe(`/templates/t7/message?${back}`)
  expect(campaignEditorLink({ id: 't6', channel: 'E_RECEIPT' }, 'c1', '/campaigns/c1')).toBe(`/templates/t6/receipt?${back}`)
  expect(campaignEditorLink({ id: 't5', channel: 'WHATSAPP' }, 'c1', '/campaigns/c1')).toBe(`/templates/t5/whatsapp?${back}`)
})

test('opened from a campaign: Back to Campaign, and Save & Return saves the change, tells the campaign tab and goes back', async () => {
  const calls = installMockApi({ template, design: makeDesign({ template: 't9', mjml_source: '<mjml><mj-body></mj-body></mjml>' }) }) as { method: string; url: string }[]
  const told: unknown[] = []
  class Channel { onmessage: unknown = null; postMessage(data: unknown) { told.push(data) } close() {} }
  vi.stubGlobal('BroadcastChannel', Channel)
  const close = vi.spyOn(window, 'close').mockImplementation(() => undefined)
  const user = userEvent.setup()
  await renderAppAt('/templates/t9/design?campaign=c1&return=%2Fcampaigns%2Fc1%2Fedit%3Fstep%3Dcontent')

  const back = await screen.findByRole('link', { name: 'Back to Campaign' })
  expect(back.getAttribute('href')).toBe('/campaigns/c1/edit?step=content')
  const footer = document.querySelector('[data-return-to-campaign]')?.closest('div') as HTMLElement
  expect(within(footer).getByRole('button', { name: 'Save & Return to Campaign' })).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Change the Canvas' }))
  await user.click(screen.getByRole('button', { name: 'Save & Return to Campaign' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/templates/t9/design/'))).toBe(true))
  expect(told).toEqual([{ templateId: 't9' }])                                  // the campaign's tab refreshes its preview
  await vi.waitFor(() => expect(close).toHaveBeenCalled())
  // the test's window cannot close: the campaign opens here instead
  await vi.waitFor(() => expect(window.location.pathname).toBe('/campaigns/c1/edit'), { timeout: 3000 })
})

test('an address outside the campaigns is never followed: the designer keeps its usual way back', async () => {
  installMockApi({ template, design: makeDesign({ template: 't9', mjml_source: '<mjml><mj-body></mj-body></mjml>' }) })
  await renderAppAt('/templates/t9/design?campaign=c1&return=https%3A%2F%2Fevil.example%2F')
  await screen.findByRole('button', { name: 'Change the Canvas' })
  expect(screen.queryByRole('link', { name: 'Back to Campaign' })).toBeNull()
  expect(document.querySelector('[data-return-to-campaign]')).toBeNull()
})

test('the Message Editor (texts) opened from a campaign: Back to Campaign, and Save & Return saves the text and goes back', async () => {
  const calls = installMockApi() as { method: string; url: string }[]
  vi.spyOn(window, 'close').mockImplementation(() => undefined)
  const user = userEvent.setup()
  await renderAppAt('/templates/tpl-sms/message?campaign=c1&return=%2Fcampaigns%2Fc1')

  const back = await screen.findByRole('link', { name: 'Back to Campaign' })
  expect(back.getAttribute('href')).toBe('/campaigns/c1')
  const body = (await screen.findByLabelText('Message')) as HTMLTextAreaElement
  await user.type(body, ' Last day!')
  await user.click(screen.getByRole('button', { name: 'Save & Return to Campaign' }))
  await vi.waitFor(() => expect(calls.some((call) => call.method === 'POST' && call.url.endsWith('/templates/tpl-sms/message/'))).toBe(true))
  await vi.waitFor(() => expect(window.location.pathname).toBe('/campaigns/c1'), { timeout: 3000 })
})
