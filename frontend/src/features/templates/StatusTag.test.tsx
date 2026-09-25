import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { StatusTag } from './StatusTag'

afterEach(cleanup)

test('template statuses use the campaign colours: Active green, Draft orange, Archived grey; only Active has the dot', () => {
  const { container } = render(<><StatusTag status="ACTIVE" /><StatusTag status="DRAFT" /><StatusTag status="ARCHIVED" /></>)
  expect(screen.getByText('Active').className).toContain('bg-success-bg')
  expect(screen.getByText('Draft').className).toContain('bg-draft-bg text-draft-text')
  expect(screen.getByText('Archived').className).toContain('bg-line-subtle')
  expect([...container.querySelectorAll('[data-live-dot]')].map((dot) => dot.parentElement?.textContent)).toEqual(['Active'])
})
