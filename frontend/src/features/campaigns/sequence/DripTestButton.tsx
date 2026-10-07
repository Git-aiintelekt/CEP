import { useQuery } from '@tanstack/react-query'
import { SendHorizontal } from 'lucide-react'
import { useState } from 'react'

import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/Button'
import { Modal } from '@/components/Modal'
import { api } from '@/lib/api'
import type { CampaignFormOptions } from '@/lib/types'

import { TestPublishBox } from '../TestPublishBox'
import type { DesignerDripMode } from './dripEditor'

/** Send Test in drip mode: this message only, through the editor's test-recipient form */
export function DripTestButton({ drip, dirty }: { drip: DesignerDripMode; dirty: boolean }) {
  const { me } = useAuth()
  const [open, setOpen] = useState(false)
  const options = useQuery({
    queryKey: ['campaigns', 'form-options'],
    queryFn: ({ signal }) => api.get<CampaignFormOptions>('/campaigns/form-options/', undefined, signal),
    staleTime: 5 * 60_000,
    enabled: open,
  })
  const label = `Test ${drip.step.position} of ${drip.total}`
  return (
    <>
      <Button size="sm" variant="secondary" iconStart={SendHorizontal} onClick={() => setOpen(true)}>Send Test</Button>
      {open && (
        <Modal title="Send a Test" subtitle={`${drip.title} · ${label}`} size="picker" onClose={() => setOpen(false)}>
          <TestPublishBox campaign={drip.campaign} people={options.data?.owners ?? []} defaultTo={me?.principal.email ?? ''}
            url={`/campaigns/${drip.campaign.id}/steps/${drip.step.id}/test/`}
            intro={`Sends this message's test, labelled ${label}.${dirty ? ' Unsaved changes are not in it: save first.' : ''} Tests never count towards the results.`} />
        </Modal>
      )}
    </>
  )
}
