/** Orchestrates the Build page once the journey, its draft version and its graph are loaded: holds the editor
 * tree, the docked Add-a-step and step panels, and the save flow (including the 409 "someone else saved this"
 * conflict). */
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { IconButton } from '@/components/Button'
import { buttonSecondary } from '@/components/Form'
import { Notice } from '@/components/Notice'
import { Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'
import type { Journey, JourneyEntryRule, JourneyNodeType, JourneyVersionDetail } from '@/lib/types'

import { AddStepPanel } from './AddStepPanel'
import { Footer, ReadinessPill } from './Footer'
import {
  conditionStepOptions,
  checkValidity, cloneWithNewKeys, flatten, fromWireGraph, insertAt, isNodeConfigured, newKey, removeAt, updateAt, type EditorNode, type Path,
} from './graphModel'
import { JourneyCanvas } from './JourneyCanvas'
import { JourneySetupModal, type SetupValues } from './JourneySetupModal'
import { describeStep, type AddableType } from './nodeDefs'
import { NodeConfigPanel } from './NodeConfigPanel'
import { entrySummary, populationLabel, reentryLabel, SettingsSidebar } from './SettingsSidebar'
import { StageBar } from './StageBar'
import { goalContinues } from './GoalFields'
import { stepName } from './templates/templateMeta'

interface AddRequest {
  path: Path
  index: number
  insideBranch: boolean
}

export interface SavePayload {
  row_version: number
  entryRules: JourneyEntryRule[]
  root: EditorNode[]
}

/** Edit Setup's save (JourneyBuildPage): the chosen setup, plus the canvas as it is now so no step edit is lost. */
export interface SetupSavePayload {
  values: SetupValues
  version: JourneyVersionDetail
  root: EditorNode[]
  /** the canvas has changes Save Draft hasn't sent yet */
  dirty: boolean
}

function nodeAt(root: EditorNode[], path: Path): EditorNode | null {
  let chain = root
  for (let i = 0; i < path.length; i += 1) {
    const step = path[i]
    const node = chain[step.index] ?? null
    if (!node) return null
    if (i === path.length - 1) return node
    chain = step.branch ? node.branches?.[step.branch] ?? [] : chain
  }
  return null
}

const BANNER_KEY = 'cep.journeyTemplateBanner.dismissed.'

function bannerDismissed(journeyId: string): boolean {
  try {
    return window.sessionStorage.getItem(BANNER_KEY + journeyId) === '1'
  } catch {
    return false
  }
}

/** A journey made from a template, with steps still waiting for content: which ones, until each is set up. */
function TemplateSetupBanner({ sourceName, steps, onDismiss }: { sourceName: string; steps: EditorNode[]; onDismiss: () => void }) {
  const count = steps.length
  return (
    <div className="shrink-0 px-4 pt-3">
      <Notice tone="info" layout="banner" action={<IconButton label="Dismiss" icon={X} onClick={onDismiss} />}>
        <p>
          <strong className="font-semibold">Created from {sourceName}.</strong>{' '}
          {count} {count === 1 ? 'step needs' : 'steps need'} your content before you can test publish: {steps.map(stepName).join(', ')}. Select a step to set it up.
        </p>
      </Notice>
    </div>
  )
}

export function JourneyBuildWorkspace({
  journey,
  version,
  onSave,
  onSaveSetup,
  saving,
}: {
  journey: Journey
  version: JourneyVersionDetail
  /** resolves with the version saved onto (a new draft when this one is published) */
  onSave: (payload: SavePayload) => Promise<JourneyVersionDetail>
  /** resolves with the version the setup was saved onto (a new draft when this one is published) */
  onSaveSetup: (payload: SetupSavePayload) => Promise<JourneyVersionDetail>
  saving: boolean
}) {
  const [root, setRoot] = useState<EditorNode[]>(() => fromWireGraph(version.graph))
  const [addRequest, setAddRequest] = useState<AddRequest | null>(null)
  const [selected, setSelected] = useState<Path | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)
  const [bannerHidden, setBannerHidden] = useState(() => bannerDismissed(journey.id))
  const toast = useToast()

  const savedRoot = useMemo(() => JSON.stringify(fromWireGraph(version.graph)), [version.graph])
  const dirty = JSON.stringify(root) !== savedRoot
  const validity = checkValidity(root)
  const entryRules = version.graph.entry_rules
  const needContent = flatten(root).filter((node) => !isNodeConfigured(node))
  const showBanner = Boolean(journey.source_name) && needContent.length > 0 && !bannerHidden

  const dismissBanner = () => {
    setBannerHidden(true)
    try {
      window.sessionStorage.setItem(BANNER_KEY + journey.id, '1')
    } catch {
      // it just comes back next time
    }
  }

  const openAdd = (path: Path, index: number, insideBranch: boolean) => {
    setSelected(null)
    setAddRequest({ path, index, insideBranch })
  }

  const openStep = (path: Path) => {
    setAddRequest(null)
    setSelected(path)
  }

  const handleAdd = (type: AddableType) => {
    if (!addRequest) return
    const node: EditorNode = { key: newKey(type), type, config: {}, ...(type === 'CONDITION' ? { branches: { YES: [], NO: [] } } : {}) }
    setRoot((current) => insertAt(current, addRequest.path, addRequest.index, node))
    setAddRequest(null)
    setSelected([...addRequest.path, { index: addRequest.index }])
  }

  const handleConfigSave = ({ type, config }: { type: JourneyNodeType; config: Record<string, unknown> }) => {
    if (!selected) return
    // a Goal set to continue opens its Reached / Not Yet paths; set back to exit, it closes them (the panel refuses while they hold steps)
    const node = nodeAt(root, selected)
    const branches = type === 'GOAL' && goalContinues(config) ? node?.branches ?? { YES: [], NO: [] } : type === 'GOAL' ? undefined : node?.branches
    setRoot((current) => updateAt(current, selected, branches ? { type, config, branches } : { type, config, branches: undefined }))
    setSelected(null)
  }

  const handleDelete = (path: Path) => {
    setRoot((current) => removeAt(current, path))
    setSelected(null)
  }

  const handleDuplicate = (path: Path) => {
    const node = nodeAt(root, path)
    if (!node) return
    const { index } = path[path.length - 1]
    setRoot((current) => insertAt(current, path.slice(0, -1), index + 1, cloneWithNewKeys(node)))
    setSelected(null)
  }

  const handleSaveDraft = async () => {
    try {
      const saved = await onSave({ row_version: version.row_version, entryRules, root })
      toast.success(saved.version_number === version.version_number ? 'Draft saved' : `Saved as version ${saved.version_number}`,
                    saved.version_number === version.version_number ? undefined : `Version ${version.version_number} keeps running until you test publish and approve this one.`)
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        toast.error('Someone else saved this journey', error.message, { durationMs: 0 })
      } else {
        toast.failure(error, 'The draft was not saved')
      }
    }
  }

  const handleSaveSetup = async (values: SetupValues) => {
    const saved = await onSaveSetup({ values, version, root, dirty })
    // nothing unsaved here: show the graph exactly as stored, in case someone else's steps came with it
    if (!dirty && saved.version_number === version.version_number) setRoot(fromWireGraph(saved.graph))
    setSetupOpen(false)
    toast.success(saved.version_number === version.version_number ? 'Setup saved' : `Setup saved as draft version ${saved.version_number}`)
  }

  const selectedNode = selected ? nodeAt(root, selected) : null

  return (
    <div className="flex h-screen flex-col bg-surface">
      <StageBar
        journeyName={journey.name}
        stage="build"
        actions={
          <>
            <ReadinessPill validity={validity} />
            <button type="button" onClick={() => void handleSaveDraft()} disabled={saving} className={buttonSecondary}>
              {saving ? <Spinner size="sm" /> : null} Save Draft
            </button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        <SettingsSidebar journey={journey} entryRules={entryRules} onEditSetup={() => setSetupOpen(true)} />
        <main className="flex min-w-0 flex-1 flex-col">
          {version.status !== 'DRAFT' && (
            <div className="shrink-0 px-4 pt-3">
              <Notice tone="info" layout="banner">
                <p>
                  <strong className="font-semibold">Version {version.version_number} is {version.status === 'ACTIVE' ? 'live' : 'published'}.</strong>{' '}
                  Saving makes your changes a new version; this one keeps running until you test publish and approve it.
                </p>
              </Notice>
            </div>
          )}
          {showBanner && <TemplateSetupBanner sourceName={journey.source_name ?? ''} steps={needContent} onDismiss={dismissBanner} />}
          <div className="min-h-0 flex-1">
            <JourneyCanvas
              root={root}
              entryTrigger={entryRules.length === 0 ? 'Not set' : entryRules.map(entrySummary).join('; ')}
              entryDetail={`${populationLabel(journey)} · Re-entry: ${reentryLabel(journey)}`}
              selectedKey={selectedNode?.key ?? null}
              onSelect={openStep}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onAdd={openAdd}
            />
          </div>
        </main>
        {addRequest && <AddStepPanel insideBranch={addRequest.insideBranch} onClose={() => setAddRequest(null)} onPick={handleAdd} />}
        {selectedNode && (
          <NodeConfigPanel key={selectedNode.key} node={selectedNode} onClose={() => setSelected(null)} onSave={handleConfigSave} onDelete={() => selected && handleDelete(selected)}
            steps={conditionStepOptions(root, selectedNode.key, (node) => describeStep(node).title)} journeyId={journey.id}
            insideBranch={Boolean(selected?.some((step) => step.branch))} />
        )}
      </div>
      <Footer journeyId={journey.id} validity={validity} onBackToSetup={() => setSetupOpen(true)} />

      {setupOpen && (
        <JourneySetupModal
          onClose={() => setSetupOpen(false)}
          edit={{ journey, rule: entryRules[0], published: version.status !== 'DRAFT', onSave: handleSaveSetup }}
        />
      )}
    </div>
  )
}
