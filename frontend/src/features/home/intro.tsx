/** Home's opening animation: the clock's provider and the parts that play on it (see introClock). */
import { useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'

import { COUNTABLE, INTRO_MS, IntroContext, countFrame, createIntroClock, easeOut, useIntroPlaying, useIntroRef } from './introClock'

export function HomeIntro({ children }: { children: ReactNode }) {
  const clock = useMemo(() => createIntroClock(), [])
  return <IntroContext.Provider value={clock}>{children}</IntroContext.Provider>
}

/** Wraps a part that plays a CSS intro (`className`) on its descendants; remount it (key) when its data arrives. */
export function IntroScope({ enabled, className, children }: { enabled: boolean; className: string; children: ReactNode }) {
  const [ref, playing] = useIntroRef<HTMLDivElement>(enabled)
  return <div ref={ref} className={`contents ${playing ? className : ''}`}>{children}</div>
}

/** A progress bar's fill, growing from nothing to `percent` as the page opens. */
export function IntroBar({ percent, className, as: Tag = 'span' }: { percent: number; className: string; as?: 'span' | 'div' }) {
  const [ref, playing] = useIntroRef<HTMLSpanElement & HTMLDivElement>(percent > 0)
  return <Tag ref={ref} className={`block h-full ${className} ${playing ? 'cep-intro-grow' : ''}`} style={{ width: `${percent}%` }} />
}

/** A formatted figure that counts up from zero as the page opens; screen readers get the figure itself. */
export function CountUp({ value }: { value: string }) {
  const clock = useContext(IntroContext)
  const playing = useIntroPlaying(COUNTABLE.test(value))
  const [progress, setProgress] = useState(playing ? 0 : 1)
  useLayoutEffect(() => {
    if (!playing) return
    const start = performance.now() - clock.elapsed()
    let frame = requestAnimationFrame(function tick(now) {
      const next = Math.min(1, Math.max(0, (now - start) / INTRO_MS))
      setProgress(next)
      if (next < 1) frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, clock])
  if (progress >= 1) return <>{value}</>
  return <><span aria-hidden>{countFrame(value, easeOut(progress))}</span><span className="sr-only">{value}</span></>
}
