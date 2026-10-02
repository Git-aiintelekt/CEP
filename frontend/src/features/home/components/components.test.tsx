import { cleanup, render, screen } from '@testing-library/react'
import { CalendarClock } from 'lucide-react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { ChangeChip } from './ChangeChip'
import { HomeCard } from './HomeCard'
import { BenchmarkTag, SeverityTag } from './HomeTags'
import { KpiStrip, KpiTile } from './KpiTile'
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

test('section headers: page level at 19px, card level at 18px with a divider; one plum square; the title labels the section', () => {
  render(<SectionHeader level="page" title="Needs Attention" titleId="t1" icon={CalendarClock} count={6} helper="Showing 6 of 15" actions={<button type="button">View All</button>} />)
  const title = screen.getByRole('heading', { name: 'Needs Attention' })
  expect(title.id).toBe('t1')
  expect(title.className).toContain('text-section-title')
  expect(document.querySelectorAll('[data-plum-icon]')).toHaveLength(1)
  expect(document.querySelector('[data-plum-icon]')!.className).toContain('h-7 w-7 shrink-0 items-center justify-center rounded-control-md bg-plum-100 text-plum-700')
  expect(screen.getByText('Showing 6 of 15').className).toContain('text-helper text-ink-800')
  cleanup()

  render(<MemoryRouter><HomeCard title="Recent Campaigns" footer={<a href="/campaigns">View All Campaigns</a>}>Rows</HomeCard></MemoryRouter>)
  const card = screen.getByRole('region', { name: 'Recent Campaigns' })
  expect(card.className).toContain('rounded-lg border border-line bg-surface')
  expect(card.className).not.toContain('shadow')
  expect(screen.getByRole('heading', { name: 'Recent Campaigns' }).className).toContain('text-card-heading')
  expect(card.querySelector('[data-section-header="card"]')!.className).toContain('border-b border-line')
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

test('KPI tiles: the figure with its change and benchmark, the bar; Not Tracked and Not Set Up Yet never show $0', () => {
  render(
    <MemoryRouter>
      <KpiStrip label="Key Figures">
        <KpiTile label="Open Rate" note="Email Only" value="37.5%" change={{ value: 1.1, unit: 'pt' }} benchmark="Good" supporting="405,585 opened" />
        <KpiTile label="Attributed Revenue" value="$1.39M" change={{ value: 9.7, unit: '%' }} progress={{ value: 95, label: 'Revenue against target' }} supporting="95% of $1.47M target" />
        <KpiTile label="SMS Opens" state="notTracked" />
        <KpiTile label="Store Revenue Share" state="notSetUp" canSetUp />
        <KpiTile label="Campaign Contribution" state="notSetUp" />
        <KpiTile label="Loading" state="loading" />
      </KpiStrip>
    </MemoryRouter>,
  )
  const strip = screen.getByRole('group', { name: 'Key Figures' })
  expect(strip.className).toContain('min-[1200px]:grid-cols-6')
  expect(strip.className).toContain('min-[768px]:grid-cols-3')
  const open = document.querySelector('[data-kpi="Open Rate"]')!
  expect(screen.getByText('37.5%').className).toContain('text-[28px]')
  expect(open.textContent).toContain('Email Only')
  expect(screen.getByRole('img', { name: 'Up 1.1 pt on the previous period' })).toBeTruthy()
  const bar = screen.getByRole('progressbar', { name: 'Revenue against target' })
  expect(bar.getAttribute('aria-valuenow')).toBe('95')
  expect(bar.className).toContain('mt-2 h-1')

  // the revenue tile reads top to bottom: value, change, bar, target line
  const revenue = document.querySelector('[data-kpi="Attributed Revenue"]')!
  const order = [...revenue.querySelectorAll('[role="img"], [role="progressbar"], p')].map((node) => node.getAttribute('role') ?? node.textContent)
  expect(order).toEqual(['$1.39M', 'img', 'progressbar', '95% of $1.47M target'])
  const notTracked = document.querySelector('[data-kpi="SMS Opens"]')!
  expect(notTracked.textContent).toContain('Not Tracked')
  expect(notTracked.textContent).toContain('SMS does not report opens')
  expect(screen.getByText('Not Tracked').className).toContain('text-xl')
  const notSetUp = document.querySelector('[data-kpi="Store Revenue Share"]')!
  expect(notSetUp.textContent).toContain('Not Set Up Yet')
  expect(screen.getByRole('link', { name: 'Set Up Attribution' })).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'Set Up Attribution' })).toHaveLength(1)                   // only where the viewer may set it up
  expect(document.querySelector('[data-kpi="Campaign Contribution"]')!.textContent).toContain('Ask an admin to set up attribution.')
  expect(document.body.textContent).not.toContain('$0')
  expect(document.querySelector('[data-kpi-loading]')).toBeTruthy()
})
