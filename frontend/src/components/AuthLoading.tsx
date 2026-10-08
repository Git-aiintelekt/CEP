/**
 * The full-screen state between submitting and the server answering: eight signals sweeping inward to one point.
 */

/** One dot per 45°, each starting a step further round the cycle so the sweep never bunches up. */
const ARCS = Array.from({ length: 8 }, (_, index) => ({
  rotation: index * 45,
  delay: `${-index * 0.45}s`,
  size: index % 2 === 0 ? 6 : 5,
  light: index % 2 === 0,
}))

export function AuthLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="cep-auth-panel fixed inset-0 z-50 flex animate-fade-in flex-col items-center justify-center gap-8 overflow-hidden px-6 py-8"
    >
      <div aria-hidden className="cep-auth-wash cep-auth-wash--overlay absolute -inset-y-[20%] -inset-x-[30%]" />

      <div aria-hidden className="relative aspect-square w-[min(420px,68vw,68vh)] flex-none">
        {ARCS.map((arc) => (
          <div key={arc.rotation} className="absolute inset-0" style={{ transform: `rotate(${arc.rotation}deg)` }}>
            <div className="cep-auth-arc absolute inset-0" style={{ animationDelay: arc.delay }}>
              <span
                className="cep-auth-dot absolute top-1/2 left-[98%] -translate-x-1/2 -translate-y-1/2 rounded-full"
                style={{
                  width: arc.size,
                  height: arc.size,
                  background: arc.light ? 'var(--color-on-brand)' : 'var(--color-on-brand-soft)',
                  animationDelay: arc.delay,
                }}
              />
            </div>
          </div>
        ))}
        <span className="cep-auth-halo absolute top-1/2 left-1/2 h-[34%] w-[34%] rounded-full" />
        <span className="cep-auth-core absolute top-1/2 left-1/2 h-4 w-4 rounded-full bg-white" />
      </div>

      <span className="relative text-sm text-white/70">{label}</span>
    </div>
  )
}
