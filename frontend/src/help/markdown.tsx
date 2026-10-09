/**
 * The Markdown subset the manuals are written in, rendered with the app's own type and tokens: headings, paragraphs, bullet
 * and numbered lists, tables, block quotes, fenced code, rules; bold, code and links inline. Nothing else is interpreted, so
 * a chapter is plain text with a little structure. The chapter's first H1 is its title; the panel shows it in its header
 * (`markdownParse.ts` holds the parser).
 */
import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { parse } from './markdownParse'

const INLINE = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

/** bold, italics, code and links; anything else is text */
export function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE)
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null
        if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-semibold text-ink-900">{part.slice(2, -2)}</strong>
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) return <em key={index}>{part.slice(1, -1)}</em>
        if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded-sm bg-surface-sunken px-1 py-px font-mono text-[0.9em] text-ink-900">{part.slice(1, -1)}</code>
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
        if (link) {
          const [, label, href] = link
          const inside = href.startsWith('/')
          return inside
            ? <Link key={index} to={href} className="font-medium text-link hover:underline">{label}</Link>
            : <a key={index} href={href} target="_blank" rel="noreferrer" className="font-medium text-link hover:underline">{label}</a>
        }
        return <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}

const HEADING: Record<number, string> = {
  1: 'font-display text-section-title font-semibold text-ink-900',
  2: 'mt-6 font-display text-card-heading font-semibold text-ink-900 first:mt-0',
  3: 'mt-4 text-sm font-semibold text-ink-900',
  4: 'mt-3 text-xs font-semibold tracking-wide text-ink-800 uppercase',
}

/** `skipTitle`: the first H1 is shown elsewhere (the panel's header) */
export function Markdown({ source, skipTitle = false }: { source: string; skipTitle?: boolean }): ReactNode {
  const blocks = parse(source)
  const title = skipTitle ? blocks.findIndex((block) => block.kind === 'heading' && block.level === 1) : -1
  const shown = title === -1 ? blocks : blocks.filter((_, index) => index !== title)
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed text-ink-800">
      {shown.map((block, index) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
            return <Tag key={index} className={HEADING[Math.min(block.level, 4)]}><Inline text={block.text} /></Tag>
          }
          case 'paragraph':
            return <p key={index}><Inline text={block.text} /></p>
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul'
            return (
              <List key={index} className={`flex flex-col gap-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
                {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
              </List>
            )
          }
          case 'table':
            return (
              <div key={index} className="-mx-1 overflow-x-auto">
                <table className="w-full border-collapse text-left text-helper">
                  {block.head.some(Boolean) && (
                    <thead>
                      <tr>{block.head.map((cell, cellIndex) => <th key={cellIndex} scope="col" className="border-b border-line px-2 py-1.5 align-bottom text-xs font-semibold tracking-wide text-ink-800 uppercase"><Inline text={cell} /></th>)}</tr>
                    </thead>
                  )}
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="align-top">
                        {row.map((cell, cellIndex) => <td key={cellIndex} className={`border-b border-line-subtle px-2 py-1.5 ${cellIndex === 0 ? 'w-[28%] min-w-[6rem] font-medium text-ink-900' : ''}`}><Inline text={cell} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'quote':
            return <blockquote key={index} className="border-l-2 border-line pl-3 text-ink-800"><Inline text={block.text} /></blockquote>
          case 'code':
            return <pre key={index} className="overflow-x-auto rounded-control-md bg-surface-sunken px-3 py-2 font-mono text-xs text-ink-900">{block.text}</pre>
          case 'rule':
            return <hr key={index} className="border-line-subtle" />
          default:
            return null
        }
      })}
    </div>
  )
}
