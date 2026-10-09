import { cleanup, render, screen } from '@testing-library/react'
import { CalendarClock, MailOpen } from 'lucide-react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { ChangeChip } from './ChangeChip'
import { HomeCard } from './HomeCard'
import { BenchmarkTag, SeverityTag } from './HomeTags'
import { HeroCard } from './HeroCard'
import { PlumChip, RingKpi } from './RingKpi'
import { SectionHeader } from './SectionHeader'

afterEach(cleanup)

test('change chips: green up, red down, grey and arrowless when flat or unknown; they say what they mean', () => {
  render(<><ChangeChip value={6.2} unit="%" /><ChangeChip value={-12.4} unit="%" /><ChangeChip value={0} unit="%" /><ChangeChip value={-0.3} unit="pt" /><ChangeChip value={null} unit="pt" /></>)
  const up = screen.getByRole('img', { name: 'Up 6.2% on the previous period' })
  expect(up.textContent).toBe('+6.2%')
  expect(up.className).toContain('bg-success-bg text-success-text')
  expect(up.className).toContain('h-[22px]')
  expect(up.className).not.toContain('border')
  expect(up.querySelector('.lucide-arrow-up')).toBeTruthy()
  const down = screen.getByRole('img', { name: 'Down 12.4% on the previous period' })
  expect(down.textContent).toBe('−12.4%')
  expect(down.className).toContain('bg-danger-bg text-danger-text')
  const flat = screen.getByRole('img', { name: 'No change on the previous period' })
  expect(flat.textContent).toBe('0.0%')
  expect(flat.className).toContain('bg-fill-subtle text-ink-800')
  expect(flat.querySelector('svg')).toBeNull()
  expect(screen.getByRole('img', { name: 'Down 0.3 pt on the previous period' }).textContent).toBe('−0.3 pt')
  expect(screen.getByRole('img', { name: 'No figure to compare on the previous period' }).textContent).toBe('—')
})

test('benchmark tags have no dot; severity tags carry their icon and colours', () => {
  const { container } = render(<><BenchmarkTag benchmark="Good" /><BenchmarkTag benchmark="Fair" /><BenchmarkTag benchmark="Poor" />
    <SeverityTag severity="critical" label="Delivery Failure" /><SeverityTag severity="blocking" label="Blocking a Send" /><SeverityTag severity="governance" label="Governance" /></>)
  expect(screen.getByText('Good').className).toContain('bg-success-bg')
  expect(screen.getByText('Fair').className).toContain('bg-warning-bg')
  expect(screen.getByText('Poor').className).toContain('bg-danger-bg')
  expect(container.querySelector('[data-live-dot]')).toBeNull()
  expect(screen.getByText('Delivery Failure').querySelector('.lucide-circle-alert')).toBeTruthy()
  expect(screen.getByText('Blocking a Send').className).toContain('bg-warning-bg text-warning-text')
  const governance = screen.getByText('Governance')
  expect(governance.className).toContain('bg-callout-bg text-callout-text')
  expect(governance.querySelector('svg')!.getAttribute('class')).toContain('text-callout-icon')
})

test('section headers: page and card levels both at the section-title size, the card without a divider; one plum badge; the title labels the section', () => {
  render(<SectionHeader level="page" title="Needs Attention" titleId="t1" icon={CalendarClock} count={6} helper="Showing 6 of 15" actions={<button type="button">View All</button>} />)
  const title = screen.getByRole('heading', { name: 'Needs Attention' })
  expect(title.id).toBe('t1')
  expect(title.className).toContain('text-section-title')
  expect(document.querySelectorAll('[data-plum-icon]')).toHaveLength(1)
  expect(document.querySelector('[data-plum-icon]')!.className).toContain('cep-home-badge flex h-8 w-8 shrink-0 items-center justify-center rounded-control-md text-plum-700')
  expect(screen.getByText('Showing 6 of 15').className).toContain('text-helper text-ink-800')
  cleanup()

  render(<MemoryRouter><HomeCard title="Recent Campaigns" footer={<a href="/campaigns">View All Campaigns</a>}>Rows</HomeCard></MemoryRouter>)
  const card = screen.getByRole('region', { name: 'Recent Campaigns' })
  expect(card.className).toContain('rounded-lg border border-line bg-surface')
  expect(card.className).not.toContain('shadow')
  expect(screen.getByRole('heading', { name: 'Recent Campaigns' }).className).toContain('text-section-title')
  expect(card.querySelector('[data-section-header="card"]')!.className).not.toContain('border-b')
  expect(card.querySelector('[data-plum-icon]')).toBeNull()
  expect(screen.getByRole('link', { name: 'View All Campaigns' }).parentElement!.className).toContain('border-t')
})

test('a card whose section is unavailable renders nothing; loading and errors show inside it', () => {
  const { container } = render(<HomeCard title="Governance" result={{ status: 'unavailable' }}>{() => 'data'}</HomeCard>)
  expect(container.innerHTML).toBe('')
  render(<HomeCard title="Journeys" result={{ status: 'loading' }}>{() => 'data'}</HomeCard>)
  expect(document.querySelector('[data-card-loading]')).toBeTruthy()
  render(<HomeCard<string> title="E-Receipts" result={{ status: 'ready', data: 'ready data' }}>{(data) => data}</HomeCard>)
  expect(screen.getByText('ready data')).toBeTruthy()
})

test('ring KPIs: the figure, its supporting line and chips, the ring filled to its share; Not Tracked is quiet', () => {
  render(
    <>
      <RingKpi label="Open Rate" icon={MailOpen} note="Email Only" value="37.5%" percent={37.5} supporting="405,585 opened" chips={<PlumChip>Good</PlumChip>} />
      <RingKpi label="SMS Opens" icon={MailOpen} value="Not Tracked" quiet supporting="SMS does not report opens" />
      <RingKpi label="Loading" icon={MailOpen} loading />
    </>,
  )
  const open = document.querySelector('[data-kpi="Open Rate"]')!
  expect(open.textContent).toContain('Email Only')
  expect(open.textContent).toContain('405,585 opened')
  expect(open.querySelector('[data-ring]')!.getAttribute('data-ring')).toBe('38')
  expect(screen.getByText('Good').className).toContain('bg-plum-100')
  expect(screen.getByText('37.5%').className).toContain('text-kpi')
  expect(screen.getByText('Not Tracked').className).toContain('text-section-title')
  expect(document.querySelector('[data-kpi="SMS Opens"] [data-ring]')!.getAttribute('data-ring')).toBe('0')
  expect(document.querySelector('[data-kpi="Loading"] [data-kpi-loading]')).toBeTruthy()
})

test('hero cards: the label in white semibold, the chip, the figure and its line, the goal in amber when behind', () => {
  render(<HeroCard tone="navy" label="Attributed Revenue" chip="Last 30 Days" value="$4.3K" sub="from $127 spent" footLeft="Attributed to campaigns" footRight="35% of $12.5K goal" footWarning />)
  const hero = document.querySelector('[data-kpi="Attributed Revenue"]')!
  expect(hero.className).toContain('cep-home-hero-navy')
  expect(screen.getByText('Attributed Revenue').className).toContain('text-sm font-semibold text-on-brand')
  expect(hero.textContent).toContain('Last 30 Days')
  expect(screen.getByText('$4.3K').className).toContain('text-home-hero')
  expect(hero.querySelector('[data-hero-goal]')!.className).toContain('text-warning')
})
