/** AI · Ask for a Report: the box above the report list, a draft and Open in Editor, a question back, when the box is absent, and Settings → AI Assistant. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, insightsAssistantNow, me, signIn } from '@/test/mockApi'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }

async function renderAppAt(path: string, meOverride: object = withInsights, before: () => void = () => undefined) {
  const calls = installMockApi({ me: meOverride as never })
  before()
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the box sits above the list with the month’s use and the examples; Generate sends the prompt and the model; the draft reads in words and Open in Editor opens the new report', async () => {
  const calls = await renderAppAt('/insights/reports')
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  expect(within(box).getByText('38 of 200 prompts used in October')).toBeTruthy()
  await user.click(within(box).getByRole('button', { name: 'Delivered rate by sending engine, by week' }))
  const prompt = within(box).getByRole('textbox', { name: 'What do you want to see?' }) as HTMLTextAreaElement
  expect(prompt.value).toBe('Delivered rate by sending engine, by week')
  await user.clear(prompt)
  await user.type(prompt, 'Sent and delivered by campaign for September')
  // the model picker: Claude's reports model is the default, OpenAI's models are offered too
  await user.click(within(box).getByRole('button', { name: /Claude Sonnet 5.5/ }))
  const menu = await screen.findByRole('region', { name: 'Model' })
  expect(within(menu).getByRole('button', { name: /GPT-5 mini/ })).toBeTruthy()
  await user.click(within(menu).getByRole('button', { name: /GPT-5 mini/ }))
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'Draft Report' })
  const asked = calls.find((call) => call.url.endsWith('/insights/assistant/ask/'))?.body as Record<string, unknown>
  expect(asked).toEqual({ prompt: 'Sent and delivered by campaign for September', model: 'openai:gpt-5-mini' })
  expect(within(card).getByText('Sent and Delivered by Campaign')).toBeTruthy()
  expect(within(card).getByText('Campaign')).toBeTruthy()                                   // Rows
  expect(within(card).getByText('Sum of Sent Count, Sum of Delivered Count')).toBeTruthy()   // Values
  expect(within(card).getByText('Sent between 2026-09-01 and 2026-09-30')).toBeTruthy()      // Filter
  expect(within(card).getByText('Preview: 12 rows')).toBeTruthy()
  expect(within(box).getByText('39 of 200 prompts used in October')).toBeTruthy()            // the draft counted
  await user.click(within(card).getByRole('button', { name: 'Open in Editor' }))
  await screen.findByRole('textbox', { name: 'Report name' })
  expect(calls.some((call) => call.url.endsWith('/insights/assistant/ask-1/open/') && call.method === 'POST')).toBe(true)
  expect(window.location.pathname).toBe('/insights/reports/rep-ai/edit')
})

test('a question back offers its answers as buttons, and an answer is sent as the next prompt without a count', async () => {
  const calls = await renderAppAt('/insights/reports')
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Which campaigns made the most revenue last month?')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'One Question First' })
  expect(within(card).getByText('Which period is last month?')).toBeTruthy()
  await user.click(within(card).getByRole('button', { name: 'September 2026, the calendar month' }))
  await screen.findByRole('region', { name: 'Draft Report' })
  const answered = calls.filter((call) => call.url.endsWith('/insights/assistant/ask/')).at(-1)?.body as Record<string, unknown>
  expect(answered.prompt).toBe('Revenue by campaign for September 2026')
  expect(answered.answer_to).toBe('ask-q')
})

test('no field for it: the message and the closest prompts; a failure says so with Try Again', async () => {
  await renderAppAt('/insights/reports')
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Website visits by campaign')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'No Field for This' })
  expect(within(card).getByText(/No dataset has website visits/)).toBeTruthy()
  expect(within(card).getByRole('button', { name: 'Clicks by Campaign' })).toBeTruthy()
  expect(within(card).queryByRole('button', { name: 'Open in Editor' })).toBeNull()
  await user.click(within(card).getByRole('button', { name: 'Clicks by Campaign' }))
  await screen.findByRole('region', { name: 'Draft Report' })
})

test('the box is absent without the right, when the platform has no provider, and when the workspace switched AI off', async () => {
  await renderAppAt('/insights/reports', { ...withInsights, principal: me.principal })
  await screen.findByRole('table', { name: 'Reports' })
  expect(screen.queryByRole('region', { name: 'Ask for a Report' })).toBeNull()
  cleanup()
  await renderAppAt('/insights/reports', withInsights, () => { insightsAssistantNow.enabled = false; insightsAssistantNow.reason = 'no_provider' })
  await screen.findByRole('table', { name: 'Reports' })
  expect(screen.queryByRole('region', { name: 'Ask for a Report' })).toBeNull()
})

test('Settings → AI Assistant: the switch, the providers people may pick, Explain, and the month’s prompts; each change is one PUT', async () => {
  const calls = await renderAppAt('/settings/ai-assistant')
  const user = userEvent.setup()
  expect(await screen.findByRole('heading', { name: 'AI Assistant' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'AI Assistant' })).toBeTruthy()                                     // the Settings menu
  expect(screen.getByText('38 of 200')).toBeTruthy()
  await user.click(screen.getByRole('switch', { name: 'Allow OpenAI' }))
  expect(calls.find((call) => call.url.endsWith('/workspace/ai-assistant/') && call.method === 'PUT')?.body).toEqual({ providers: { openai: false } })
  await user.click(screen.getByRole('switch', { name: 'Use AI in Reports' }))
  expect(calls.filter((call) => call.url.endsWith('/workspace/ai-assistant/') && call.method === 'PUT').at(-1)?.body).toEqual({ enabled: false })
  expect(await screen.findByText(/Off\. Reports are built in the editor only/)).toBeTruthy()
  expect((screen.getByRole('switch', { name: 'Allow Claude (Anthropic)' }) as HTMLButtonElement).disabled).toBe(true)
})

test('a workspace adds its own key for a provider: the form, one PUT with the key and models, the provider then on the own key with Check Connection and a way back', async () => {
  const calls = await renderAppAt('/settings/ai-assistant')
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: 'AI Assistant' })
  const openai = screen.getByRole('listitem', { name: 'OpenAI' })
  expect(within(openai).getByText('Provided by the Platform')).toBeTruthy()
  await user.click(within(openai).getByRole('button', { name: 'Use Your Own Key' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add Your Own OpenAI Key' })
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(within(dialog).getByText('Give the provider’s API key.')).toBeTruthy()                            // nothing sent without a key
  await user.type(within(dialog).getByLabelText(/API Key/), 'sk-own-test')
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  const put = calls.filter((call) => call.url.endsWith('/workspace/ai-assistant/') && call.method === 'PUT').at(-1)?.body as Record<string, unknown>
  expect(put).toEqual({ own: { openai: { api_key: 'sk-own-test', model_reports: 'gpt-5', model_fast: 'gpt-5-mini' } } })
  const after = await screen.findByRole('listitem', { name: 'OpenAI' })
  expect(within(after).getByText('Not Checked Yet')).toBeTruthy()
  expect(within(after).getByText(/Your own key · gpt-5, gpt-5-mini/)).toBeTruthy()
  expect(within(after).queryByRole('switch', { name: 'Allow OpenAI' })).toBeNull()                         // the own key wins; nothing to allow
  await user.click(within(after).getByRole('button', { name: 'Check Connection' }))
  expect(await within(screen.getByRole('listitem', { name: 'OpenAI' })).findByText(/Checked/)).toBeTruthy()
  expect(calls.find((call) => call.url.endsWith('/workspace/ai-assistant/check/'))?.body).toEqual({ provider: 'openai' })
  expect(within(screen.getByRole('listitem', { name: 'OpenAI' })).getByRole('button', { name: 'Use the Platform’s Key' })).toBeTruthy()
})
