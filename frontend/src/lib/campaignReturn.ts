/**
 * A template editor opened from a campaign's Content, in its own tab (?campaign={id}&return={path}): Back to Campaign and Save &
 * Return to Campaign go back to that path. Every editor (Designer, E-Receipt, Message for SMS and MMS, WhatsApp) uses these two.
 */
import { useSearchParams } from 'react-router-dom'

/** only a campaign's own page inside the app is followed, never an address outside it */
const CAMPAIGN_PATH = /^\/campaigns\/[\w-]+(\/[\w-]*)?(\?[\w=&-]*)?$/

export function useCampaignReturn(): string | undefined {
  const [params] = useSearchParams()
  const asked = params.get('return') ?? ''
  return params.get('campaign') && CAMPAIGN_PATH.test(asked) ? asked : undefined
}

/**
 * After Save & Return: this tab closes so the campaign's tab is in front again (its preview has refreshed from the save). A browser
 * that will not let a page close its own tab keeps it open: then the campaign opens here.
 */
export function leaveForCampaign(path: string, openHere: (path: string) => void): void {
  window.close()
  window.setTimeout(() => {
    if (!window.closed) openHere(path)
  }, 250)
}
