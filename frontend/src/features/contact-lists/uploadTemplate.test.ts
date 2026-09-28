import { expect, test } from 'vitest'

import { FORMAT_LINE, templateCsv, UPLOAD_COLUMNS } from './uploadTemplate'

test('the sample CSV has every recognised column as its header, the email column first and required, and two example rows', () => {
  const text = templateCsv()
  expect(text.startsWith('\ufeff')).toBe(true)                                                           // Excel reads accents from the BOM
  const lines = text.replace('\ufeff', '').split('\r\n').filter(Boolean)
  expect(lines).toHaveLength(3)
  expect(lines[0]).toBe('Email,First name,Last name,Mobile number,Postal code,Loyalty ID,Loyalty tier,Last order date,Consent date')
  expect(lines[1]).toBe('dolores.alvarez@example.com,Dolores,Alvarez,+14045550101,30303,NWA700001,GOLD,2026-08-24,2026-01-10')
  expect(UPLOAD_COLUMNS.filter((column) => column.required).map((column) => column.header)).toEqual(['Email'])
  expect(FORMAT_LINE).toContain('Email is the only column that must be there')
})
