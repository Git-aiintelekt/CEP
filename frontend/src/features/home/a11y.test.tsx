/** Spec §9 on the whole Home page, checked in the DOM (jest-axe isn't a dependency). */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { HomePage } from './HomePage'
import { HomeDataProvider } from './data/HomeDataProvider'
import { createSampleSource } from './data/sampleSource'
import { SAMPLE_VIEWER } from './data/sampleViewer'

afterEach(cleanup)

const renderHome = () => render(<MemoryRouter><HomeDataProvider source={createSampleSource('busy')} viewer={SAMPLE_VIEWER}><HomePage /></HomeDataProvider></MemoryRouter>)

test('one h1, then every block a <section> named by its own h2', () => {
  const { container } = renderHome()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  const sections = [...container.querySelectorAll('section[aria-labelledby]')]
  expect(sections).toHaveLength(11)                                                                      // every block in the busy workspace
  for (const section of sections) {
    const heading = document.getElementById(section.getAttribute('aria-labelledby')!)!
    expect(heading.tagName).toBe('H2')
    expect(heading.textContent!.length).toBeGreaterThan(0)
  }
  expect(container.querySelectorAll('h3, h4, h5, h6')).toHaveLength(0)
})

test('toggles are radio groups with aria-checked; menus are listboxes with aria-selected, the Campaign one multi-select', async () => {
  const user = userEvent.setup()
  renderHome()
  for (const group of screen.getAllByRole('radiogroup')) {
    const radios = within(group).getAllByRole('radio')
    expect(radios.filter((radio) => radio.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  }
  await user.click(screen.getByRole('button', { name: 'All Campaigns' }))
  const campaigns = screen.getByRole('listbox', { name: 'Campaigns' })
  expect(campaigns.getAttribute('aria-multiselectable')).toBe('true')
  expect(within(campaigns).getAllByRole('option').every((option) => option.hasAttribute('aria-selected'))).toBe(true)
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'All Channels' }))
  const channels = screen.getByRole('listbox', { name: 'Channel' })
  expect(within(channels).getAllByRole('option').map((option) => option.getAttribute('aria-selected'))).toContain('true')
  expect(within(channels).getAllByRole('option')[0].className).toContain('cep-focus-inset')                       // its focus ring sits inside the menu
})

test('charts take focus, move with the arrow keys and carry a name', async () => {
  const user = userEvent.setup()
  const { container } = renderHome()
  const plots = [...container.querySelectorAll('[data-chart-plot]')] as HTMLElement[]
  expect(plots.length).toBeGreaterThan(0)
  for (const plot of plots) {
    expect(plot.tabIndex).toBe(0)
    expect(plot.getAttribute('aria-label')).toBeTruthy()
  }
  plots[0].focus()
  await user.keyboard('{ArrowRight}')
  expect(container.querySelector('[data-chart-tooltip]')).toBeTruthy()
})

test('colour is never alone: tags have words, target bars have their percentage, alert cards their label', () => {
  const { container } = renderHome()
  for (const tag of container.querySelectorAll('[data-severity], [data-category]')) expect(tag.textContent!.trim().length).toBeGreaterThan(0)
  for (const bar of container.querySelectorAll('[data-bar="over"], [data-bar="under"]')) expect(bar.parentElement!.querySelector('[data-percent]')!.textContent).toMatch(/%$/)
  for (const bar of container.querySelectorAll('[data-target-bar]')) expect(bar.parentElement!.textContent).toMatch(/\d+%$/)
})

test('every cut-off name can be read in full: campaign names sit in TruncatedText with its tooltip', () => {
  const { container } = renderHome()
  const names = [...container.querySelectorAll('tr[data-campaign] a, [data-run] , li[data-bar-row]')]
  expect(names.length).toBeGreaterThan(0)
  for (const name of names) expect(name.querySelector('.truncate')?.closest('span.inline-flex')).toBeTruthy()          // the Tooltip's wrapper
})
