/** The one control a social block has that is not a setting: a list of networks, choosing one adds an icon. */
import { useId } from 'react'

import { SOCIAL_NETWORKS } from '../social'
import { controlClass } from './controls'

export const ADD_NETWORK_LABEL = 'Add a network'
export const ADD_NETWORK_PROMPT = 'Choose a network…'
export const SOCIAL_ICONS_NOTE = 'Select an icon on the canvas to set its link, label or network; its toolbar deletes it.'

export function SocialNetworksField({ disabled = false, onAdd }: { disabled?: boolean; onAdd: (network: string) => void }) {
  const id = useId()
  return (
    <div className="py-2">
      <label htmlFor={id} className="text-xs text-ink-500">
        {ADD_NETWORK_LABEL}
      </label>
      <div className="mt-1">
        {/* always back on the prompt: it is an action, not a value the block holds */}
        <select
          id={id}
          value=""
          disabled={disabled}
          onChange={(event) => {
            if (event.target.value !== '') onAdd(event.target.value)
          }}
          className={controlClass(false, disabled)}
        >
          <option value="">{ADD_NETWORK_PROMPT}</option>
          {SOCIAL_NETWORKS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <p className="mt-1 text-xs text-ink-500">{SOCIAL_ICONS_NOTE}</p>
    </div>
  )
}
