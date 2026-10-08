/** The node-graph canvas: @xyflow/react driving a fixed vertical chain, custom-styled with this repo's tokens
 * rather than React Flow's default look. Scrolling pans the chain (for one longer than the window); nodes don't drag,
 * drag-to-pan and zoom are off, and nothing new connects by dragging a handle — steps are only ever added through
 * the "+" picker. The chain is centred horizontally at full size, scaled down only when a fork is wider than the pane.
 *
 * Category colours, uppercase category lines and the green ✓ badge are approved design-system exceptions for this
 * canvas only. */
import {
  Background, BaseEdge, getSmoothStepPath, Handle, Position, ReactFlow, type Edge, type EdgeProps, type NodeProps, type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { Check, Copy, CornerDownRight, EllipsisVertical, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { IconButton } from '@/components/Button'
import { MenuRow } from '@/components/MenuRow'
import { Popover } from '@/components/Popover'
import { Tag } from '@/components/StatusBadge'
import { formatNumber } from '@/lib/format'
import type { JourneyStepCounts } from '@/lib/types'
import { useSingleDropdown, type SingleDropdown } from '@/lib/useSingleDropdown'

import type { AddNodeData, CanvasNode, CardTag, EntryNodeData, StepNodeData } from './canvasLayout'
import { layoutCanvas } from './canvasLayout'
import { isNodeConfigured, type EditorNode, type Path } from './graphModel'
import { CATEGORY, categoryLine, describeStep, ENTRY_ICON, hasEmailPreview, NODE_META, type AddableType } from './nodeDefs'

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const }

function Handles({ target = true, source = true }: { target?: boolean; source?: boolean }) {
  return (
    <>
      {target && <Handle type="target" position={Position.Top} isConnectable={false} style={HIDDEN_HANDLE} />}
      {source && <Handle type="source" position={Position.Bottom} isConnectable={false} style={HIDDEN_HANDLE} />}
    </>
  )
}

function CardTagLine({ tag }: { tag: CardTag }) {
  if (tag === 'needs-setup') return <div className="mt-1.5 flex"><Tag tone="warning">Needs Setup</Tag></div>
  return null
}

function CardBody({ icon: Icon, tile, lineClass, line, title, description, end, tag = null }: {
  icon: typeof ENTRY_ICON; tile: string; lineClass: string; line: string; title: string; description: string; end?: ReactNode; tag?: CardTag
}) {
  return (
    <div className="flex items-start gap-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${tile}`} aria-hidden>
        <Icon size={16} strokeWidth={1.5} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-xs font-semibold tracking-wide uppercase ${end ? 'pr-14' : ''} ${lineClass}`}>{line}</p>
        <p className="mt-0.5 truncate text-sm font-semibold text-ink-900" title={title}>{title}</p>
        <p className="mt-0.5 truncate text-helper text-ink-800" title={description}>{description}</p>
        <CardTagLine tag={tag} />
      </div>
      {end && <div className="absolute top-2.5 right-2 flex items-center gap-1">{end}</div>}
    </div>
  )
}

function EntryNode({ data }: NodeProps & { data: EntryNodeData }) {
  const { trigger, detail } = data as EntryNodeData & { trigger?: string; detail?: string }
  const category = CATEGORY.ENTRY
  return (
    <div className="h-full w-full rounded-lg border border-line bg-surface p-4">
      <CardBody icon={ENTRY_ICON} tile={category.tile} lineClass={category.text} line={category.label} title={trigger ?? 'Not set'} description={detail ?? ''} />
      <Handles target={false} />
    </div>
  )
}

/** "3,180 passed · 212 waiting", "Yes 1,284 · No 1,896", "621 reached": a live version's figures on the card. */
export function countsLine(node: EditorNode, counts: JourneyStepCounts): string {
  const parts: string[] = []
  if (node.type === 'CONDITION') parts.push(`Yes ${formatNumber(counts.yes)} · No ${formatNumber(counts.no)}`)
  else if (node.type === 'GOAL') parts.push(`${formatNumber(counts.yes)} reached`)
  else parts.push(`${formatNumber(counts.passed)} passed`)
  if (counts.waiting > 0) parts.push(`${formatNumber(counts.waiting)} waiting`)
  if (counts.held_back > 0) parts.push(`${formatNumber(counts.held_back)} held back`)
  if (counts.failed > 0) parts.push(`${formatNumber(counts.failed)} failed`)
  return parts.join(' · ')
}

interface StepHandlers {
  readOnly?: boolean
  selectedKey?: string | null
  menus?: SingleDropdown<string>
  onSelect?: (path: Path) => void
  onDelete?: (path: Path) => void
  onDuplicate?: (path: Path) => void
}

function StatusBadgeDot({ configured }: { configured: boolean }) {
  return configured ? (
    <span role="img" aria-label="Configured" title="Configured" className="flex h-5 w-5 items-center justify-center rounded-full bg-success-bg text-success-text">
      <Check size={12} strokeWidth={2.5} aria-hidden />
    </span>
  ) : (
    <span role="img" aria-label="Needs Setup" title="Needs setup" className="flex h-5 w-5 items-center justify-center rounded-full bg-warning-bg text-xs font-semibold text-warning-text">
      <span aria-hidden>!</span>
    </span>
  )
}

function StepMenu({ node, path, menus, onDelete, onDuplicate }: { node: EditorNode; path: Path } & StepHandlers) {
  if (!menus) return null
  const open = menus.isOpen(node.key)
  const label = `Actions for ${NODE_META[node.type as AddableType]?.label ?? node.type}`
  // nothing can follow an Exit step, so a second one right after it would never be reached
  const canDuplicate = node.type !== 'EXIT'
  return (
    // the card is a button too: keep clicks and keys inside the menu from also opening the step panel
    <span className="relative inline-flex" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <IconButton {...menus.triggerProps(node.key)} label={label} icon={EllipsisVertical} size="xs" className={open ? 'bg-fill-subtle text-ink-900' : ''} />
      {open && (
        <Popover label={label} width={168} placement="bottom-end" className="text-left" {...menus.panelProps(node.key)}>
          <MenuRow divider={false} title="Duplicate" disabled={!canDuplicate} leading={<Copy size={16} strokeWidth={1.5} aria-hidden className="text-ink-800" />}
            onClick={() => { menus.close(); onDuplicate?.(path) }} />
          <MenuRow divider={false} tone="error" title="Delete Step" leading={<Trash2 size={16} strokeWidth={1.5} aria-hidden className="text-danger-text" />}
            onClick={() => { menus.close({ restoreFocus: false }); onDelete?.(path) }} />
        </Popover>
      )}
    </span>
  )
}

function StepNode({ data }: NodeProps & { data: StepNodeData }) {
  const { node, path, tag, selectedKey, onSelect, readOnly, counts } = data as StepNodeData & StepHandlers & { counts?: JourneyStepCounts }
  const meta = NODE_META[node.type as AddableType]
  const category = CATEGORY[meta?.category ?? 'CONTROL']
  const configured = isNodeConfigured(node)
  const selected = !readOnly && selectedKey === node.key
  const { title, description: words } = describeStep(node)
  const description = counts ? countsLine(node, counts) : words
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect?.(path)
    }
  }
  const interactive = readOnly ? { role: 'group' } : {
    role: 'button',
    tabIndex: 0,
    'aria-current': selected || undefined,
    onClick: () => onSelect?.(path),
    onKeyDown,
    style: { pointerEvents: 'auto' as const },
  }
  return (
    <div
      {...interactive}
      aria-label={`${meta?.label ?? node.type} step`}
      className={`relative h-full w-full rounded-lg border bg-surface p-4 text-left transition-colors duration-base ease-standard ${
        readOnly ? 'border-line' : `cursor-pointer ${selected ? 'border-link ring-4 ring-brand-100' : 'border-line hover:border-link'}`}`}
    >
      <CardBody
        icon={meta?.icon ?? ENTRY_ICON}
        tile={category.tile}
        lineClass={category.text}
        line={meta ? categoryLine(node.type as AddableType) : node.type}
        title={title}
        description={description}
        tag={tag}
        end={
          <>
            <StatusBadgeDot configured={configured} />
            {!readOnly && <StepMenu node={node} path={path} {...(data as StepHandlers)} />}
          </>
        }
      />
      {hasEmailPreview(node) && (
        <div className="mt-3 flex h-[58px] items-center justify-center rounded-md border border-line bg-channel-email-tint px-3" data-testid="email-preview">
          <span className="truncate text-xs font-medium text-link">{String(node.config.template_name ?? 'Template')}</span>
        </div>
      )}
      <Handles />
    </div>
  )
}

function AddNode({ data }: NodeProps & { data: AddNodeData }) {
  const { onAdd } = data as AddNodeData & { onAdd?: (path: Path, index: number, insideBranch: boolean) => void }
  return (
    <>
      <button
        type="button"
        aria-label="Add a Step"
        title="Add a step"
        onClick={() => onAdd?.(data.path, data.index, data.insideBranch)}
        style={{ pointerEvents: 'auto' }}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-line-control bg-surface text-ink-800 transition-colors duration-fast ease-standard hover:border-solid hover:border-brand-600 hover:bg-brand-600 hover:text-on-brand"
      >
        <Plus size={14} strokeWidth={2} aria-hidden />
      </button>
      <Handles />
    </>
  )
}

function EndNode() {
  return (
    <div className="flex h-full w-full items-center justify-center gap-1.5 text-helper text-ink-800">
      <CornerDownRight size={14} strokeWidth={1.5} aria-hidden />
      Contact exits
      <Handles source={false} />
    </div>
  )
}

function JourneyEdge({ sourceX, sourceY, targetX, targetY, label, data }: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, borderRadius: 8 })
  const dashed = Boolean((data as { dashed?: boolean } | undefined)?.dashed)
  return (
    <>
      <BaseEdge path={path} style={{ stroke: 'var(--color-line)', strokeWidth: 1, ...(dashed ? { strokeDasharray: '4 4' } : {}) }} />
      {label && (
        // the fork's YES / NO tag, on the branch's own vertical just above its first "+"
        <foreignObject x={targetX - 32} y={targetY - 28} width={64} height={20} className="overflow-visible">
          <span className="flex h-5 items-center justify-center rounded-sm bg-surface px-1.5 text-xs font-medium whitespace-nowrap text-ink-800 ring-1 ring-line">{String(label)}</span>
        </foreignObject>
      )}
    </>
  )
}

const nodeTypes = { entry: EntryNode, step: StepNode, add: AddNode, end: EndNode }
const edgeTypes = { journey: JourneyEdge }

/** top margin above the Entry card, and the space kept either side of the widest fork */
const TOP = 32
const SIDE = 24

export function JourneyCanvas({
  root,
  entryTrigger,
  entryDetail,
  selectedKey,
  onSelect,
  onDelete,
  onDuplicate,
  onAdd,
  counts,
}: {
  root: EditorNode[]
  entryTrigger: string
  entryDetail: string
  /** a live version's per-step figures, shown on the cards instead of their description */
  counts?: Record<string, JourneyStepCounts>
  selectedKey: string | null
  onSelect: (path: Path) => void
  onDelete: (path: Path) => void
  onDuplicate: (path: Path) => void
  onAdd: (path: Path, index: number, insideBranch: boolean) => void
}) {
  const menus = useSingleDropdown<string>()
  const { nodes, edges, width } = layoutCanvas(root)
  const withHandlers: CanvasNode[] = nodes.map((node) =>
    node.type === 'step' ? { ...node, zIndex: menus.open === node.id ? 10 : undefined, data: { ...node.data, selectedKey, menus, onSelect, onDelete, onDuplicate, counts: counts?.[node.id] } }
    : node.type === 'add' ? { ...node, data: { ...node.data, onAdd } }
    : node.type === 'entry' ? { ...node, data: { trigger: entryTrigger, detail: entryDetail } }
    : node,
  )

  const container = useRef<HTMLDivElement>(null)
  const flow = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null)
  const placed = useRef(false)
  // centre the chain at full size; a fork wider than the pane scales down to fit, never below half size
  const place = useCallback(() => {
    const element = container.current
    const instance = flow.current
    if (!element || !instance || element.clientWidth === 0) return
    const paneWidth = element.clientWidth
    const zoom = Math.min(1, Math.max(0.5, (paneWidth - SIDE * 2) / width))
    const y = placed.current ? instance.getViewport().y : TOP
    void instance.setViewport({ x: paneWidth / 2, y, zoom })
    placed.current = true
  }, [width])

  useEffect(() => {
    place()
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => place())
    observer.observe(element)
    return () => observer.disconnect()
  }, [place])

  return (
    <div ref={container} className="h-full w-full bg-surface-subtle" data-testid="journey-canvas">
      <ReactFlow
        nodes={withHandlers}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnScroll
        minZoom={0.5}
        maxZoom={1}
        defaultViewport={{ x: 0, y: TOP, zoom: 1 }}
        onInit={(instance) => {
          flow.current = instance
          place()
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="var(--color-line)" gap={24} size={1} />
      </ReactFlow>
    </div>
  )
}

/** gap above the Entry card and below the last marker in the read-only preview */
const PREVIEW_PAD = 24

/** A template's flow, read-only: the canvas's own cards and connectors (YES / NO forks included) with no "+" points,
 * no ⋮ menus and nothing to select. It is drawn at its full height inside a scrolling box, narrowed to fit the box's
 * width, so it scrolls like a page. */
export function JourneyFlowPreview({ root, entryTrigger, entryDetail, tagFor }: {
  root: EditorNode[]
  entryTrigger: string
  entryDetail: string
  tagFor: (node: EditorNode) => CardTag
}) {
  const { nodes, edges, width, height } = layoutCanvas(root, { readOnly: true, tagFor })
  const shown: CanvasNode[] = nodes.map((node) =>
    node.type === 'step' ? { ...node, data: { ...node.data, readOnly: true } }
    : node.type === 'entry' ? { ...node, data: { trigger: entryTrigger, detail: entryDetail } }
    : node,
  )
  const box = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setBoxWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const zoom = boxWidth === 0 ? 1 : Math.min(1, Math.max(0.5, (boxWidth - SIDE * 2) / width))
  const flowHeight = Math.ceil((height + PREVIEW_PAD * 2) * zoom)
  const flow = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null)
  useEffect(() => {
    if (boxWidth > 0) void flow.current?.setViewport({ x: boxWidth / 2, y: PREVIEW_PAD * zoom, zoom })
  }, [boxWidth, zoom])

  return (
    <div ref={box} className="h-full w-full overflow-y-auto bg-surface-subtle" data-testid="journey-flow-preview">
      <div style={{ height: flowHeight }}>
        <ReactFlow
          nodes={shown}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          panOnDrag={false}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={false}
          zoomOnDoubleClick={false}
          preventScrolling={false}
          minZoom={0.5}
          maxZoom={1}
          defaultViewport={{ x: 0, y: PREVIEW_PAD, zoom: 1 }}
          onInit={(instance) => {
            flow.current = instance
            if (box.current) void instance.setViewport({ x: box.current.clientWidth / 2, y: PREVIEW_PAD * zoom, zoom })
          }}
          proOptions={{ hideAttribution: true }}
        />
      </div>
    </div>
  )
}
