// Compiles src/index.css (Tailwind v4) into one static stylesheet for the Claude Design bundle.
// Scans src/ and .design-sync/previews/ like the app build does, plus a safelist of every token-backed
// colour, type, radius and shadow utility, so designs built with the components can use any CEP colour token by class name.
import { compile, optimize } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'src/index.css')
const out = join(root, '.design-sync/.cache/cep.css')
const css = readFileSync(entry, 'utf8')

const colourNames = [...new Set([...css.matchAll(/--color-([a-z0-9-]+)\s*:/g)].map((m) => m[1]))]
// type scale, radii and shadows from @theme, so unused-in-app tokens (text-body, text-caption) still compile
const themeNames = (ns) => [...new Set([...css.matchAll(new RegExp(`--${ns}-([a-z0-9-]+?)\\s*:`, 'g'))].map((m) => m[1]).filter((n) => !n.includes('--')))]
const colourPrefixes = ['bg', 'text', 'border', 'border-t', 'border-b', 'border-l', 'border-r', 'ring', 'outline', 'fill', 'stroke', 'divide', 'accent', 'decoration']
const safelist = [
  ...colourNames.flatMap((c) => colourPrefixes.map((p) => `${p}-${c}`)),
  ...colourNames.map((c) => `hover:bg-${c}`),
  ...themeNames('text').map((n) => `text-${n}`),
  ...themeNames('radius').map((n) => `rounded-${n}`),
  ...themeNames('shadow').map((n) => `shadow-${n}`),
]

const compiler = await compile(css, { base: dirname(entry), onDependency: () => {} })
const scanner = new Scanner({
  sources: [
    { base: join(root, 'src'), pattern: '**/*', negated: false },
    { base: join(root, '.design-sync/previews'), pattern: '**/*', negated: false },
  ],
})
const built = compiler.build([...scanner.scan(), ...safelist])
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, optimize(built, { minify: false }).code)
console.log(`cep.css: ${(built.length / 1024).toFixed(0)} KB, ${colourNames.length} colour tokens safelisted`)
