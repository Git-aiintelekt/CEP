import { configure } from '@testing-library/react'
import { beforeEach } from 'vitest'

import { installFakeIntersectionObserver } from './intersection'

beforeEach(() => installFakeIntersectionObserver())

// Engagement's pages are a lazy chunk: warm Vite's transform of it once per worker, so a test's first render is not left
// waiting on it (vi.resetModules clears the registry, not the transform cache).
await import('@/apps/cep/routes')

// findBy / waitFor wait up to 5 s: a page's first render in a busy worker can take more than the library's 1 s, and a test
// that passes alone must pass beside its neighbours
configure({ asyncUtilTimeout: 5000 })
