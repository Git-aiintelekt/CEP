import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test, vi } from 'vitest'

import { HomePage } from './HomePage'
import { HomeDataProvider } from './data/HomeDataProvider'
import { createSampleSource, type SampleState } from './data/sampleSource'
import { SAMPLE_VIEWER } from './data/sampleViewer'
import type { HomeViewer } from './data/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const STATES: SampleState[] = ['busy', 'light', 'noAttribution', 'noAlerts']
const VIEWERS: Record<string, HomeViewer> = {
  admin: SAMPLE_VIEWER,
  member: { ...SAMPLE_VIEWER, can: (permission) => permission !== 'user.admin' },
  readOnly: { ...SAMPLE_VIEWER, can: (permission) => !['campaign.edit', 'template.edit', 'list.edit', 'journey.edit', 'report.view', 'user.admin'].includes(permission) },
}
const URLS = ['/', '/?campaigns=c06', '/?channel=SMS', '/?period=7d', '/?period=90d']

/** the page's words, less the charts' axes and data tables (where "$0" is the scale's floor or a quiet day, not a figure) */
function pageText(container: HTMLElement): string {
  const copy = container.cloneNode(true) as HTMLElement
  copy.querySelectorAll('svg, [data-chart-table]').forEach((node) => node.remove())
  return copy.textContent ?? ''
}

test.each(STATES.flatMap((state) => Object.keys(VIEWERS).flatMap((viewer) => URLS.map((url) => [state, viewer, url] as const))))(
  '%s, %s viewer, %s: no zero dollars, NaN, undefined, Infinity or weak-spot line, and nothing logged as an error',
  (state, viewer, url) => {
    const errors = vi.spyOn(console, 'error')
    const { container } = render(<MemoryRouter initialEntries={[url]}><HomeDataProvider source={createSampleSource(state)} viewer={VIEWERS[viewer]}><HomePage /></HomeDataProvider></MemoryRouter>)
    const text = pageText(container)
    expect(text).not.toMatch(/\$0(?![\d.,])/)
    for (const word of ['NaN', 'undefined', 'Infinity', 'Lowest', 'Furthest Behind']) expect(text).not.toContain(word)
    expect(errors).not.toHaveBeenCalled()
    if (state === 'noAlerts') expect(text).not.toContain('Needs Attention')
  },
)
