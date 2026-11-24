import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { ApiError } from '@/lib/api'
import { failureText, saveFailure } from '@/lib/saveFeedback'

import { ProblemExtras, problemDetails } from './ProblemExtras'
import { ErrorState } from './States'

afterEach(cleanup)

const crashed = (body: Record<string, unknown> = {}) =>
  new ApiError(500, { type: 'about:blank', status: 500, title: 'Internal Server Error', reference: 'ER-38', at: '2026-11-24T05:42:00Z', ...body })

test('a C360 problem names what failed first, then why, and a known problem adds the platform team’s note', () => {
  expect(failureText(crashed(), 'The file was not uploaded')).toMatch(/^The file was not uploaded\. C360 had a problem at .+ reference ER-38\.$/)
  const known = failureText(crashed({ note: 'Uploads from Switch Workspace fail; fixed in tonight’s release' }), 'The file was not uploaded')
  expect(known).toMatch(/ER-38\. Known problem: Uploads from Switch Workspace fail; fixed in tonight’s release\.$/)
  expect(saveFailure(crashed({ note: '   ' }), 'x').note).toBeNull()
})

test('Copy Details: the reference, the time, the page, what failed and who, nothing technical', () => {
  const failure = saveFailure(crashed(), 'The file was not uploaded')
  const text = problemDetails(failure, { workspace: 'CITYST', name: 'Aby John', visiting: true })
  expect(text).toContain('Reference: ER-38')
  expect(text).toMatch(/When: .+ \(05:42 UTC\)/)
  expect(text).toContain('Workspace: CITYST')
  expect(text).toContain(`Page: ${window.location.pathname}`)
  expect(text).toContain('What failed: The file was not uploaded')
  expect(text).toContain('Signed in as: Aby John (Switch Workspace)')
  expect(text).not.toContain('Internal Server Error')
})

test('the panel shows the note and copies the details; a problem without a reference shows nothing', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const failure = saveFailure(crashed({ note: 'Fixed tonight' }), 'The list was not saved')
  const { container, rerender } = render(<ProblemExtras failure={failure} />)
  expect(container.querySelector('[data-known-problem]')?.textContent).toBe('Known problem. Fixed tonight')
  await userEvent.click(screen.getByRole('button', { name: 'Copy Details' }))
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Reference: ER-38'))
  expect(await screen.findByText('Copied')).toBeTruthy()

  rerender(<ProblemExtras failure={saveFailure(new ApiError(400, { type: 'about:blank', status: 400, title: 'x', detail: 'No' }), 'x')} />)
  expect(screen.queryByRole('button', { name: 'Copy Details' })).toBeNull()
})

test('a failed page load offers Copy Details under its message', () => {
  render(<ErrorState error={crashed()} />)
  expect(screen.getByRole('alert').textContent).toContain('ER-38')
  expect(screen.getByRole('button', { name: 'Copy Details' })).toBeTruthy()
})
