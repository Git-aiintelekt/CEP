/**
 * Outer design: the drag-and-drop canvas around a receipt, with its locked receipt slot. Presentational only —
 * saving and versions belong to the receipt workspace. Receipt layout is opened from the slot's own panel.
 */
import { forwardRef, type ComponentProps } from 'react'

import { EmailDesigner, type EmailDesignerHandle } from '@/features/designer/EmailDesigner'

type OuterDesignPaneProps = Omit<ComponentProps<typeof EmailDesigner>, 'channel' | 'ref' | 'onOpenReceiptLayout'> & {
  onOpenReceiptLayout: () => void
}

export const OuterDesignPane = forwardRef<EmailDesignerHandle, OuterDesignPaneProps>(function OuterDesignPane(props, ref) {
  return <EmailDesigner ref={ref} {...props} channel="E_RECEIPT" />
})
