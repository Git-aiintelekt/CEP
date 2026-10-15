/**
 * Home's opening: when the page opens its numbers count up, rings fill, the hero trends draw in and bars grow, all on
 * one 1s clock that eases to a stop and plays once. The clock starts with the first figure to arrive; anything that
 * arrives later joins it part-way (a negative animation delay), so everything still stops together, and anything that
 * arrives after the second, or after a filter change, simply appears. Off under prefers-reduced-motion.
 */
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'

export const INTRO_MS = 1000
/** cubic ease-out, the same curve as the CSS classes' cubic-bezier(0.33, 1, 0.68, 1) */
export const easeOut = (t: number) => 1 - (1 - t) ** 3

export interface IntroClock {
  /** whether a part appearing now should still play: false once the intro is over or when motion is off */
  playing: () => boolean
  /** ms since the intro started, starting it on the first call; read as a part reaches the page */
  elapsed: () => number
}
export const IntroContext = createContext<IntroClock>({ playing: () => false, elapsed: () => INTRO_MS })

function motionAllowed(): boolean {
  return typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function createIntroClock(): IntroClock {
  let start: number | null = null
  return {
    playing: () => motionAllowed() && (start === null || performance.now() - start < INTRO_MS),
    elapsed: () => {
      const now = performance.now()
      start ??= now
      return now - start
    },
  }
}

/** whether this part plays the intro, decided once as it first appears */
export function useIntroPlaying(enabled: boolean): boolean {
  const clock = useContext(IntroContext)
  const [playing] = useState(() => enabled && clock.playing())
  return playing
}

/**
 * For a part animated in CSS: whether it plays, and a ref that puts its animation on the shared clock (a negative
 * --intro-delay), set as it reaches the page so the CSS and the counting numbers stop together.
 */
export function useIntroRef<T extends HTMLElement>(enabled = true) {
  const clock = useContext(IntroContext)
  const playing = useIntroPlaying(enabled)
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    if (playing) ref.current?.style.setProperty('--intro-delay', `${-Math.round(clock.elapsed())}ms`)
  }, [playing, clock])
  return [ref, playing] as const
}

export const COUNTABLE = /\d[\d,]*(\.\d+)?/

/** "$4.3K" at a fraction of the way from zero: "$2.1K". Keeps the prefix, suffix, decimals and thousands commas. */
export function countFrame(value: string, fraction: number): string {
  const match = COUNTABLE.exec(value)
  if (!match) return value
  const text = match[0]
  const decimals = match[1] ? match[1].length - 1 : 0
  const now = Number(text.replace(/,/g, '')) * fraction
  const shown = text.includes(',')
    ? now.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : now.toFixed(decimals)
  return value.slice(0, match.index) + shown + value.slice(match.index + text.length)
}
