import { render } from '@testing-library/react'
import { expect, test } from 'vitest'

import { CountUp, HomeIntro } from './intro'
import { countFrame } from './introClock'

test('a figure part-way through counting keeps its prefix, suffix, decimals and commas', () => {
  expect(countFrame('$4.4K', 0.5)).toBe('$2.2K')
  expect(countFrame('34.1×', 0)).toBe('0.0×')
  expect(countFrame('1,142,300', 0.5)).toBe('571,150')
  expect(countFrame('22.4% clicks', 1)).toBe('22.4% clicks')
  expect(countFrame('—', 0.5)).toBe('—')
})

test('without motion (no matchMedia, or reduced motion) the figure shows as it is', () => {
  const { container } = render(<HomeIntro><CountUp value="$4.3K" /></HomeIntro>)
  expect(container.textContent).toBe('$4.3K')
})
