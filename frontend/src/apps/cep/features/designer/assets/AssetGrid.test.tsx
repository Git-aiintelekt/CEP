import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { AssetGrid, EMPTY_NOTE } from './AssetGrid'

afterEach(cleanup)

const assets = [{ url: 'https://cdn.example.com/fall-hero.jpg', name: 'fall-hero.jpg' }]
const tile = () => screen.getByRole('button', { name: /fall-hero\.jpg/ })

test('an empty library says so instead of drawing an empty grid', () => {
  render(<AssetGrid assets={[]} onUse={vi.fn()} />)
  expect(screen.getByText(EMPTY_NOTE)).toBeTruthy()
})

test('where there is somewhere to drop it, dragging a tile carries that image', () => {
  const onDragStart = vi.fn()
  const onUse = vi.fn()
  render(<AssetGrid assets={assets} onUse={onUse} onDragStart={onDragStart} />)

  fireEvent.pointerDown(tile(), { button: 0, clientX: 40, clientY: 40, pointerId: 1 })
  fireEvent.pointerMove(tile(), { clientX: 90, clientY: 60, pointerId: 1 })
  expect(onDragStart).toHaveBeenCalledTimes(1)
  expect(onDragStart.mock.calls[0][0].name).toBe('fall-hero.jpg')
  expect(onUse).not.toHaveBeenCalled()
})

test('the keyboard still applies an image, since it cannot carry one', async () => {
  const user = userEvent.setup()
  const onUse = vi.fn()
  const onDragStart = vi.fn()
  render(<AssetGrid assets={assets} onUse={onUse} onDragStart={onDragStart} />)

  tile().focus()
  await user.keyboard('{Enter}')
  expect(onUse).toHaveBeenCalledTimes(1)
  expect(onDragStart).not.toHaveBeenCalled()
})

test('with nowhere to drop it, a click applies the image outright', async () => {
  const user = userEvent.setup()
  const onUse = vi.fn()
  render(<AssetGrid assets={assets} onUse={onUse} />)

  await user.click(tile())
  expect(onUse).toHaveBeenCalledTimes(1)
})

test('read-only carries and applies nothing', () => {
  const onUse = vi.fn()
  const onDragStart = vi.fn()
  render(<AssetGrid assets={assets} disabled onUse={onUse} onDragStart={onDragStart} />)

  fireEvent.pointerDown(tile(), { button: 0, clientX: 40, clientY: 40, pointerId: 1 })
  fireEvent.pointerMove(tile(), { clientX: 90, clientY: 60, pointerId: 1 })
  fireEvent.click(tile(), { detail: 0 })
  expect(onDragStart).not.toHaveBeenCalled()
  expect(onUse).not.toHaveBeenCalled()
  expect(tile().getAttribute('aria-disabled')).toBe('true')
})

test('the whole picture is shown, never a crop of its middle', () => {
  render(<AssetGrid assets={assets} onUse={vi.fn()} />)
  const img = tile().querySelector('img')
  expect(img?.className).toContain('object-contain')
  expect(img?.className).not.toContain('object-cover')
})

test('a press that never moves is a click, and still applies the image', () => {
  const onUse = vi.fn()
  const onDragStart = vi.fn()
  render(<AssetGrid assets={assets} onUse={onUse} onDragStart={onDragStart} />)

  fireEvent.pointerDown(tile(), { button: 0, clientX: 40, clientY: 40, pointerId: 1 })
  fireEvent.pointerUp(tile(), { pointerId: 1 })
  fireEvent.click(tile(), { detail: 1 })
  expect(onDragStart).not.toHaveBeenCalled()
  expect(onUse).toHaveBeenCalledTimes(1)
})

test('a press that travels carries the image instead of applying it', () => {
  const onUse = vi.fn()
  const onDragStart = vi.fn()
  render(<AssetGrid assets={assets} onUse={onUse} onDragStart={onDragStart} />)

  fireEvent.pointerDown(tile(), { button: 0, clientX: 40, clientY: 40, pointerId: 1 })
  fireEvent.pointerMove(tile(), { clientX: 42, clientY: 41, pointerId: 1 })
  expect(onDragStart).not.toHaveBeenCalled() // still within the threshold
  fireEvent.pointerMove(tile(), { clientX: 60, clientY: 44, pointerId: 1 })
  expect(onDragStart).toHaveBeenCalledTimes(1)

  fireEvent.click(tile(), { detail: 1 })
  expect(onUse).not.toHaveBeenCalled()
})

test('carrying one image does not poison the next click', () => {
  const onUse = vi.fn()
  render(<AssetGrid assets={assets} onUse={onUse} onDragStart={vi.fn()} />)

  fireEvent.pointerDown(tile(), { button: 0, clientX: 40, clientY: 40, pointerId: 1 })
  fireEvent.pointerMove(tile(), { clientX: 90, clientY: 90, pointerId: 1 })
  fireEvent.pointerDown(tile(), { button: 0, clientX: 40, clientY: 40, pointerId: 2 })
  fireEvent.pointerUp(tile(), { pointerId: 2 })
  fireEvent.click(tile(), { detail: 1 })
  expect(onUse).toHaveBeenCalledTimes(1)
})
