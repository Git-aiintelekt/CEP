// Keeps the previous builds' files in dist/assets for two weeks, so a page opened before an install keeps working.
// Vite empties dist/ and names every file by its content, so a tab still running the old version asked for a screen
// (the journey canvas, the designer) whose file the new build had removed: "Failed to fetch dynamically imported module".
//
//   node scripts/keep-assets.mjs save      before the build: dist/assets -> .assets-previous (added to, never emptied)
//   node scripts/keep-assets.mjs restore   after the build and its budget check: the old files the new build does not
//                                          have go back, unless older than KEEP_DAYS; .assets-previous is removed
// index.html always names the new files only; the old ones are reached only by pages that were already open.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const KEEP_DAYS = 14
const assets = join(process.cwd(), 'dist', 'assets')
const held = join(process.cwd(), '.assets-previous')
const step = process.argv[2]

if (step === 'save') {
  if (existsSync(assets)) {
    mkdirSync(held, { recursive: true })
    cpSync(assets, held, { recursive: true, preserveTimestamps: true, force: false, errorOnExist: false })
  }
  console.log(`kept for the next build: ${existsSync(held) ? readdirSync(held).length : 0} files`)
} else if (step === 'restore') {
  let restored = 0
  let dropped = 0
  if (existsSync(held)) {
    const now = new Set(readdirSync(assets))
    const oldest = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
    for (const name of readdirSync(held)) {
      if (now.has(name)) continue
      const from = join(held, name)
      if (statSync(from).mtimeMs < oldest) {
        dropped += 1
        continue
      }
      cpSync(from, join(assets, name), { recursive: true, preserveTimestamps: true })
      restored += 1
    }
    rmSync(held, { recursive: true, force: true })
  }
  console.log(`previous builds' files kept: ${restored} (older than ${KEEP_DAYS} days dropped: ${dropped})`)
} else {
  console.error('usage: node scripts/keep-assets.mjs save | restore')
  process.exit(2)
}
