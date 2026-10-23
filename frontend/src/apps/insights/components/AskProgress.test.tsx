/** The steps of a prompt while Ask for a Report builds the report: done ticked, the one under way with its time, the rest greyed, a stop with its reason. */
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import { assistantSteps } from '@/test/mockApi'
import type { AskStep } from '../types'
import { AskProgress } from './AskProgress'

afterEach(cleanup)

test('the step under way shows the time taken so far; the ones to come wait', () => {
  render(<AskProgress steps={assistantSteps('now') as AskStep[]} elapsed={84} />)
  const list = screen.getByRole('list', { name: 'Building the report' })
  const items = within(list).getAllByRole('listitem')
  expect(items[0].getAttribute('aria-current')).toBe('step')
  expect(items[0].textContent).toBe('Under way: Claude is drafting the reportClaude Sonnet 5.51:24')
  expect(items.slice(1).map((item) => item.textContent)).toEqual(['Still to come: Check the draft against your data', 'Still to come: Preview the rows'])
})

test('a step that stopped says why', () => {
  const steps: AskStep[] = [{ key: 'draft', label: 'Claude is drafting the report', detail: 'The provider answered 400: something', state: 'failed', started_at: null, ended_at: null }]
  render(<AskProgress steps={steps} />)
  expect(screen.getByRole('listitem').textContent).toBe('Stopped: Claude is drafting the reportThe provider answered 400: something')
})
