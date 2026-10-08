/** The phone the message editor and the template preview draw texts in: device outline, sender header, bubbles. */
import type { ReactNode } from 'react'

/** A received text: grey, squared off at the bottom left where it points to the sender. */
export const BUBBLE = 'max-w-[85%] rounded-lg rounded-bl-md bg-fill-subtle px-3.5 py-2 text-sm leading-5 break-words whitespace-pre-wrap text-ink-900'

/** The device outline alone: a width, a rounded dark rim and whatever is inside. Always light: it shows what the customer gets. */
export function DeviceFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div data-theme="light" className={`mx-auto rounded-[2rem] border-4 border-ink-900 bg-surface ${className}`}>{children}</div>
}

export function PhoneFrame({ sender, children }: { sender: string; children: ReactNode }) {
  return (
    <DeviceFrame className="w-full max-w-[320px] p-3">
      <div className="mb-3 border-b border-line pb-2 text-center">
        <p className="text-sm font-semibold text-ink-900">{sender}</p>
        <p className="text-xs text-ink-800">Text Message</p>
      </div>
      <div className="min-h-[300px] space-y-1.5 px-1 pb-3">{children}</div>
    </DeviceFrame>
  )
}
