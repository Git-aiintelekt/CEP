/** Where a grid tile leads: the pages of Engagement its names open, and the report its ticked lines open. */
import type { GridLinks } from '../components/ResultGrid'
import type { PeriodBounds, RunResult, TileLinks, TileTick } from '../types'

const OPENS: Record<TileLinks['kind'], { path: string; thing: string }> = { campaign: { path: '/campaigns', thing: 'campaign' }, journey: { path: '/journeys', thing: 'journey' } }

/** the links of a run as the grid takes them: by column, the page of Engagement a name leads to */
export function gridLinks(links: TileLinks[] | undefined): GridLinks | undefined {
  if (!links?.length) return undefined
  return Object.fromEntries(links.map((link) => [link.column, (value: unknown) => {
    const id = link.ids[String(value)]
    return id ? { to: `${OPENS[link.kind].path}/${id}`, label: `Open the ${OPENS[link.kind].thing} ${String(value)} in Engagement` } : null
  }]))
}

/** the address of the report a tile's ticked lines open: they answer one of its questions, and the tile's dates its period */
export function tickedPath(tick: TileTick, values: unknown[], bounds?: PeriodBounds | null): string {
  const answers = { [tick.parameter]: values, ...(tick.period && bounds ? { [tick.period]: [bounds.from, bounds.to] } : {}) }
  return `/insights/reports/${tick.report_id}?ask=${encodeURIComponent(JSON.stringify(answers))}`
}

/** the ticked values the rows still have: a line gone with a new period is no longer counted */
export function stillThere(ticked: unknown[], result: RunResult, field: string): unknown[] {
  const at = result.columns.findIndex((column) => column.key === field)
  if (at < 0) return []
  const have = new Set(result.rows.map((row) => row[at]))
  return ticked.filter((value) => have.has(value))
}

/** "Tick 2 to 6 lines first", "Tick 3 lines first" */
export const tickWords = (tick: TileTick): string => `Tick ${tick.min === tick.max ? tick.min : `${tick.min} to ${tick.max}`} line${tick.max === 1 ? '' : 's'} first`
