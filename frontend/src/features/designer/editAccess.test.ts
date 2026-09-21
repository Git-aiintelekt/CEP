import { expect, test } from 'vitest'

import { canEditTemplate } from './editAccess'

const allow = () => true
const deny = () => false

test('an editor may edit a template that is in use', () => {
  for (const status of ['DRAFT', 'ACTIVE', 'INACTIVE']) expect(canEditTemplate(allow, status), status).toBe(true)
})

test('without template.edit, the design and its code are view-only', () => {
  expect(canEditTemplate(deny, 'DRAFT')).toBe(false)
})

test('an archived template is view-only even for an editor', () => {
  expect(canEditTemplate(allow, 'ARCHIVED')).toBe(false)
})

test('the permission asked for is template.edit', () => {
  const asked: string[] = []
  canEditTemplate((permission) => (asked.push(permission), true), 'DRAFT')
  expect(asked).toEqual(['template.edit'])
})
