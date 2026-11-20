/** A tile's numbers as a table and as CSV, built in the browser from what the tile ran: its rows, or its figure with the previous period. */
import { csvText, downloadCsv as download } from '../components/csvFile'
import type { ResultColumn, TileResult } from '../types'

export interface TileTable { columns: ResultColumn[]; rows: unknown[][] }

export function tileTable(data: TileResult): TileTable | null {
  if (data.kind === 'view') return { columns: data.result.columns, rows: data.result.rows }
  if (data.kind === 'figure') {
    const columns: ResultColumn[] = [data.column, ...(data.compared ? [{ ...data.column, key: `${data.column.key}_previous`, label: `${data.column.label}, Previous Period` }] : [])]
    return { columns, rows: [[data.value, ...(data.compared ? [data.previous] : [])]] }
  }
  return null
}

export function toCsv(table: TileTable): string {
  return csvText(table.columns.map((c) => c.label), table.rows)
}

export function downloadCsv(table: TileTable, name: string) {
  download(name || 'tile', table.columns.map((c) => c.label), table.rows)
}
