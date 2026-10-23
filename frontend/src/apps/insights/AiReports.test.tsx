/** AI Reports (docs/mockups/ai-reports-page.html, option A): the menu item only when AI can draft reports, the Report Name sent with the
 * prompt, Run Details with the run under way and the earlier ones, and Prompt History: newest first, older ones on demand, Use Again,
 * the pencil, Show, and Clear History behind a confirmation. Reports drafted by AI carry the AI mark in Reports. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, historyPrompt, insightsHistoryNow, insightsReportsNow, insightsSummary, installMockApi, me, signIn } from '@/test/mockApi'

const withInsights = (aiReports: boolean) => ({ ...me, principal: { ...me.principal, permissions: [...(me.principal.permissions ?? []), 'report.edit'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }],
  insights: { mode: 'integrated', standalone_path: '/insights', ai_reports: aiReports } })

async function renderAppAt(path: string, aiReports = true, before: () => void = () => undefined) {
  const calls = installMockApi({ me: withInsights(aiReports) as never })
  before()
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear() })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('AI Reports sits above Reports in the menu when AI can draft reports, and is not there otherwise; Reports marks the reports AI drafted', async () => {
  await renderAppAt('/insights/reports', true, () => { insightsReportsNow.push({ ...insightsSummary, id: 'rep-ai-1', name: 'Store Delivery Leaderboard', ai: true } as never) })
  const table = await screen.findByRole('table', { name: 'Reports' })
  const links = screen.getAllByRole('link').map((link) => link.textContent)
  expect(links.indexOf('AI Reports')).toBeGreaterThan(-1)
  expect(links.indexOf('AI Reports')).toBeLessThan(links.indexOf('Reports'))
  const row = within(table).getByRole('link', { name: 'Store Delivery Leaderboard' }).closest('tr') as HTMLElement
  expect(within(row).getByLabelText('AI')).toBeTruthy()
  expect(within(within(table).getByRole('link', { name: 'Sends by campaign' }).closest('tr') as HTMLElement).queryByLabelText('AI')).toBeNull()
  cleanup()
  await renderAppAt('/insights/reports', false)
  await screen.findByRole('table', { name: 'Reports' })
  expect(screen.queryByRole('link', { name: 'AI Reports' })).toBeNull()
})

test('a Report Name goes with the prompt and names the draft; Run Details keeps each run with its time, tokens, model and steps', async () => {
  const calls = await renderAppAt('/insights/ai-reports')
  const user = userEvent.setup()
  const box = await screen.findByRole('region', { name: 'Ask for a Report' })
  expect(within(screen.getByRole('region', { name: 'Run Details' })).getByText(/The steps of each prompt show here/)).toBeTruthy()
  await user.type(within(box).getByRole('textbox', { name: 'Report Name' }), 'Store Delivery Leaderboard')
  await user.type(within(box).getByRole('textbox', { name: 'What do you want to see?' }), 'Sent and delivered by campaign for September')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  const card = await screen.findByRole('region', { name: 'Draft Report' })
  expect(calls.find((call) => call.url.endsWith('/insights/assistant/ask/'))?.body).toMatchObject({ name: 'Store Delivery Leaderboard' })
  expect((within(card).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Store Delivery Leaderboard')
  const details = screen.getByRole('region', { name: 'Run Details' })
  expect(within(details).getByText(/3\.2 s · 2,830 tokens in, 235 out · Claude Sonnet 5\.5/)).toBeTruthy()
  expect(within(details).getByRole('region', { name: 'Draft Report' })).toBe(card)                       // the outcome shows in Run Details

  await user.clear(within(box).getByRole('textbox', { name: 'Report Name' }))
  const prompt = within(box).getByRole('textbox', { name: 'What do you want to see?' })
  await user.clear(prompt)
  await user.type(prompt, 'Website visits by campaign')
  await user.click(within(box).getByRole('button', { name: 'Generate Report' }))
  await screen.findByRole('region', { name: 'No Field for This' })
  expect(calls.filter((call) => call.url.endsWith('/insights/assistant/ask/')).at(-1)?.body).not.toHaveProperty('name')
  const earlier = within(details).getByRole('list', { name: 'Earlier runs' })
  expect(within(earlier).getByText('Store Delivery Leaderboard')).toBeTruthy()
  expect(within(earlier).getByText('Draft')).toBeTruthy()
  await user.click(within(earlier).getByRole('button', { name: 'Show Steps' }))
  expect(within(earlier).getByRole('list', { name: 'Steps taken' })).toBeTruthy()
})

test('Prompt History: newest first, older prompts on demand, Use Again puts one back in the box, the pencil renames, Show hides the list', async () => {
  const calls = await renderAppAt('/insights/ai-reports', true, () => {
    insightsHistoryNow.prompts = Array.from({ length: 35 }, (_, n) => historyPrompt(n + 1, n === 0 ? { report_id: 'rep-1', report_name: 'Sends by campaign', draft_name: null } : {}))
  })
  const user = userEvent.setup()
  const history = await screen.findByRole('region', { name: 'Prompt History' })
  const list = await within(history).findByRole('list', { name: 'Your prompts' })
  expect(within(list).getAllByText(/^Prompt number /)).toHaveLength(30)
  expect(within(list).getAllByText(/^Prompt number /)[0].textContent).toBe('Prompt number 1')
  expect(within(list).getByRole('link', { name: 'Sends by campaign' })).toBeTruthy()
  await user.click(within(list).getByRole('button', { name: 'Show Older Prompts' }))
  expect(await within(list).findByText('Prompt number 35')).toBeTruthy()
  expect(calls.some((call) => call.url.includes('/insights/assistant/history/?before=hist-30'))).toBe(true)

  const second = within(list).getByText('Prompt number 2').closest('li') as HTMLElement
  await user.click(within(second).getByRole('button', { name: 'Use Again' }))
  expect((screen.getByRole('textbox', { name: 'What do you want to see?' }) as HTMLTextAreaElement).value).toBe('Prompt number 2')

  await user.click(within(second).getByRole('button', { name: 'Rename Draft 2' }))
  const name = within(second).getByRole('textbox', { name: 'Report name' })
  await user.clear(name)
  await user.type(name, 'Weekly Delivery{Enter}')
  expect(calls.find((call) => call.url.endsWith('/insights/assistant/hist-2/rename/'))?.body).toEqual({ name: 'Weekly Delivery' })
  expect(await within(history).findByText('Weekly Delivery')).toBeTruthy()

  await user.click(within(history).getByRole('switch', { name: 'Show Prompt History' }))
  expect(within(history).queryByRole('list', { name: 'Your prompts' })).toBeNull()
  expect(within(history).getByText(/Hidden\. Your earlier prompts are kept/)).toBeTruthy()
  expect(window.localStorage.getItem('insights.ai.history')).toBe('hidden')
})

test('Clear History asks first, then empties the list', async () => {
  const calls = await renderAppAt('/insights/ai-reports', true, () => { insightsHistoryNow.prompts = [historyPrompt(1), historyPrompt(2)] })
  const user = userEvent.setup()
  const history = await screen.findByRole('region', { name: 'Prompt History' })
  await within(history).findByRole('list', { name: 'Your prompts' })
  await user.click(within(history).getByRole('button', { name: 'Clear History…' }))
  const dialog = await screen.findByRole('dialog', { name: 'Clear your prompt history?' })
  expect(within(dialog).getByText(/the month’s prompt count stays as it is/)).toBeTruthy()
  await user.click(within(dialog).getByRole('button', { name: 'Clear History' }))
  expect(calls.some((call) => call.url.endsWith('/insights/assistant/history/clear/') && call.method === 'POST')).toBe(true)
  expect(await within(history).findByText(/No prompts yet/)).toBeTruthy()
})
