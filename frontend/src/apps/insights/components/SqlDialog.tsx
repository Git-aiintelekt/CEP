/**
 * Show the SQL: the statement the engine runs for a report (and the linked dataset's, when it adds measures from one), with
 * the values written in for reading. Nothing runs. Copy puts a statement on the clipboard.
 */
import { useQuery } from '@tanstack/react-query'
import { Copy } from 'lucide-react'

import { buttonSecondary } from '@/components/Form'
import { Modal } from '@/components/Modal'
import { ErrorState, Spinner } from '@/components/States'
import { useToast } from '@/components/Toast'
import { insightsApi } from '../api'
import type { ReportDefinition } from '../types'

const DIALECT: Record<string, string> = { postgresql: 'PostgreSQL', clickhouse: 'ClickHouse', mysql: 'MySQL', sqlserver: 'SQL Server', oracle: 'Oracle' }

export function SqlDialog({ dataset, definition, name, onClose }: { dataset: string; definition: ReportDefinition; name: string; onClose: () => void }) {
  const toast = useToast()
  const shown = useQuery({ queryKey: ['insights', 'sql', dataset, definition], queryFn: () => insightsApi.sql({ dataset, definition }), retry: false })

  async function copy(sql: string) {
    try {
      await navigator.clipboard.writeText(sql)
      toast.success('SQL copied', 'The statement is on the clipboard.')
    } catch (error) {
      toast.failure(error, 'The SQL was not copied')
    }
  }

  return (
    <Modal title="Show the SQL" subtitle={name} size="xl" scrollBody onClose={onClose} footer={<div className="flex justify-end"><button type="button" className={buttonSecondary} onClick={onClose}>Close</button></div>}>
      {shown.isPending ? <Spinner label="Writing the SQL" /> : shown.isError ? <ErrorState error={shown.error} onRetry={() => shown.refetch()} /> : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-800">{shown.data.note}</p>
          {shown.data.statements.map((statement, index) => (
            <section key={index} aria-label={`${statement.label} SQL`} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink-900">{statement.label} · {DIALECT[statement.dialect] ?? statement.dialect}</h3>
                <button type="button" className={buttonSecondary} onClick={() => copy(statement.sql)}><Copy size={16} strokeWidth={1.5} aria-hidden />Copy</button>
              </div>
              {statement.access && statement.access.length > 0 && (
                <p className="text-xs text-ink-800">Your row access rules are in it: {statement.access.map((a) => `${a.label} is ${a.values.map(String).join(' or ')}`).join('; ')}.</p>
              )}
              <pre className="max-h-80 overflow-auto rounded-md border border-line bg-surface-subtle p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-ink-900">{statement.sql}</pre>
            </section>
          ))}
        </div>
      )}
    </Modal>
  )
}
