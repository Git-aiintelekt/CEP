import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, expect, test } from 'vitest'

import { Drawer } from './Drawer'

afterEach(cleanup)

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open Message</button>
      {open && (
        <Drawer title="How Points Work" eyebrow="Message 2 of 4" onClose={() => setOpen(false)} footer={<button type="button" onClick={() => setOpen(false)}>Done</button>}>
          <label htmlFor="name">Internal Name</label>
          <input id="name" data-autofocus />
        </Drawer>
      )}
    </>
  )
}

test('a modal drawer: named by its title, focus moves in and stays inside, Escape closes it and focus goes back', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  const opener = screen.getByRole('button', { name: 'Open Message' })
  await user.click(opener)

  const drawer = screen.getByRole('dialog', { name: 'How Points Work' })
  expect(drawer.getAttribute('aria-modal')).toBe('true')
  expect(screen.getByText('Message 2 of 4')).toBeTruthy()
  expect(document.activeElement).toBe(screen.getByLabelText('Internal Name'))

  await user.tab()
  expect(document.activeElement?.textContent).toBe('Done')
  await user.tab()                                                       // past the last stop: back to the first (Close)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  await user.tab({ shift: true })
  expect(document.activeElement?.textContent).toBe('Done')

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

test('the scrim and the close button close it', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: 'Open Message' }))
  await user.click(document.querySelector<HTMLElement>('[data-drawer-scrim]')!)
  expect(screen.queryByRole('dialog')).toBeNull()

  await user.click(screen.getByRole('button', { name: 'Open Message' }))
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
