/** The banner's four "New …" cards: one per channel the workspace can use. */
import { ArrowRight } from 'lucide-react'

import { CHANNEL_LOOK, type TemplateChannel } from './channels'

const DESCRIPTION: Record<TemplateChannel, string> = {
  EMAIL: 'Drag-and-drop email design',
  SMS: 'Short text, 160 characters',
  // the mockup says "or video": MMS takes JPEG, PNG and GIF only
  MMS: 'Text with image',
  E_RECEIPT: 'Transactional receipt layout',
}

export function QuickCreateCards({ channels, onPick }: { channels: TemplateChannel[]; onPick: (channel: TemplateChannel) => void }) {
  return (
    // auto-fit so 3 cards (e.g. e-receipt off) stretch to fill the row instead of leaving an empty 4th slot
    <div className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
      {channels.map((channel) => {
        const look = CHANNEL_LOOK[channel]
        const Icon = look.icon
        return (
          <button
            key={channel}
            type="button"
            onClick={() => onPick(channel)}
            className="group flex flex-col overflow-hidden rounded-lg bg-surface text-left transition-colors duration-fast ease-standard hover:bg-surface-subtle active:bg-fill-subtle"
          >
            <span aria-hidden className={`flex h-[88px] w-full items-center justify-center ${look.tint}`}>
              <span className={`flex h-14 w-14 items-center justify-center rounded-full ${look.halo} ${look.iconColor}`}>
                <Icon size={28} strokeWidth={1.5} />
              </span>
            </span>
            <span className="flex flex-col gap-1 px-4 pt-3.5 pb-4">
              <span className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold text-ink-900">New {look.label}</span>
                <span
                  aria-hidden
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-ink-800 transition-colors duration-fast ease-standard group-hover:border-brand-600 group-hover:bg-brand-600 group-hover:text-white group-active:border-brand-800 group-active:bg-brand-800"
                >
                  <ArrowRight size={14} strokeWidth={1.5} />
                </span>
              </span>
              <span className="text-helper text-ink-800">{DESCRIPTION[channel]}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
