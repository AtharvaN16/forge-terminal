import type { Key } from 'ink'
import { useEffect, useState } from 'react'
import { PRESS_MS } from './motion.js'

/**
 * Which key was pressed a moment ago, so every key the screen draws can answer
 * it (2026-10-20, B on mockups/key-state-2026-10-round3.html): the key's own
 * letters turn the app's one yellowish orange (`brand`) while it is down, in
 * every mode, and the words beside it stay as they were. The keys with a
 * colour of their own — "/ menu", whose gold is the menu being open, and the
 * chips filled in the mode's colour — keep it.
 *
 * A terminal never says a key came up, so "down" is a fixed moment (`PRESS_MS`)
 * after the press. Every key goes through `useKeys`, which calls
 * `announceKey`; the drawing code asks `keyIsDown` with the label it is about
 * to draw ("↵", "1–6 ←→", "esc", "ctrl-n") and need not know which screen is
 * up. `usePressedKeys` in the App redraws the screen at the press and again
 * when the moment is over.
 */

let last: { name: string; at: number } | undefined
let active = false
const listeners = new Set<() => void>()

/** The name a press goes by: the glyph or word a key hint would print for it. */
function keyName(input: string, key: Key): string | undefined {
  if (key.return) return '↵'
  if (key.escape) return 'esc'
  if (key.tab) return 'tab'
  if (key.upArrow) return '↑'
  if (key.downArrow) return '↓'
  if (key.leftArrow) return '←'
  if (key.rightArrow) return '→'
  if (key.backspace || key.delete) return 'delete'
  if (key.ctrl && input) return `ctrl-${input.toLowerCase()}`
  if (key.meta || key.super || key.hyper) return undefined
  if (input === ' ') return 'space'
  if (input.length === 1) return input.toLowerCase()
  return undefined
}

/** Every key press, from `useKeys`. A paste is not one: it arrives with no key. */
export function announceKey(input: string, key: Key): void {
  if (!active) return
  const name = keyName(input, key)
  if (name === undefined) return
  last = { name, at: Date.now() }
  for (const listener of listeners) listener()
}

const ARROWS = /^[↑↓←→]+$/
const cache = new Map<string, ReadonlySet<string>>()

/** The names of the presses a key hint's label stands for: "1–6 ←→" is 1 to 6 and the two arrows. */
function namesOf(label: string): ReadonlySet<string> {
  const known = cache.get(label)
  if (known) return known
  const names = new Set<string>()
  for (const raw of label.toLowerCase().split(/\s+/)) {
    const range = /^(\d)[–-](\d)$/.exec(raw)
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) names.add(String(d))
    } else if (raw === 'enter' || raw === 'return') names.add('↵')
    else if (raw === 'backspace') names.add('delete')
    else if (ARROWS.test(raw)) for (const arrow of raw) names.add(arrow)
    else if (raw.includes('/') && raw.length > 1)
      for (const part of raw.split('/')) names.add(part === '−' ? '-' : part)
    else names.add(raw === '−' ? '-' : raw)
  }
  cache.set(label, names)
  return names
}

/** Whether the key a hint is labelled with is the one pressed a moment ago. */
export function keyIsDown(label: string): boolean {
  if (!active || last === undefined || Date.now() - last.at >= PRESS_MS) return false
  return namesOf(label).has(last.name)
}

/**
 * Called once, by the App: redraws at each press and when its moment is over,
 * and ignores presses where there is no motion (the same rule as every other
 * flash, M6b).
 */
export function usePressedKeys(enabled: boolean): void {
  const [, redraw] = useState(0)
  active = enabled
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const onPress = () => {
      redraw((n) => n + 1)
      clearTimeout(timer)
      timer = setTimeout(() => redraw((n) => n + 1), PRESS_MS + 20)
    }
    listeners.add(onPress)
    return () => {
      listeners.delete(onPress)
      clearTimeout(timer)
      last = undefined
    }
  }, [])
}
