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

import type { ListChannel } from '@/lib/types'

export const CHANNEL_LABEL: Record<string, string> = { EMAIL: 'Email', SMS: 'Texts', BOTH: 'Email and Texts' }

/** The columns the import knows, with the required flags for a list of this channel: the address for email, the number for texts, both for both. */
export function uploadColumns(channel: ListChannel | string = 'EMAIL'): UploadColumn[] {
  const email = channel !== 'SMS'
  const mobile = channel !== 'EMAIL'
  return [
    { header: 'Email', required: email, examples: ['dolores.alvarez@example.com', 'miriam.okonkwo@example.com'],
      note: email ? 'One address per row. A row without a usable address is held back.' : 'Optional on a text list. An address that is not recognised is left out and the row still imports.' },
    { header: 'First name', required: false, examples: ['Dolores', 'Miriam'], note: '' },
    { header: 'Last name', required: false, examples: ['Alvarez', 'Okonkwo'], note: '' },
    { header: 'Mobile number', required: mobile, examples: ['+14045550101', '+14045550102'],
      note: mobile ? 'With the country code, as +14045550101. A row without a usable number is held back.' : 'With the country code, as +14045550101. Kept for text campaigns; an unrecognised number is left out and the row still imports.' },
    { header: 'Postal code', required: false, examples: ['30303', '31401'], note: '' },
    { header: 'Loyalty ID', required: false, examples: ['NWA700001', 'NWA700002'], note: 'Used first to recognise people CEP already knows.' },
    { header: 'Loyalty tier', required: false, examples: ['GOLD', 'SILVER'], note: '' },
    { header: 'Last order date', required: false, examples: ['2026-08-24', '2026-07-15'], note: 'Dates as YYYY-MM-DD.' },
    { header: 'Time zone', required: false, examples: ['America/New_York', 'America/Chicago'], note: 'The customer’s own time zone, an IANA name such as America/Chicago. Journeys that wait until a time of day use it.' },
    { header: 'Email consent date', required: false, examples: ['2026-01-10', '2026-03-02'], note: 'Recorded as an email opt-in for people with no consent answer yet. Never overrides an unsubscribe.' },
    { header: 'Text consent date', required: false, examples: ['2026-01-10', ''], note: 'Recorded as a text (SMS) opt-in for people with no consent answer yet. Never overrides a STOP. Marketing texts need it.' },
  ]
}

/** the email list's columns: what the first version of the template offered */
export const UPLOAD_COLUMNS: UploadColumn[] = uploadColumns('EMAIL')

export function formatLine(channel: ListChannel | string = 'EMAIL'): string {
  const must = channel === 'BOTH' ? 'Email and Mobile number are the columns that must be there' : channel === 'SMS' ? 'Mobile number is the only column that must be there' : 'Email is the only column that must be there'
  return `A CSV with a header row and one contact per row. ${must}; the others are optional and can be in any order. Dates as YYYY-MM-DD, mobile numbers with the country code.`
}

export const TEMPLATE_FILE_NAME = 'cep-contact-list-template.csv'
export const FORMAT_LINE = formatLine('EMAIL')

function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** The template's text: a UTF-8 byte order mark so Excel reads accents, CRLF line ends so every spreadsheet opens it cleanly. */
export function templateCsv(channel: ListChannel | string = 'EMAIL'): string {
  const columns = uploadColumns(channel)
  const lines = [columns.map((column) => column.header), columns.map((column) => column.examples[0]), columns.map((column) => column.examples[1])]
  return '﻿' + lines.map((line) => line.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** Saves the template through a temporary link, as the exports do. */
export function downloadTemplate(channel: ListChannel | string = 'EMAIL'): void {
  const blob = new Blob([templateCsv(channel)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = TEMPLATE_FILE_NAME
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
