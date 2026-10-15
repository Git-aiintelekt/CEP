/**
 * Development only (/dev/toasts, not registered in production builds): fires every toast variant with the
 * copy from the toast concepts, so the look can be checked with no backend.
 */
import { Button } from '@/components/Button'
import { useToast } from '@/components/Toast'
import { ApiError } from '@/lib/api'

export default function ToastPlayground() {
  const toast = useToast()

  const variants = [
    {
      name: 'Undo Action',
      fire: () => toast.success('Template archived', undefined, { action: { label: 'Undo', onClick: () => toast.success('Template restored') } }),
    },
    { name: 'Confirmation', fire: () => toast.success('Campaign list saved') },
    { name: 'Running', fire: () => toast.running('Campaign run started', '12,400 recipients · Email', { durationMs: 6000 }) },
    { name: 'Error', fire: () => toast.error('Production publish failed', 'Consent check missing for 3 segments') },
    {
      name: 'Error With Reference',
      fire: () => toast.failure(new ApiError(500, { detail: 'The server could not finish the request.', reference: 'ER-4F2A' } as ConstructorParameters<typeof ApiError>[1]), 'The template was not saved'),
    },
  ]

  return (
    <main className="min-h-screen bg-canvas p-8">
      <h1 className="text-card-heading font-semibold text-ink-900">Toasts</h1>
      <p className="mt-1 text-sm text-ink-800">Each button fires one variant. Toasts appear at the top right.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        {variants.map((variant) => (
          <Button key={variant.name} onClick={variant.fire}>
            {variant.name}
          </Button>
        ))}
        <Button
          onClick={() => {
            for (const variant of variants.slice(0, 4)) variant.fire()
          }}
        >
          Fire All
        </Button>
      </div>
    </main>
  )
}
