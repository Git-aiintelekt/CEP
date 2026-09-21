import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, test } from 'vitest'

import { WizardTracker, WIZARD_STEPS } from './WizardTracker'

const steps = [
  { label: 'Audience', href: '/campaigns/1/audience' },
  { label: 'Template', href: '/campaigns/1/template' },
  { label: 'Targets', href: '/campaigns/1/targets' },
  { label: 'Test and publish', href: '/campaigns/1/publish' },
]

function renderAt(currentIndex: number) {
  render(
    <MemoryRouter>
      <WizardTracker steps={steps} currentIndex={currentIndex} />
    </MemoryRouter>,
  )
}

afterEach(cleanup)

test('the four steps are named in order', () => {
  expect(WIZARD_STEPS.map((step) => step.label)).toEqual(['Audience', 'Template', 'Targets', 'Test and publish'])
})

test('completed steps are links back', () => {
  renderAt(2)

  expect(screen.getByRole('link', { name: 'Audience' }).getAttribute('href')).toBe('/campaigns/1/audience')
  expect(screen.getByRole('link', { name: 'Template' }).getAttribute('href')).toBe('/campaigns/1/template')
})

test('the current step is marked and is not a link', () => {
  renderAt(2)

  const current = screen.getByText('Targets')
  expect(current.getAttribute('aria-current')).toBe('step')
  expect(screen.queryByRole('link', { name: 'Targets' })).toBeNull()
})

test('later steps are shown, disabled and not links', () => {
  renderAt(2)

  const later = screen.getByText('Test and publish')
  expect(later.getAttribute('aria-disabled')).toBe('true')
  expect(later.getAttribute('aria-current')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Test and publish' })).toBeNull()
})

test('a completed step without an href is not a link', () => {
  render(
    <MemoryRouter>
      <WizardTracker steps={[{ label: 'Audience' }, { label: 'Template' }]} currentIndex={1} />
    </MemoryRouter>,
  )

  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText('Audience')).toBeTruthy()
})

test('the first step can be the current one with nothing completed', () => {
  renderAt(0)

  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByText('Audience').getAttribute('aria-current')).toBe('step')
  expect(screen.getByText('Template').getAttribute('aria-disabled')).toBe('true')
})
