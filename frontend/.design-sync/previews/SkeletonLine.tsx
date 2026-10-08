import { SkeletonLine } from 'cep-frontend'

export const Loading = () => (
  <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 10 }} className="rounded-md border border-line bg-surface p-4">
    <SkeletonLine width="45%" height={16} />
    <SkeletonLine width="90%" />
    <SkeletonLine width="75%" />
    <SkeletonLine width="60%" />
  </div>
)
