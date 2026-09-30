import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CircleAlert } from 'lucide-react'
import { afterEach, expect, test, vi } from 'vitest'

import { Pill } from './Pill'

afterEach(cleanup)

const pill = (name: string | RegExp) => screen.getByRole('button', { name })

test('every tone is a 32px control on the motion token, and only the neutral one is white', () => {
  render(
    <>
      <Pill>Links · 2</Pill>
      <Pill tone="danger">Review errors · 2</Pill>
      <Pill tone="warning">2 warnings</Pill>
    </>,
  )
  for (const name of ['Links · 2', 'Review errors · 2', '2 warnings']) {
    expect(pill(name).className).toContain('h-8')
    expect(pill(name).className).toContain('duration-base')
    expect(pill(name).className).toContain('rounded-control-md')
  }
  expect(pill('Links · 2').className).toContain('bg-surface')
  expect(pill('Review errors · 2').className).toContain('bg-danger-bg')
  expect(pill('Review errors · 2').className).toContain('border-danger')
  expect(pill('2 warnings').className).toContain('bg-warning-bg')
  expect(pill('2 warnings').className).toContain('border-warning')
})

test('every pill answers the pointer: the neutral one on its fill, the tinted ones on their edge', () => {
  render(
    <>
      <Pill>Links · 2</Pill>
      <Pill tone="danger">Review errors · 2</Pill>
      <Pill tone="warning">2 warnings</Pill>
    </>,
  )
  expect(pill('Links · 2').className).toContain('hover:bg-surface-subtle')
  expect(pill('Links · 2').className).toContain('active:bg-fill-subtle')
  expect(pill('Review errors · 2').className).toContain('hover:border-danger-text')
  expect(pill('2 warnings').className).toContain('hover:border-warning-text')
})

test('the chevron points down when the panel is closed and up when it is open', () => {
  const { rerender } = render(<Pill>History</Pill>)
  const down = pill('History').querySelectorAll('svg')
  expect(down).toHaveLength(1)
  const closed = down[0].outerHTML

  rerender(<Pill open>History</Pill>)
  expect(pill('History').querySelectorAll('svg')[0].outerHTML).not.toBe(closed)
})

test('an icon sits before the label at the size controls use, and the chevron can be left off', () => {
  render(
    <Pill icon={CircleAlert} chevron={false}>
      Review errors · 1
    </Pill>,
  )
  const icons = pill('Review errors · 1').querySelectorAll('svg')
  expect(icons).toHaveLength(1)
  expect(icons[0].getAttribute('width')).toBe('14')
})

test('disabled is a grey fill that does not fire, never a faded tint', async () => {
  const onClick = vi.fn()
  const user = userEvent.setup()
  render(
    <Pill tone="danger" disabled onClick={onClick}>
      Review errors · 2
    </Pill>,
  )
  const button = pill('Review errors · 2')
  expect(button.getAttribute('aria-disabled')).toBe('true')
  expect(button.className).toContain('bg-fill-subtle')
  expect(button.className).toContain('text-ink-300')
  expect(button.className).not.toContain('opacity')
  expect(button.className).not.toContain('bg-danger-bg')

  await user.click(button)
  expect(onClick).not.toHaveBeenCalled()
})
