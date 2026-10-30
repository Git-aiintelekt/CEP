/** A CSV made in the browser: a header line, then the values as they are, quoted where a comma, a quote or a line break needs it. */

function cell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function csvText(headers: string[], rows: unknown[][]): string {
  return [headers.map(cell), ...rows.map((row) => row.map(cell))].map((line) => line.join(',')).join('\r\n')
}

export function downloadCsv(name: string, headers: string[], rows: unknown[][]) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csvText(headers, rows)], { type: 'text/csv;charset=utf-8' }))
  link.download = `${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'export'}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}
