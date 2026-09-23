import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { Preset, Template } from '@/lib/types'
import { installMockApi, makeMessage, signIn, templates } from '@/test/mockApi'

import { presetFromDefinition, presetFromStarter } from '../presetSource'
import { promotion } from '../presets/promotion'
import { smsPromotion } from '../presets/smsPromotion'
import type { PreviewItem } from './usePreviewContent'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** the api client reads the session when it loads, so the hook is loaded after signIn() */
async function render(item: PreviewItem) {
  vi.resetModules()
  const { usePreviewContent } = await import('./usePreviewContent')
  return renderHook(() => usePreviewContent(item), { wrapper })
}
const contentCalls = (calls: { url: string }[]) => calls.filter((call) => !call.url.includes('/personalization-tags/')).map((call) => call.url.replace(/^.*\/api\/v1/, ''))
const template = (id: string) => templates.find((item) => item.id === id) as Template

beforeEach(() => {
  window.localStorage.clear()
  signIn()
})
afterEach(() => vi.unstubAllGlobals())

test('a preset with content is read straight from it, with no content request', async () => {
  const calls = installMockApi()
  const { result } = await render({ kind: 'preset', preset: presetFromDefinition(smsPromotion) })

  await waitFor(() => expect(result.current.data).toBeDefined())
  expect(result.current.data).toMatchObject({ kind: 'message', channel: 'SMS', body: smsPromotion.content.kind === 'message' ? smsPromotion.content.sms_body : '', media: null, findings: null })
  expect(contentCalls(calls)).toEqual([])
})

test('an email preset is compiled from its MJML, the way the designer compiles it', async () => {
  const calls = installMockApi()
  const { result } = await render({ kind: 'preset', preset: presetFromDefinition(promotion) })

  await waitFor(() => expect(result.current.data).toBeDefined())
  const data = result.current.data
  expect(data?.kind).toBe('email')
  if (data?.kind !== 'email') return
  expect(data.html).toContain('<!doctype html>')
  expect(data.html).toContain('YOUR BRAND')
  expect(data.subject).toBe('{{first_name}}, {{discount_pct}}% off this weekend only')
  expect(contentCalls(calls)).toEqual([])
})

test('a preset with no content of its own reads the server starter', async () => {
  const calls = installMockApi()
  const starter: Preset = presetFromStarter({ key: 'promotion', name: 'Sale announcement', channel: 'EMAIL', category: 'Promotion', description: '', subject_line: 'Server subject',
                                              preheader: '', html_content: null, sms_body: null })
  const { result } = await render({ kind: 'preset', preset: starter })

  await waitFor(() => expect(result.current.data).toBeDefined())
  expect(result.current.data).toMatchObject({ kind: 'email', html: '<html><body><p>Hi {{first_name}}</p></body></html>', subject: '{{first_name}}, a sale' })
  expect(contentCalls(calls)).toEqual(['/template-starters/?channel=EMAIL'])
})

test('a template is read from its own saved content: the design for email, the message for SMS', async () => {
  const calls = installMockApi({ message: makeMessage({ sms_body: 'Saved text {{first_name}}' }) })
  const email = await render({ kind: 'template', template: template('tpl-email') })
  const sms = await render({ kind: 'template', template: template('tpl-sms') })

  await waitFor(() => expect(email.result.current.data).toBeDefined())
  await waitFor(() => expect(sms.result.current.data).toBeDefined())
  expect(email.result.current.data?.kind).toBe('email')
  expect(sms.result.current.data).toMatchObject({ kind: 'message', body: 'Saved text {{first_name}}', findings: { units: 45, segments: 1 } })
  expect(contentCalls(calls).sort()).toEqual(['/templates/tpl-email/design/', '/templates/tpl-sms/message/'])
})

test('an e-receipt has nothing to preview and asks for nothing', async () => {
  const calls = installMockApi()
  const { result } = await render({ kind: 'template', template: template('tpl-receipt') })
  await waitFor(() => expect(result.current.tags.length).toBeGreaterThan(0))
  expect(result.current.data).toBeUndefined()
  expect(contentCalls(calls)).toEqual([])
})
