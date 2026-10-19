/** Shared formulas: added on Insights → Shared Formulas against the dataset, certified by a report administrator, marked in the
 * editor's field lists, guarded on removal; a report's own formula shared with every report from Custom Fields; the v2 functions
 * in the editor's list. */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { cepReady, installMockApi, insightsSharedFormulasNow, me, signIn } from '@/test/mockApi'
import { shareCustom } from './editor/definition'
import { FORMULA_FUNCTIONS } from './editor/formulaHelp'

const withInsights = (permissions: string[]) => ({ ...me, principal: { ...me.principal, permissions: [...me.principal.permissions, ...permissions] },
  components: [...me.components, { key: 'insights', name: 'Insights', tagline: 'Reports, dashboards, datasets', access: 'PLAN', until: null }], insights: { mode: 'integrated', standalone_path: '/insights' } })

async function renderAppAt(path: string, permissions = ['report.edit', 'report.admin'], shared: Record<string, unknown>[] = []) {
  const calls = installMockApi({ me: withInsights(permissions) as never })
  if (shared.length) insightsSharedFormulasNow.messages = shared
  signIn(path)
  vi.resetModules()
  const { default: App } = await import('@/App').then(cepReady)
  render(<App />)
  return calls
}

const refundRate = { id: 'sf-1', dataset_key: 'messages', key: 'f_send_share', label: 'Send Share', description: 'Sends as a share of every channel', kind: 'measure', expression: 'DIVIDE(SUM([Sent Count]), CALCULATE(SUM([Sent Count]), ALL([Channel])))',
  type: 'number', role: null, format: 'percent', sensitivity: 'NORMAL', certified: true, certified_at: '2026-10-19T10:00:00Z', certified_by_name: 'Aby', created_by_name: 'Aby', created_at: '2026-10-19T09:00:00Z',
  updated_at: '2026-10-19T09:00:00Z', row_version: 2, reports: 1 }

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('a shared formula is added against the dataset, checked as you type, then certified by a report administrator', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/formulas?dataset=messages')
  expect(await screen.findByText(/No shared formulas on Messages yet\./)).toBeTruthy()
  await user.click(screen.getByRole('button', { name: 'Add a Formula' }))
  const dialog = await screen.findByRole('dialog', { name: 'Add a Shared Formula' })
  await user.type(within(dialog).getByLabelText(/^Name/), 'Email Share')
  await user.type(within(dialog).getByLabelText('Formula'), 'DIVIDE(SUM([[Sent Count], [[Channel] = "EMAIL"), SUM([[Sent Count])) *')
  expect(await within(dialog).findByText('The formula ends too soon: something is missing at the end.')).toBeTruthy()
  await user.type(within(dialog).getByLabelText('Formula'), ' 100')
  expect(await within(dialog).findByText(/Works out a number\. Reads Sent Count, Channel\./)).toBeTruthy()
  expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/insights/datasets/messages/formulas/check/'))).toBe(true)
  await user.selectOptions(within(dialog).getByLabelText('Show as'), 'Percentage')
  await vi.waitFor(() => expect((within(dialog).getByRole('button', { name: 'Add Formula' }) as HTMLButtonElement).disabled).toBe(false))
  await user.click(within(dialog).getByRole('button', { name: 'Add Formula' }))
  const table = await screen.findByRole('table', { name: 'Shared formulas' })
  const row = () => within(table).getAllByRole('row')[1]
  expect(within(row()).getByText('Email Share')).toBeTruthy()
  expect(within(row()).getByText('Not certified')).toBeTruthy()
  const made = calls.find((c) => c.method === 'POST' && c.url.endsWith('/insights/datasets/messages/formulas/'))
  expect(made?.body).toMatchObject({ label: 'Email Share', kind: 'measure', format: 'percent' })
  await user.click(within(table).getByRole('button', { name: 'Actions for Email Share' }))
  await user.click(screen.getByRole('menuitem', { name: /Certify/ }))
  expect(await within(row()).findByText('Certified')).toBeTruthy()
})

test('a formula reports use cannot be removed; one that is certified is not offered for change to a report builder', async () => {
  const user = userEvent.setup()
  await renderAppAt('/insights/formulas?dataset=messages', undefined, [{ ...refundRate }])
  const table = await screen.findByRole('table', { name: 'Shared formulas' })
  await user.click(within(table).getByRole('button', { name: 'Actions for Send Share' }))
  const remove = screen.getAllByRole('menuitem').find((item) => item.textContent?.startsWith('Remove') && !item.textContent.startsWith('Remove Certification'))
  expect(remove?.getAttribute('aria-disabled')).toBe('true')
  expect(remove?.textContent).toContain('Reports use it')
  cleanup()
  await renderAppAt('/insights/formulas?dataset=messages', ['report.edit'], [{ ...refundRate }])
  const builderTable = await screen.findByRole('table', { name: 'Shared formulas' })
  expect(within(within(builderTable).getAllByRole('row')[1]).getByText('Certified')).toBeTruthy()
  expect(within(builderTable).queryByRole('button', { name: 'Actions for Send Share' })).toBeNull()
})

test('the report editor lists a shared formula among the fields, a certified one with its mark', async () => {
  await renderAppAt('/insights/reports/rep-1/edit', undefined, [{ ...refundRate }])
  const field = await screen.findByRole('button', { name: /^Send Share, add/ })
  expect(within(field).getByLabelText('Certified')).toBeTruthy()
})

test('Custom Fields: Share With Every Report moves a report formula onto the dataset', async () => {
  const user = userEvent.setup()
  const calls = await renderAppAt('/insights/reports/rep-1/edit')
  await user.click(await screen.findByRole('button', { name: 'Custom Fields' }))
  const dialog = await screen.findByRole('dialog', { name: 'Custom Fields' })
  await user.type(within(dialog).getByLabelText(/^Name/), 'Email Share')
  await user.selectOptions(within(dialog).getByLabelText('Kind'), 'Measure Formula')
  await user.type(within(dialog).getByLabelText('Formula'), 'SUM([[Sent Count], [[Channel] = "EMAIL")')
  await vi.waitFor(() => expect((within(dialog).getByRole('button', { name: 'Add Field' }) as HTMLButtonElement).disabled).toBe(false))
  await user.click(within(dialog).getByRole('button', { name: 'Add Field' }))
  await user.click(await within(dialog).findByRole('button', { name: 'Share With Every Report' }))
  const sharing = await screen.findByRole('dialog', { name: 'Add a Shared Formula' })
  expect((within(sharing).getByLabelText('Formula') as HTMLTextAreaElement).value).toBe('SUM([Sent Count], [Channel] = "EMAIL")')
  await vi.waitFor(() => expect((within(sharing).getByRole('button', { name: 'Add Formula' }) as HTMLButtonElement).disabled).toBe(false))
  await user.click(within(sharing).getByRole('button', { name: 'Add Formula' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a Shared Formula' })).toBeNull())
  expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/insights/datasets/messages/formulas/'))?.body).toMatchObject({ label: 'Email Share', kind: 'measure' })
  expect(within(dialog).queryByText('Email Share')).toBeNull()
})

test('a shared report names the shared formula wherever it named its own; the v2 functions are listed', () => {
  const shared = shareCustom({ columns: [{ field: 'channel' }, { field: 'c_share', aggregate: 'calc' }], orderBy: [{ field: 'c_share', direction: 'desc' }],
    derived: [{ key: 'c_share', label: 'Share', kind: 'measure', expression: 'SUM([Sent Count])' }, { key: 'c_twice', label: 'Twice', kind: 'measure', expression: '[Share] * 2' }] }, 'c_share', 'f_share')
  expect(shared.columns).toEqual([{ field: 'channel' }, { field: 'f_share', aggregate: 'calc' }])
  expect(shared.orderBy).toEqual([{ field: 'f_share', direction: 'desc' }])
  expect(shared.derived?.map((d) => d.key)).toEqual(['c_twice'])
  const names = FORMULA_FUNCTIONS.flatMap((g) => g.items.map((f) => f.name))
  for (const name of ['SUMX', 'CALCULATE', 'ALL', 'RANKX', 'TOTALYTD', 'SAMEPERIODLASTYEAR', 'PARALLELPERIOD', 'VAR', 'POWER', 'MID', 'WEEKDAY', 'EOMONTH', 'DATE', 'NOW']) expect(names).toContain(name)
})
