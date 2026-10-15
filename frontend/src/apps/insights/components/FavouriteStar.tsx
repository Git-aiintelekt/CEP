/** The star on a report or a dashboard: pressed when it is one of this person's favourites. Toggles through the API and refreshes the lists. */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Star } from 'lucide-react'

import { useToast } from '@/components/Toast'
import { libraryApi } from '../api'

export function FavouriteStar({ kind, id, name, on }: { kind: 'report' | 'dashboard'; id: string; name: string; on: boolean }) {
  const client = useQueryClient()
  const toast = useToast()
  const toggle = useMutation({
    mutationFn: () => (on ? libraryApi.unfavourite(kind, id) : libraryApi.favourite(kind, id)),
    onSuccess: () => client.invalidateQueries({ queryKey: ['insights', kind === 'report' ? 'reports' : 'dashboards'] }),
    onError: (error) => toast.failure(error, on ? 'The star did not come off' : 'The star did not go on'),
  })
  return (
    <button type="button" aria-pressed={on} aria-label={on ? `Remove ${name} from favourites` : `Add ${name} to favourites`} onClick={() => toggle.mutate()} disabled={toggle.isPending}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-control-sm transition-colors hover:bg-surface-hover ${on ? 'text-warning-text' : 'text-ink-300 hover:text-ink-700'}`}>
      <Star size={16} strokeWidth={1.5} aria-hidden fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}
