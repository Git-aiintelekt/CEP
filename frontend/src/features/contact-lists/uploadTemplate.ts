/**
 * The sample CSV offered on the upload step: one header per property the import recognises (the same words the
 * column matcher guesses from), two example rows, and the format rules in one line. Built in the browser, so it is
 * always in step with what the wizard's own column matching expects.
 */

export interface UploadColumn {
  header: string
  required: boolean
  /** what the sample rows show, so the format is plain to see */
  examples: [string, string]
  note: string
}

export const UPLOAD_COLUMNS: UploadColumn[] = [
  { header: 'Email', required: true, examples: ['dolores.alvarez@example.com', 'miriam.okonkwo@example.com'], note: 'One address per row. A row without a usable address is held back.' },
  { header: 'First name', required: false, examples: ['Dolores', 'Miriam'], note: '' },
  { header: 'Last name', required: false, examples: ['Alvarez', 'Okonkwo'], note: '' },
  { header: 'Mobile number', required: false, examples: ['+14045550101', '+14045550102'], note: 'With the country code, as +14045550101. Kept for text campaigns; an unrecognised number is left out and the row still imports.' },
  { header: 'Postal code', required: false, examples: ['30303', '31401'], note: '' },
  { header: 'Loyalty ID', required: false, examples: ['NWA700001', 'NWA700002'], note: 'Used first to recognise people CEP already knows.' },
  { header: 'Loyalty tier', required: false, examples: ['GOLD', 'SILVER'], note: '' },
  { header: 'Last order date', required: false, examples: ['2026-08-24', '2026-07-15'], note: 'Dates as YYYY-MM-DD.' },
  { header: 'Consent date', required: false, examples: ['2026-01-10', '2026-03-02'], note: 'Recorded as an email opt-in for people with no consent answer yet. Never overrides an unsubscribe.' },
]

export const TEMPLATE_FILE_NAME = 'cep-contact-list-template.csv'
export const FORMAT_LINE = 'A CSV with a header row and one contact per row. Email is the only column that must be there; the others are optional and can be in any order. Dates as YYYY-MM-DD, mobile numbers with the country code.'

function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The template's text: a UTF-8 byte order mark so Excel reads accents, CRLF line ends so every spreadsheet opens it cleanly. */
export function templateCsv(): string {
  const lines = [UPLOAD_COLUMNS.map((column) => column.header), UPLOAD_COLUMNS.map((column) => column.examples[0]), UPLOAD_COLUMNS.map((column) => column.examples[1])]
  return '﻿' + lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** Saves the template through a temporary link, as the exports do. */
export function downloadTemplate(): void {
  const blob = new Blob([templateCsv()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = TEMPLATE_FILE_NAME
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
