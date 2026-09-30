import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { CategoryTag } from './CategoryTag'

afterEach(cleanup)

test('a category tag has the status tag shape with a 12px icon and never a dot', () => {
  const { container } = render(<><CategoryTag category="journey" /><CategoryTag category="campaign" /></>)
  const journey = screen.getByText('Journey')
  const campaign = screen.getByText('Campaign')
  expect(journey.className).toContain('h-[22px]')
  expect(journey.className).toContain('rounded-sm px-2 text-xs font-semibold')
  expect(journey.className).toContain('bg-cat-journey-bg text-cat-journey-text')
  expect(campaign.className).toContain('bg-cat-campaign-bg text-cat-campaign-text')
  expect(journey.querySelector('svg.lucide-route')).toBeTruthy()
  expect(campaign.querySelector('svg.lucide-megaphone')).toBeTruthy()
  const icon = journey.querySelector('svg') as SVGElement
  expect(icon.getAttribute('width')).toBe('12')
  expect(icon.getAttribute('stroke-width')).toBe('1.5')
  expect(icon.getAttribute('aria-hidden')).toBe('true')
  expect(container.querySelector('[data-live-dot]')).toBeNull()
})
