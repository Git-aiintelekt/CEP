/** The dialog SessionIdleGuard shows once the workspace has been idle for a while. Dismissing it any way (Escape, the scrim, the buttons) counts as "still here" except signing out on purpose. */
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { ProgressBar } from '@/components/ProgressBar'

function plural(seconds: number): string {
  return `${seconds} second${seconds === 1 ? '' : 's'}`
}

export function IdleWarningModal({ secondsLeft, totalSeconds, onStay, onSignOut }: { secondsLeft: number; totalSeconds: number; onStay: () => void; onSignOut: () => void }) {
  return (
    <Modal title="Still there?" subtitle="Nothing has happened in this tab for a while." onClose={onStay}
      footer={
        <>
          <Button variant="secondary" onClick={onSignOut}>Sign Out Now</Button>
          <Button variant="primary" onClick={onStay} autoFocus>Stay Signed In</Button>
        </>
      }>
      <p aria-live="polite" className="text-sm text-ink-800">
        For your security, C360 signs itself out after time spent idle. Without a response you will be signed out in <span className="font-semibold text-ink-900">{plural(secondsLeft)}</span>.
      </p>
      <div className="mt-3">
        <ProgressBar value={(secondsLeft / Math.max(1, totalSeconds)) * 100} label="Time left before sign-out" />
      </div>
    </Modal>
  )
}
