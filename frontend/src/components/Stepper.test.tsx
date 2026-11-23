import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'

import { Stepper } from './Stepper'

test('a stepper marks done, current and upcoming steps, and names the current one for assistive tech', () => {
  render(<Stepper steps={['Details', 'File', 'Columns']} current={1} />)
  const items = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem')
  expect(items.map((item) => item.getAttribute('data-step-state'))).toEqual(['done', 'current', 'ahead'])
  expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([null, 'step', null])
  expect(items[0].querySelector('.lucide-check')).toBeTruthy()                         // done: a check before the name
  expect(items[0].textContent).toContain('Details')
  expect(items[1].querySelector('.lucide-check')).toBeNull()
  expect(items[1].querySelectorAll('span')[1].className).toContain('font-semibold')    // current: bold
  expect(items[0].querySelector('span[aria-hidden]')!.className).toContain('bg-brand-600')
  expect(items[1].querySelector('span[aria-hidden]')!.className).toContain('bg-brand-600')
  expect(items[2].querySelector('span[aria-hidden]')!.className).toContain('bg-line-subtle')
})
