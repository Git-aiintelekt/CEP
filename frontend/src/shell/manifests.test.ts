/** Engagement's Reports leads to the Engagement Overview dashboard in Insights once the workspace has it (reports-into-insights, option A). */
import { expect, test } from 'vitest'

import type { Me } from '@/lib/types'
import { componentAt, entitled } from './manifests'

const component = (key: string, name: string) => ({ key, name, tagline: '', access: 'PLAN' as const, until: null })
const me = (keys: string[], overview?: string | null) => ({
  components: keys.map((key) => component(key, key === 'cep' ? 'Engagement' : 'Insights')),
  insights: { mode: 'integrated', standalone_path: '/insights', engagement_overview: overview },
}) as unknown as Me
const reports = (person: Me) => entitled(person).find((item) => item.key === 'cep')?.menu.find((page) => page.label === 'Reports')

test('with Insights and an Engagement Overview, Reports opens the dashboard and says it leaves for Insights', () => {
  expect(reports(me(['cep', 'insights'], 'dash-eo'))).toMatchObject({ to: '/insights/dashboards/dash-eo', opens: 'Insights', label: 'Reports', permission: 'report.view' })
})

test('until the pack is added, or without Insights, Reports opens Engagement’s own page', () => {
  expect(reports(me(['cep', 'insights'], null))).toMatchObject({ to: '/reports' })
  expect(reports(me(['cep', 'insights']))?.opens).toBeUndefined()
  expect(reports(me(['cep'], 'dash-eo'))).toMatchObject({ to: '/reports' })
})

test('the dashboard’s page belongs to Insights’ menu, not to Engagement’s', () => {
  const components = entitled(me(['cep', 'insights'], 'dash-eo'))
  expect(componentAt('/insights/dashboards/dash-eo', components)?.key).toBe('insights')
  expect(componentAt('/reports', components)?.key).toBe('cep')
  expect(componentAt('/campaigns', components)?.key).toBe('cep')
})
