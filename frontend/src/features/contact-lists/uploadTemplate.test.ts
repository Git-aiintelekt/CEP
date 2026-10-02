import { expect, test } from 'vitest'

import { FORMAT_LINE, formatLine, templateCsv, UPLOAD_COLUMNS, uploadColumns } from './uploadTemplate'

test('the sample CSV has every recognised column as its header, the email column first and required, the two consent columns last, and two example rows', () => {
  const text = templateCsv()
  expect(text.startsWith('﻿')).toBe(true)                                                           // Excel reads accents from the BOM
  const lines = text.replace('﻿', '').split('\r\n').filter(Boolean)
  expect(lines).toHaveLength(3)
  expect(lines[0]).toBe('Email,First name,Last name,Mobile number,Postal code,Loyalty ID,Loyalty tier,Last order date,Email consent date,Text consent date')
  expect(lines[1]).toBe('dolores.alvarez@example.com,Dolores,Alvarez,+14045550101,30303,NWA700001,GOLD,2026-08-24,2026-01-10,2026-01-10')
  expect(UPLOAD_COLUMNS.filter((column) => column.required).map((column) => column.header)).toEqual(['Email'])
  expect(FORMAT_LINE).toContain('Email is the only column that must be there')
})

test('the required column follows what the list is for: the number for a text list, both for a both list', () => {
  expect(uploadColumns('SMS').filter((column) => column.required).map((column) => column.header)).toEqual(['Mobile number'])
  expect(uploadColumns('BOTH').filter((column) => column.required).map((column) => column.header)).toEqual(['Email', 'Mobile number'])
  expect(formatLine('SMS')).toContain('Mobile number is the only column that must be there')
  expect(formatLine('BOTH')).toContain('Email and Mobile number are the columns that must be there')
  expect(templateCsv('SMS').split('\r\n')[0].replace('﻿', '')).toBe(templateCsv('EMAIL').split('\r\n')[0].replace('﻿', ''))   // the same headers, only the flags differ
})
