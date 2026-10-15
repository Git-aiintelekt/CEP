// The size budgets of the build (docs/C360_INSIGHTS_SUITE_PLAN.md, docs/SUITE_COMPONENTS.md): the most compressed
// JavaScript the shell, and each suite component when first opened, may add. The build fails above a budget, so a
// component that grows past its budget is noticed in the pull request, not by the person on a slow connection.
import { gzipSync } from 'node:zlib'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Measured on 2026-10-15 after the move: index 90 KB, cep 339 KB (the plan's 250 KB for Engagement is the target to work
// towards, not where it is). Raise a budget only with a reason in the pull request.
const BUDGETS_KB = {
  index: 120,   // the shell: top bar, navigation, sign-in, the query client, the design system, React itself
  cep: 400,     // Engagement's pages (the designer and the journey canvas load separately, on their own pages)
  insights: 360, // Insights' pages: AG Grid Community is most of it (measured 326 KB on 2026-10-16); charts load on their own pages when they come
}

const assets = join(process.cwd(), 'dist', 'assets')
const files = readdirSync(assets).filter((name) => name.endsWith('.js'))
const sizes = {}
for (const name of files) {
  const chunk = name.replace(/-[\w-]+\.js$/, '')
  if (!(chunk in BUDGETS_KB)) continue
  const gz = gzipSync(readFileSync(join(assets, name))).length
  sizes[chunk] = (sizes[chunk] ?? 0) + gz
}
let failed = false
for (const [chunk, budget] of Object.entries(BUDGETS_KB)) {
  const kb = (sizes[chunk] ?? 0) / 1024
  const ok = kb <= budget
  console.log(`${ok ? 'ok  ' : 'OVER'} ${chunk.padEnd(8)} ${kb.toFixed(1).padStart(7)} KB gzip  (budget ${budget} KB)`)
  if (!ok) failed = true
}
if (failed) {
  console.error('A chunk is over its budget: split it, lazy-load the heavy part, or raise the budget in scripts/check-budgets.mjs with a reason.')
  process.exit(1)
}
