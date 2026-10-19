/**
 * A dashboard's pages, pure: tabs of rows (`layout.pages`), or the one page a dashboard without tabs is (`layout.rows`).
 * The editors work on one page's rows at a time and write them back; the first extra page turns the rows into page 1.
 */
import type { DashboardLayout, DashboardPageT, DashboardRow } from '../types'

export const FIRST_PAGE = 'p1'
export const MAX_PAGES = 10

/** the pages to show: the layout's own, or its rows as one untitled page */
export function pagesOf(layout: DashboardLayout): DashboardPageT[] {
  return layout.pages?.length ? layout.pages : [{ id: FIRST_PAGE, title: 'Page 1', rows: layout.rows ?? [] }]
}

export function pageRows(layout: DashboardLayout, pageId: string): DashboardRow[] {
  const pages = pagesOf(layout)
  return (pages.find((page) => page.id === pageId) ?? pages[0]).rows
}

/** one page's rows replaced; a layout without tabs keeps its rows */
export function setPageRows(layout: DashboardLayout, pageId: string, rows: DashboardRow[]): DashboardLayout {
  if (!layout.pages?.length) return { ...layout, rows }
  return { ...layout, pages: layout.pages.map((page) => (page.id === pageId ? { ...page, rows } : page)) }
}

function newPageId(pages: DashboardPageT[]): string {
  const taken = new Set(pages.map((page) => page.id))
  let n = pages.length + 1
  while (taken.has(`p${n}`)) n += 1
  return `p${n}`
}

/** a new empty page at the end; the first one added turns the rows into page 1 */
export function addPage(layout: DashboardLayout): { layout: DashboardLayout; pageId: string } {
  const pages = pagesOf(layout)
  if (pages.length >= MAX_PAGES) return { layout, pageId: pages[pages.length - 1].id }
  const page: DashboardPageT = { id: newPageId(pages), title: `Page ${pages.length + 1}`, rows: [] }
  const { rows: _rows, ...rest } = layout
  return { layout: { ...rest, rows: [], pages: [...pages, page] }, pageId: page.id }
}

export function renamePage(layout: DashboardLayout, pageId: string, title: string): DashboardLayout {
  const pages = pagesOf(layout).map((page) => (page.id === pageId ? { ...page, title } : page))
  const { rows: _rows, ...rest } = layout
  return { ...rest, rows: [], pages }
}

/** the page goes with its tiles; the last page left turns back into plain rows */
export function removePage(layout: DashboardLayout, pageId: string): DashboardLayout {
  const pages = pagesOf(layout).filter((page) => page.id !== pageId)
  const { pages: _pages, ...rest } = layout
  if (pages.length <= 1) return { ...rest, rows: pages[0]?.rows ?? [] }
  return { ...rest, rows: [], pages }
}
