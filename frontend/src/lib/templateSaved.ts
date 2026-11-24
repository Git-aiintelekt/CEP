/**
 * A template saved in one tab tells the app's other tabs, so a campaign open beside the designer shows the new version without a
 * reload (the designer opens in its own tab from a campaign's Content). BroadcastChannel reaches the tabs of the same address only;
 * where it is missing, nothing is sent and the campaign shows the change at its next load.
 */
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

const CHANNEL = 'cep-template-saved'

export function announceTemplateSaved(templateId: string): void {
  try {
    const channel = new BroadcastChannel(CHANNEL)
    channel.postMessage({ templateId })
    channel.close()
  } catch {
    // no BroadcastChannel: the other tab refreshes at its next load
  }
}

/** In the app shell: when another tab saves a template, the previews built from it are fetched again. */
export function useTemplateSavedRefresh(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<{ templateId?: string }>) => {
      const id = event.data?.templateId
      void queryClient.invalidateQueries({ queryKey: ['campaigns', 'preview'] })
      if (id) {
        void queryClient.invalidateQueries({ queryKey: ['template-preview', 'template', id] })
        void queryClient.invalidateQueries({ queryKey: ['templates', 'detail', id] })
      }
    }
    return () => channel.close()
  }, [queryClient])
}
