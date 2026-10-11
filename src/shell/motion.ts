import { useEffect, useRef, useState } from 'react'
import { colourEnabled } from './theme.js'

/**
 * Motion in the shell (spec 2026-10-11 picker §4). Everything here changes a
 * character or a colour in a cell and nothing else, ticks no faster than a
 * terminal can usefully redraw, and stops on its own. When motion is off,
 * every caller shows its final frame — which is what a piped run, NO_COLOR,
 * the first-run NEUTRAL palette and the test suite all see.
 */

/** About 30 redraws a second: smooth to the eye, cheap for Ink. */
export const FRAME_MS = 33

let forced: boolean | undefined

/** Tests only: force motion on or off regardless of the terminal. `undefined` restores detection. */
export function setMotionForTests(on: boolean | undefined): void {
  forced = on
}

export function motionEnabled(paletteName: string): boolean {
  if (forced !== undefined) return forced
  return paletteName !== 'neutral' && colourEnabled()
}

const HEX = /^#[0-9a-f]{6}$/i

/**
 * A colour `k` of the way from `a` to `b`. Only hex colours blend; anything
 * else (an ANSI name, or '' for "no colour") snaps at the midpoint, so a
 * fade degrades to a cut rather than to a wrong colour.
 */
export function mix(a: string, b: string, k: number): string {
  const t = Math.max(0, Math.min(1, k))
  if (!HEX.test(a) || !HEX.test(b)) return t < 0.5 ? a : b
  let out = '#'
  for (const i of [1, 3, 5]) {
    const from = Number.parseInt(a.slice(i, i + 2), 16)
    const to = Number.parseInt(b.slice(i, i + 2), 16)
    out += Math.round(from + (to - from) * t)
      .toString(16)
      .padStart(2, '0')
  }
  return out
}

/** Fast start, gentle stop. */
export function easeOut(k: number): number {
  return 1 - (1 - Math.max(0, Math.min(1, k))) ** 3
}

/**
 * Progress from 0 to 1 over `durationMs`, restarted whenever `key` changes.
 * At rest — and always, when not `enabled` — it reads 1, the final frame.
 *
 * The restart is detected during render rather than in an effect, so the
 * very frame that shows the new key already shows the tween at 0: an effect
 * would let one frame of "already finished" slip out first.
 */
export function useTween(
  key: unknown,
  durationMs: number,
  opts: { enabled: boolean; onMount?: boolean },
): number {
  const started = useRef<{ key: unknown; at: number } | null>(null)
  if (started.current === null) {
    started.current = { key, at: opts.onMount ? Date.now() : Number.NEGATIVE_INFINITY }
  } else if (!Object.is(started.current.key, key)) {
    started.current = { key, at: Date.now() }
  }
  const [, redraw] = useState(0)
  const elapsed = Date.now() - started.current.at
  const running = opts.enabled && elapsed < durationMs

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => redraw((n) => n + 1), FRAME_MS)
    return () => clearInterval(id)
  }, [running])

  if (!opts.enabled) return 1
  return Math.max(0, Math.min(1, elapsed / durationMs))
}

/** A frame count that advances every `intervalMs` while `active`, and holds still otherwise. */
export function useTicker(active: boolean, intervalMs = FRAME_MS * 2): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setN((x) => x + 1), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
  return n
}
