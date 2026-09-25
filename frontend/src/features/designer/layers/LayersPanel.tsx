/** The layers tree beside the canvas. Knows nothing about GrapesJS: every action is the caller's. */
import { ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff, Smartphone, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

import { TreeRow } from '../ui/TreeRow'
import { iconFor } from './layerNames'
import type { LayerNode } from './types'

export const HIDDEN_NOTE = 'Hidden here only. It is still in the email.'
/** Deliberately unlike HIDDEN_NOTE: this one ships and sends, and only phones are told not to draw it. */
export const PHONES_NOTE = 'Hidden on phones. It is sent, but phones do not show it.'
export const PHONES_MARKER_LABEL = 'Hidden on Phones'
export const EMPTY_NOTE = 'Nothing here yet. Drag a block onto the canvas.'

interface LayersPanelProps {
  nodes: LayerNode[]
  disabled?: boolean
  onSelect: (id: string) => void
  onToggleOpen: (id: string) => void
  onToggleVisible: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, direction: 'up' | 'down') => void
  onHover?: (id: string | null) => void
}

interface Row {
  node: LayerNode
  level: number
  parentId: string | null
}

/** Only open branches contribute rows, which is exactly what the arrow keys walk. */
function flatten(nodes: LayerNode[], level = 1, parentId: string | null = null): Row[] {
  return nodes.flatMap((node) => [{ node, level, parentId }, ...(node.open ? flatten(node.children, level + 1, node.id) : [])])
}

export const FOOTER_NOTE = 'The footer can’t be deleted'

const ACTION = 'inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-sm'
const ACTION_ON = `${ACTION} text-ink-700 hover:bg-line`
const ACTION_OFF = `${ACTION} cursor-not-allowed bg-line-subtle text-ink-300`

export function LayersPanel({ nodes, disabled = false, onSelect, onToggleOpen, onToggleVisible, onRename, onDelete, onMove, onHover }: LayersPanelProps) {
  const rows = useMemo(() => flatten(nodes), [nodes])
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>())

  const selectedId = rows.find((row) => row.node.selected)?.node.id ?? null
  // a block picked on the canvas can be far down a long tree, so its row is brought into view
  useEffect(() => {
    if (selectedId) rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // the row that held focus can be deleted or collapsed away, and the tree must keep exactly one tab stop
  const tabStopId = rows.some((row) => row.node.id === focusedId) ? focusedId : (rows[0]?.node.id ?? null)

  const focusRow = (id: string) => {
    setFocusedId(id)
    rowRefs.current.get(id)?.focus()
  }

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: Row) => {
    const { node } = row
    const index = rows.findIndex((item) => item.node.id === node.id)
    const hasChildren = node.children.length > 0

    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const direction = event.key === 'ArrowUp' ? 'up' : 'down'
      if (disabled || (direction === 'up' ? !node.canMoveUp : !node.canMoveDown)) return
      event.preventDefault()
      onMove(node.id, direction)
      return
    }

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault()
        if (index < rows.length - 1) focusRow(rows[index + 1].node.id)
        return
      }
      case 'ArrowUp': {
        event.preventDefault()
        if (index > 0) focusRow(rows[index - 1].node.id)
        return
      }
      case 'ArrowRight': {
        event.preventDefault()
        if (!hasChildren) return
        if (!node.open) onToggleOpen(node.id)
        else if (index < rows.length - 1) focusRow(rows[index + 1].node.id)
        return
      }
      case 'ArrowLeft': {
        event.preventDefault()
        if (hasChildren && node.open) onToggleOpen(node.id)
        else if (row.parentId) focusRow(row.parentId)
        return
      }
      case 'Enter': {
        event.preventDefault()
        onSelect(node.id)
        return
      }
      case 'F2': {
        if (disabled) return
        event.preventDefault()
        setRenamingId(node.id)
        return
      }
      case 'Delete': {
        if (disabled || !node.removable) return
        event.preventDefault()
        onDelete(node.id)
        return
      }
      default:
    }
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col bg-surface py-1">
        <p className="px-3 py-1.5 text-[11px] text-ink-300">{EMPTY_NOTE}</p>
      </div>
    )
  }

  return (
    <div
      role="tree"
      aria-label="Layers"
      className="flex h-full min-h-0 w-full flex-col overflow-y-auto bg-surface py-1"
      onMouseLeave={() => onHover?.(null)}
    >
      {rows.map((row) => {
        const { node, level } = row
        const hasChildren = node.children.length > 0
        const renaming = renamingId === node.id
        const Icon = iconFor(node.kind)

        return (
          <div
            key={node.id}
            ref={(element) => {
              rowRefs.current.set(node.id, element)
            }}
            role="treeitem"
            aria-level={level}
            aria-expanded={hasChildren ? node.open : undefined}
            aria-selected={node.selected}
            tabIndex={node.id === tabStopId ? 0 : -1}
            onKeyDown={(event) => onRowKeyDown(event, row)}
            onFocus={() => setFocusedId(node.id)}
            onMouseEnter={() => onHover?.(node.id)}
            onClick={() => onSelect(node.id)}
            className="outline-none"
          >
            <TreeRow
              level={level}
              icon={Icon}
              selected={node.selected}
              muted={!node.visible}
              expander={
                hasChildren ?
                  <button
                    type="button"
                    aria-label={node.open ? `Collapse ${node.name}` : `Expand ${node.name}`}
                    className="inline-flex h-[22px] w-[14px] shrink-0 items-center justify-center text-ink-700"
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleOpen(node.id)
                    }}
                  >
                    {node.open ?
                      <ChevronDown size={14} strokeWidth={1.5} aria-hidden />
                    : <ChevronRight size={14} strokeWidth={1.5} aria-hidden />}
                  </button>
                : <span className="h-[22px] w-[14px] shrink-0" />
              }
              trailing={
                <>
                  {node.visible ? null : (
                    <span title="Hidden on Canvas" className="ml-[2px] flex shrink-0 text-ink-300">
                      <EyeOff size={13} strokeWidth={1.5} aria-hidden />
                    </span>
                  )}
                  {node.hiddenOnPhones ? (
                    <span title={PHONES_NOTE} aria-label={PHONES_MARKER_LABEL} className="ml-[2px] flex shrink-0 text-ink-700">
                      <Smartphone size={13} strokeWidth={1.5} aria-hidden />
                    </span>
                  ) : null}
                </>
              }
              actions={
                <>
                  <RowAction
                    label={node.visible ? `Hide on Canvas: ${node.name}` : `Show on Canvas: ${node.name}`}
                    disabled={disabled}
                    onActivate={() => onToggleVisible(node.id)}
                  >
                    {node.visible ?
                      <EyeOff size={13} strokeWidth={1.5} aria-hidden />
                    : <Eye size={13} strokeWidth={1.5} aria-hidden />}
                  </RowAction>
                  <RowAction label={`Move Up: ${node.name}`} disabled={disabled || !node.canMoveUp} onActivate={() => onMove(node.id, 'up')}>
                    <ChevronUp size={13} strokeWidth={1.5} aria-hidden />
                  </RowAction>
                  <RowAction label={`Move Down: ${node.name}`} disabled={disabled || !node.canMoveDown} onActivate={() => onMove(node.id, 'down')}>
                    <ChevronDown size={13} strokeWidth={1.5} aria-hidden />
                  </RowAction>
                  {/* the footer keeps its delete, greyed, so the row never changes shape and the reason can be read */}
                  <RowAction
                    label={node.removable ? `Delete: ${node.name}` : FOOTER_NOTE}
                    disabled={disabled || !node.removable}
                    onActivate={() => onDelete(node.id)}
                  >
                    <Trash2 size={13} strokeWidth={1.5} aria-hidden />
                  </RowAction>
                </>
              }
            >
              {renaming ?
                <RenameField
                  name={node.name}
                  onCommit={(value) => {
                    onRename(node.id, value)
                    setRenamingId(null)
                    focusRow(node.id)
                  }}
                  onCancel={() => {
                    setRenamingId(null)
                    focusRow(node.id)
                  }}
                />
              : <span
                  className={`min-w-0 flex-1 truncate text-xs ${
                    !node.visible ? 'text-ink-300' : node.selected ? 'font-semibold text-brand-800' : 'text-ink-900'
                  }`}
                  title={node.visible ? node.name : `${node.name} — ${HIDDEN_NOTE}`}
                >
                  {node.name}
                </span>
              }
            </TreeRow>
          </div>
        )
      })}
      {rows.some((row) => !row.node.visible) && <p className="px-3 py-1.5 text-[11px] text-ink-300">{HIDDEN_NOTE}</p>}
      {rows.some((row) => row.node.hiddenOnPhones) && <p className="px-3 py-1.5 text-[11px] text-ink-700">{PHONES_NOTE}</p>}
    </div>
  )
}

function RowAction({ label, disabled, onActivate, children }: { label: string; disabled: boolean; onActivate: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      // aria-disabled, not disabled: a reader still needs to find the action and hear that it is inert
      aria-disabled={disabled || undefined}
      aria-label={label}
      title={label}
      className={disabled ? ACTION_OFF : ACTION_ON}
      onClick={(event) => {
        event.stopPropagation()
        if (disabled) return
        onActivate()
      }}
    >
      {children}
    </button>
  )
}

function RenameField({ name, onCommit, onCancel }: { name: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name)
  // committing moves focus back to the row, which blurs this input: without the guard it would commit twice
  const finished = useRef(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.select()
  }, [])

  return (
    <input
      ref={input}
      autoFocus
      aria-label={`Rename ${name}`}
      className="h-6 min-w-0 flex-1 rounded-sm border border-brand-600 bg-surface px-1.5 text-xs text-ink-900"
      value={value}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') {
          event.preventDefault()
          finished.current = true
          onCommit(value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finished.current = true
          onCancel()
        }
      }}
      onBlur={() => {
        if (finished.current) return
        finished.current = true
        onCommit(value)
      }}
    />
  )
}
