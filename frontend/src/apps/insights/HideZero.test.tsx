/** hideZero: the measures whose zero lines a report leaves out, kept through the editor's save and pruned with their columns. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, insightsReport, installMockApi, me, signIn } from '@/test/mockApi'
import { pruneHideZero, removeField } from './editor/definition'
import type { ReportDefinition } from './types'

const withInsights = { ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, 'report.edit', 'report.admin'] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } }
const saved = insightsReport.definition

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  ;(insightsReport as { definition: ReportDefinition }).definition = saved
})

test('a measure that goes takes its hidden zero lines with it; so does the last dimension', () => {
  const definition: ReportDefinition = { columns: [{ field: 'channel' }, { field: 'sent', aggregate: 'sum' }, { field: 'delivered', aggregate: 'sum' }], hideZero: ['sent', 'delivered'] }
  expect(removeField(definition, 'delivered').hideZero).toEqual(['sent'])
  expect('hideZero' in removeField(removeField(definition, 'delivered'), 'sent')).toBe(false)
  expect('hideZero' in removeField(definition, 'channel')).toBe(false)
  expect(pruneHideZero(definition)).toBe(definition)
})

test('the editor saves a report with hideZero and keeps it', async () => {
  ;(insightsReport as { definition: ReportDefinition }).definition = { ...saved, hideZero: ['sent'] }
  const user = userEvent.setup()
  const calls = installMockApi({ me: withInsights as never })
  signIn('/insights/reports/rep-1/edit')
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  await screen.findByRole('textbox', { name: 'Report name' })
  await user.click(await screen.findByRole('tab', { name: 'Settings' }))
  await user.click(screen.getByRole('button', { name: /^Detail Report/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Detail Report' })
  await user.click(within(dialog).getByRole('checkbox', { name: 'Channel' }))
  await user.click(within(dialog).getByRole('button', { name: 'Apply' }))
  const save = screen.getByRole('button', { name: 'Save' })
  await vi.waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  await user.click(save)
  await vi.waitFor(() => {
    const put = calls.filter((call) => call.method === 'PUT' && call.url.endsWith('/insights/reports/rep-1/')).at(-1)?.body as { definition?: ReportDefinition } | undefined
    expect(put?.definition?.hideZero).toEqual(['sent'])
    expect(put?.definition?.drillthrough).toEqual(['channel'])
  })
})
