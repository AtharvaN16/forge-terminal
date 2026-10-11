import { useEffect, useRef, useState } from 'react'

/** Encodes `target` and resolves with the byte count. Measured, never estimated. */
export type MeasureFn = (target: string) => Promise<number>

export type MeasuredSize =
  | { status: 'idle' }
  | { status: 'measuring' }
  | { status: 'done'; bytes: number }

/**
 * The real size of the highlighted choice, found by encoding it (spec
 * 2026-10-11 picker §2).
 *
 * Only the highlighted target is ever encoded, and only once the highlight
 * has rested for `delayMs` — scrolling past four formats starts nothing. One
 * encode runs at a time: an encode cannot be stopped part-way, so a fresh
 * highlight waits for the one in flight and then starts. Every answer is
 * cached by target, which is what makes a result that lands after the
 * highlight moved on harmless: it is filed under its own target and shown
 * only when that target is highlighted again.
 *
 * A failed encode reads as `idle` — there is nothing worth saying about a
 * size nobody could produce, and the conversion itself will report a real
 * failure if there is one.
 */
export function useMeasuredSize({
  highlighted,
  measure,
  resetKey,
  delayMs = 150,
}: {
  highlighted: string | undefined
  measure: MeasureFn | undefined
  /** Whatever identifies the source: a new one empties the cache. */
  resetKey: string | undefined
  delayMs?: number
}): MeasuredSize {
  const results = useRef(new Map<string, number | 'failed'>())
  const forSource = useRef(resetKey)
  if (forSource.current !== resetKey) {
    forSource.current = resetKey
    results.current = new Map()
  }

  const busy = useRef(false)
  const wanted = useRef(highlighted)
  wanted.current = highlighted
  const measureRef = useRef(measure)
  measureRef.current = measure
  const alive = useRef(true)
  const [, redraw] = useState(0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetKey` is read through `results`, which a reset replaces — the effect has to re-run to measure for the new source
  useEffect(() => {
    const pump = () => {
      const target = wanted.current
      const run = measureRef.current
      if (!run || target === undefined || busy.current || results.current.has(target)) return
      busy.current = true
      const cache = results.current
      run(target)
        .then(
          (bytes) => cache.set(target, bytes),
          () => cache.set(target, 'failed'),
        )
        .finally(() => {
          busy.current = false
          if (!alive.current) return
          redraw((n) => n + 1)
          pump()
        })
    }
    if (!measure || highlighted === undefined || results.current.has(highlighted)) return
    const id = setTimeout(pump, delayMs)
    return () => clearTimeout(id)
  }, [highlighted, measure, delayMs, resetKey])

  if (!measure || highlighted === undefined) return { status: 'idle' }
  const known = results.current.get(highlighted)
  if (known === undefined) return { status: 'measuring' }
  if (known === 'failed') return { status: 'idle' }
  return { status: 'done', bytes: known }
}
