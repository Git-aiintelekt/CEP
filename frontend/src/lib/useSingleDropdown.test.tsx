import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'

import { useSingleDropdown } from './useSingleDropdown'

type Key = 'links' | 'errors'

/** Two triggers and two panels, driven only through the hook's public props. */
function Harness({ showErrorsPanel = true }: { showErrorsPanel?: boolean }) {
  const dropdown = useSingleDropdown<Key>()
  return (
    <div>
      <button type="button" {...dropdown.triggerProps('links')}>
        Links
      </button>
      {dropdown.isOpen('links') && (
        <div role="region" aria-label="Links" {...dropdown.panelProps('links')}>
          <button type="button" data-dropdown-item>link one</button>
          <button type="button" data-dropdown-item disabled>link two</button>
          <button type="button" data-dropdown-item>link three</button>
          <button type="button" onClick={() => dropdown.close({ restoreFocus: false })}>
            close quietly
          </button>
        </div>
      )}

      <button type="button" {...dropdown.triggerProps('errors')}>
        Errors
      </button>
      {dropdown.isOpen('errors') && showErrorsPanel && (
        <div role="region" aria-label="Errors" {...dropdown.panelProps('errors')}>
          <button type="button" data-dropdown-item>error one</button>
          <button type="button" data-dropdown-item>error two</button>
          <button type="button" data-dropdown-item>error three</button>
        </div>
      )}

      <button type="button">elsewhere</button>
    </div>
  )
}

const trigger = (name: string) => screen.getByRole('button', { name })
const panel = (name: string) => screen.queryByRole('region', { name })

afterEach(cleanup)

test('a trigger opens its panel and closes it again', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Links'))
  expect(panel('Links')).toBeTruthy()

  await user.click(trigger('Links'))
  expect(panel('Links')).toBeNull()
})

test('opening one panel closes the other', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Links'))
  await user.click(trigger('Errors'))

  expect(panel('Links')).toBeNull()
  expect(panel('Errors')).toBeTruthy()
})

test('aria-expanded and aria-controls describe the panel', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  expect(trigger('Links').getAttribute('aria-expanded')).toBe('false')
  expect(trigger('Links').getAttribute('aria-haspopup')).toBe('dialog')

  await user.click(trigger('Links'))
  expect(trigger('Links').getAttribute('aria-expanded')).toBe('true')
  expect(trigger('Links').getAttribute('aria-controls')).toBe(panel('Links')?.id)
  expect(trigger('Links').getAttribute('aria-controls')).not.toBe(trigger('Errors').getAttribute('aria-controls'))
})

test('Escape on the trigger closes and keeps focus there', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Links'))
  await user.keyboard('{Escape}')

  expect(panel('Links')).toBeNull()
  expect(document.activeElement).toBe(trigger('Links'))
})

test('Escape from inside the panel returns focus to the trigger', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Links'))
  await user.click(screen.getByRole('button', { name: 'link one' }))
  await user.keyboard('{Escape}')

  expect(panel('Links')).toBeNull()
  expect(document.activeElement).toBe(trigger('Links'))
})

test('a click outside closes the panel without moving focus', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Links'))
  await user.click(trigger('elsewhere'))

  expect(panel('Links')).toBeNull()
  expect(document.activeElement).toBe(trigger('elsewhere'))
})

test('tabbing out of the panel closes it', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Errors'))
  await user.click(screen.getByRole('button', { name: 'error three' }))
  await user.tab()

  expect(panel('Errors')).toBeNull()
  expect(document.activeElement).not.toBe(trigger('Errors'))
})

test('ArrowDown on the trigger moves into the first row', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Links'))
  await user.keyboard('{ArrowDown}')

  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'link one' }))
})

test('ArrowDown and ArrowUp wrap and skip the disabled row', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Links'))
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'link one' }))

  // "link two" is disabled, so down from the first row lands on the third
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'link three' }))

  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'link one' }))

  await user.keyboard('{ArrowUp}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'link three' }))
})

test('Home and End jump to the first and last rows', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Errors'))
  await user.keyboard('{ArrowDown}')

  await user.keyboard('{End}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'error three' }))

  await user.keyboard('{Home}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'error one' }))
})

test('close({ restoreFocus: false }) does not pull focus back to the trigger', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(trigger('Links'))
  // clicking inside the panel is not an outside pointerdown, so this really does go through close()
  await user.click(screen.getByRole('button', { name: 'close quietly' }))

  expect(panel('Links')).toBeNull()
  expect(document.activeElement).not.toBe(trigger('Links'))
})

test('no document listeners are left behind after unmount', async () => {
  const add = vi.spyOn(document, 'addEventListener')
  const remove = vi.spyOn(document, 'removeEventListener')
  const user = userEvent.setup()
  const view = render(<Harness />)

  expect(add).not.toHaveBeenCalled() // nothing is attached while every panel is closed

  await user.click(trigger('Links'))
  const attached = add.mock.calls.map(([type]) => type).sort()
  expect(attached).toEqual(['focusin', 'keydown', 'pointerdown'])

  view.unmount()
  expect(remove.mock.calls.map(([type]) => type).sort()).toEqual(['focusin', 'keydown', 'pointerdown'])
  add.mockRestore()
  remove.mockRestore()
})

test('it survives StrictMode double-mounting', async () => {
  const user = userEvent.setup()
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  )

  await user.click(trigger('Links'))
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'link one' }))

  await user.keyboard('{Escape}')
  expect(panel('Links')).toBeNull()
  expect(document.activeElement).toBe(trigger('Links'))
})

test('a panel that unmounts while open does not throw', async () => {
  function Switcher() {
    const [mounted, setMounted] = useState(true)
    return (
      <div>
        <button type="button" onClick={() => setMounted(false)}>
          drop the panel
        </button>
        <Harness showErrorsPanel={mounted} />
      </div>
    )
  }
  const user = userEvent.setup()
  render(<Switcher />)

  await user.click(trigger('Errors'))
  expect(panel('Errors')).toBeTruthy()

  await user.click(trigger('drop the panel'))
  expect(panel('Errors')).toBeNull()
  await user.keyboard('{Escape}')
  await user.keyboard('{ArrowDown}')
})
