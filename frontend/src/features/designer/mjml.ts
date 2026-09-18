/**
 * MJML in, GrapesJS out: two repairs around one browser behaviour.
 *
 * GrapesJS parses markup with the browser's HTML parser, and in HTML `/>` means nothing on an unknown element:
 * `<mj-divider />` stays OPEN, so every following sibling ends up INSIDE the divider. MJML then reports
 * "mj-text cannot be used inside mj-divider" and leaves that content out of the email.
 */
import type { ProjectData } from 'grapesjs'

/** MJML elements that never have children */
const VOID = new Set(['mj-divider', 'mj-spacer', 'mj-image', 'mj-carousel-image', 'mj-all', 'mj-class', 'mj-breakpoint', 'mj-font', 'mj-include'])

/** `<mj-divider a="1" />` -> `<mj-divider a="1"></mj-divider>`, for every mj-* tag, before the markup reaches the editor. */
export function expandSelfClosing(mjml: string): string {
  return mjml.replace(/<(mj-[a-z-]+)(\s[^<>]*?)?\s*\/>/gi, (_match, tag: string, attributes: string | undefined) => `<${tag}${attributes ?? ''}></${tag}>`)
}

type Node = { type?: string; tagName?: string; components?: unknown; [key: string]: unknown }

const isVoid = (node: Node) => VOID.has(String(node.type ?? node.tagName ?? '').toLowerCase())

function flatten(list: unknown[], counter: { moved: number }): unknown[] {
  const out: unknown[] = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') {
      out.push(item)
      continue
    }
    const node = item as Node
    const children = Array.isArray(node.components) ? node.components : null
    if (children && children.length > 0 && isVoid(node)) {
      const { components: _swallowed, ...rest } = node       // the divider itself, childless again ...
      void _swallowed
      out.push(rest)
      counter.moved += children.length
      out.push(...flatten(children, counter))                // ... and what it swallowed, back as its following siblings
    } else {
      out.push(children ? { ...node, components: flatten(children, counter) } : node)
    }
  }
  return out
}

/**
 * A design saved while the bug above was live has the wrong nesting inside its project data. Moves everything found
 * inside a void element back out, in order. Returns the project and how many components were moved (0 = untouched).
 */
export function repairProject(project: ProjectData): { project: ProjectData; moved: number } {
  const counter = { moved: 0 }
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return flatten(value.map(walk), counter)
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, inner]) => [key, key === 'components' || key === 'component' || key === 'frames' || key === 'pages' ? walk(inner) : inner]))
    }
    return value
  }
  const repaired = { ...project, pages: walk((project as { pages?: unknown }).pages) } as ProjectData
  return { project: counter.moved > 0 ? repaired : project, moved: counter.moved }
}
