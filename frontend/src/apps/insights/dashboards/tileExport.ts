/** A tile's numbers as a table and as CSV, built in the browser from what the tile ran: its rows, or its figure with the previous period. */
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

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(table: TileTable): string {
  return [table.columns.map((c) => cell(c.label)), ...table.rows.map((row) => row.map(cell))].map((line) => line.join(',')).join('\r\n')
}

export function downloadCsv(table: TileTable, name: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }))
  link.download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'tile'}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}
