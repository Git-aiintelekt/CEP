/** The "Add a step" picker: grouped Logic / Communication / Existing Business Action / Control, each row with its
 * category's icon tile. Condition is disabled when the insertion point is already inside a branch — journeys don't
 * support nesting one Condition inside another's YES/NO branch. */
import { Tooltip } from '@/components/Tooltip'

import { CATEGORY, NODE_GROUPS, NODE_META, type AddableType } from './nodeDefs'
import { SidePanel } from './SidePanel'

const NESTING_NOTE = "A Condition or Split can't be added inside another step's branch. Keep branching steps on the main journey, before or after this fork."

export function AddStepPanel({ insideBranch, onClose, onPick }: { insideBranch: boolean; onClose: () => void; onPick: (type: AddableType) => void }) {
  return (
    <SidePanel title="Add a step" subtitle="Choose what happens next" onClose={onClose}>
      <div className="space-y-5">
        {NODE_GROUPS.map((group, groupIndex) => {
          const category = CATEGORY[group.key]
          return (
            <section key={group.key} aria-label={category.label}>
              <h3 className={`text-xs font-semibold tracking-wide uppercase ${category.text}`}>{category.label}</h3>
              <div className="mt-2 space-y-1">
                {group.types.map((type, index) => {
                  const disabled = insideBranch && (type === 'CONDITION' || type === 'SPLIT')
                  const meta = NODE_META[type]
                  const button = (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onPick(type)}
                      aria-label={meta.pickerTitle}
                      data-autofocus={groupIndex === 0 && index === 0 ? true : undefined}
                      className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors duration-fast ease-standard ${disabled ? 'cursor-not-allowed' : 'hover:bg-callout-bg'}`}
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${disabled ? 'bg-fill-subtle text-ink-300' : category.tile}`} aria-hidden>
                        <meta.icon size={16} strokeWidth={1.5} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-semibold ${disabled ? 'text-ink-300' : 'text-ink-900'}`}>{meta.pickerTitle}</span>
                        <span className={`mt-0.5 block text-helper ${disabled ? 'text-ink-300' : 'text-ink-800'}`}>{meta.pickerDescription}</span>
                      </span>
                    </button>
                  )
                  return disabled ? (
                    <Tooltip key={type} content={NESTING_NOTE} className="block w-full">
                      {button}
                    </Tooltip>
                  ) : (
                    <div key={type}>{button}</div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </SidePanel>
  )
}
