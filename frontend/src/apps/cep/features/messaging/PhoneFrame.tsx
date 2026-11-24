/** The phone the message editor and the template preview draw texts in: device outline, sender header, bubbles. */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** A received text: grey, squared off at the bottom left where it points to the sender. */
export const BUBBLE = 'max-w-[85%] rounded-lg rounded-bl-md bg-fill-subtle px-3.5 py-2 text-sm leading-5 break-words whitespace-pre-wrap text-ink-900'

/** The device outline alone: a width, a rounded dark rim and whatever is inside. Always light: it shows what the customer gets. */
export function DeviceFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div data-theme="light" className={`mx-auto rounded-[2rem] border-4 border-ink-900 bg-surface ${className}`}>{children}</div>
}

interface PhoneFrameProps {
  /** the sender's name; null when the workspace has no sender for the channel, undefined while it is not known */
  sender: string | null | undefined
  channel?: 'SMS' | 'MMS'
  /** with no sender: a link to add one in Settings → Delivery (in a new tab, so the open editor keeps its work) */
  addSender?: boolean
  children: ReactNode
}

export function PhoneFrame({ sender, channel = 'SMS', addSender = false, children }: PhoneFrameProps) {
  return (
    <DeviceFrame className="w-full max-w-[320px] p-3">
      <div className="mb-3 border-b border-line pb-2 text-center">
        {sender ? <p className="text-sm font-semibold text-ink-900">{sender}</p>
          : sender === null ? <p data-no-sender className="text-sm font-semibold text-ink-800">No {channel} Sender</p>
          : <p aria-hidden className="text-sm">&nbsp;</p>}
        <p className="text-xs text-ink-800">Text Message</p>
        {sender === null && addSender && (
          <Link to="/settings/delivery?add=sender&channel=SMS" target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-800 hover:underline">Add a Sender</Link>
        )}
      </div>
      <div className="min-h-[300px] space-y-1.5 px-1 pb-3">{children}</div>
    </DeviceFrame>
  )
}
