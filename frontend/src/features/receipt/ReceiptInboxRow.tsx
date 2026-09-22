/** A receipt as an inbox lists it. The subject and preheader are generated, so there are no tags to mark up. */
interface ReceiptInboxRowProps {
  senderName: string
  senderAddress: string
  time: string
  subject: string
  preheader: string
}

export function ReceiptInboxRow({ senderName, senderAddress, time, subject, preheader }: ReceiptInboxRowProps) {
  return (
    <div aria-label="Inbox row" role="group" className="flex gap-3 rounded-lg border border-line bg-surface px-4 py-3">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-line text-sm font-semibold text-ink-700">
        {senderName.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-sm">
            <span className="font-semibold text-ink-900">{senderName}</span>
            <span className="ml-1.5 text-xs text-ink-500">{senderAddress}</span>
          </span>
          <span className="cep-num shrink-0 text-xs text-ink-500">{time}</span>
        </div>
        <p data-testid="inbox-subject" className="truncate text-sm font-semibold text-ink-900">
          {subject}
        </p>
        <p data-testid="inbox-preheader" className="truncate text-xs text-ink-500">
          {preheader}
        </p>
      </div>
    </div>
  )
}
