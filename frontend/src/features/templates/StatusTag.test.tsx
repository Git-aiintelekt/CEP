import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { StatusTag } from './StatusTag'

afterEach(cleanup)

test('template statuses use the campaign tag colours: Active with the dot, Draft sand, Archived dashed', () => {
  const { container } = render(<><StatusTag status="ACTIVE" /><StatusTag status="DRAFT" /><StatusTag status="ARCHIVED" /></>)
  expect(screen.getByText('Active').className).toContain('bg-tag-active-bg text-tag-active-text')
  expect(screen.getByText('Draft').className).toContain('bg-tag-draft-bg text-tag-draft-text')
  expect(screen.getByText('Archived').className).toContain('border-dashed border-tag-archived-border')
  expect([...container.querySelectorAll('[data-live-dot]')].map((dot) => dot.parentElement?.textContent)).toEqual(['Active'])
})
