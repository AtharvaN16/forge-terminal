import { Box, type DOMElement, Text } from 'ink'
import { type ReactNode, useRef, useState } from 'react'
import stringWidth from 'string-width'
import type { Choice } from '../../core/actions/index.js'
import { useClickTarget } from '../ClickTargets.js'
import { easeOut, mix, motionEnabled, useTween } from '../motion.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { middleEllipsis } from '../width.js'

interface SelectProps {
  items: Choice[]
  onSubmit: (value: string) => void
  onCancel?: () => void
  showHints?: boolean
  /** Fires whenever the cursor moves, so a parent can preview the highlighted item. */
  onHighlight?: (index: number) => void
  isActive?: boolean
  /**
   * The live terminal width. Rows are budgeted against it so a long hint is
   * truncated rather than wrapped or allowed to overflow (spec §13).
   */
  width: number
  /**
   * The value the cursor opens on — an `OptionSpec`'s `default`. Read once,
   * at mount, like any initial state. Falls back to the first enabled row
   * when it names nothing, or names a disabled row: the cursor never rests
   * where Enter would do nothing.
   */
  initialValue?: string
  /**
   * What the highlighted row says instead of its hint — a measured size, say.
   * Called for that row only, with the columns left for it.
   */
  speak?: (item: Choice, budget: number) => ReactNode
  /**
   * Which rows show their hint. A question's choices are names, and only the
   * highlighted one says more (`highlighted`, the default). A list whose
   * hints are how you find the row at all — the command palette — shows
   * `every` one.
   */
  hints?: 'highlighted' | 'every'
}

/** How long the band takes to move between rows. */
const GLIDE_MS = 140

/** The first row that isn't `disabled`, or 0 if every row is (nothing to land on anyway). */
function firstEnabled(items: Choice[]): number {
  const i = items.findIndex((item) => !item.disabled)
  return i === -1 ? 0 : i
}

/** Where the cursor opens: `initialValue`'s row if it is a live one, else `firstEnabled`. */
function initialIndex(items: Choice[], initialValue: string | undefined): number {
  if (initialValue !== undefined) {
    const i = items.findIndex((item) => item.value === initialValue && !item.disabled)
    if (i !== -1) return i
  }
  return firstEnabled(items)
}

/**
 * One row, plus the click region it occupies.
 *
 * A component rather than inline JSX because each row needs its own ref and
 * its own `useClickTarget`, and hooks cannot be called from inside a `map`.
 */
function SelectRow({
  index,
  isActive,
  onChoose,
  onPointer,
  children,
}: {
  index: number
  isActive: boolean
  onChoose: () => void
  onPointer: () => void
  children: ReactNode
}) {
  const ref = useRef<DOMElement | null>(null)
  useClickTarget({
    id: `select-row-${index}`,
    ref,
    onClick: onChoose,
    onHover: (hovering) => {
      if (hovering) onPointer()
    },
    isActive,
  })
  return <Box ref={ref}>{children}</Box>
}

export function Select({
  items,
  onSubmit,
  onCancel,
  showHints = true,
  onHighlight,
  isActive = true,
  width,
  initialValue,
  speak,
  hints = 'highlighted',
}: SelectProps) {
  const palette = useTheme()
  const [index, setIndex] = useState(() => initialIndex(items, initialValue))

  /**
   * The band glides: it fades in on the new row and out of the one it left.
   * `from` is that row, captured during render so the first frame of a move
   * already knows it.
   */
  const glide = useRef({ from: index, to: index })
  if (glide.current.to !== index) glide.current = { from: glide.current.to, to: index }
  const k = easeOut(useTween(index, GLIDE_MS, { enabled: motionEnabled(palette.name) }))

  /**
   * `useInput` handlers are synchronous, but `useState` updates are not —
   * several keypresses can be delivered through the same handler closure
   * before React re-renders, so `useState` cannot be the source of truth
   * for what to act on *right now*. `indexRef` is that source of truth;
   * `index`/`setIndex` exist only to trigger a render with the latest
   * value. In particular, Enter must read `indexRef.current`, not `index`
   * — reading the state would submit whatever was on screen when this
   * render's closure was created, not what the frame the user is looking
   * at actually shows.
   */
  const indexRef = useRef(initialIndex(items, initialValue))

  /**
   * The next enabled row in `delta`'s direction, or the current one if
   * there isn't one — a disabled row (the `/pdf` hub's dimmed "needs 2+
   * files" Merge) is not a stop the cursor can land on, so moving toward
   * one keeps walking past it exactly like `move` already walks past the
   * end of the list.
   */
  const nextEnabledIndex = (from: number, delta: number): number => {
    let i = from + delta
    while (i >= 0 && i < items.length && items[i]?.disabled) i += delta
    return i >= 0 && i < items.length ? i : from
  }

  const move = (delta: number) => {
    const next = nextEnabledIndex(indexRef.current, delta)
    if (next === indexRef.current) return // no-op at an end: nothing moved, nothing to report
    indexRef.current = next
    setIndex(next)
    if (onHighlight) onHighlight(next)
  }

  /**
   * Moves the highlight to an exact row, for the pointer.
   *
   * Separate from `move`, which is relative and skips disabled rows — a
   * pointer names the row directly, and a disabled row registers no target so
   * it can never be named.
   */
  const highlightRow = (next: number) => {
    if (next === indexRef.current) return
    indexRef.current = next
    setIndex(next)
    if (onHighlight) onHighlight(next)
  }

  useKeys(
    (_input, key) => {
      if (items.length === 0) return
      if (key.downArrow) move(1)
      if (key.upArrow) move(-1)
      if (key.return) {
        const item = items[indexRef.current]
        if (item && !item.disabled) onSubmit(item.value)
      }
      if (key.escape && onCancel) onCancel()
    },
    { isActive },
  )

  if (items.length === 0) return null

  const labelWidth = Math.max(0, ...items.map((i) => stringWidth(i.label)))

  /** The band behind row `i` right now, or nothing. */
  const bandFor = (i: number, selected: boolean): string | undefined => {
    if (palette.band === '') return undefined
    if (selected) return mix(palette.canvas, palette.band, k)
    if (i === glide.current.from && k < 1) return mix(palette.band, palette.canvas, k)
    return undefined
  }

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        // A disabled row is never the live selection, even if `index`
        // somehow pointed at one (it shouldn't — `move` and the initial
        // index both skip disabled rows) — the dim hub row for an
        // unavailable action must never draw the marker or go bold.
        const selected = i === index && !item.disabled
        const marker = selected ? `${SYMBOLS.strip} ` : '  '
        const label = item.label.padEnd(labelWidth)

        /**
         * Rows are names. Only the highlighted row says more — its hint, or
         * whatever `speak` puts there — so the list reads as one quiet column
         * with one sentence in it. A disabled row keeps its hint, because
         * there the hint is the reason the row cannot be chosen.
         */
        const badge = item.badge ? `${SYMBOLS.star} ${item.badge}` : ''
        const used = stringWidth(marker) + stringWidth(label) + (badge ? stringWidth(badge) + 2 : 0)
        const room = Math.max(0, width - used - 2)
        const spoken = selected && showHints && speak ? speak(item, room) : null
        const speaks = hints === 'every' ? showHints && !spoken : selected && showHints && !speak
        const hintText = item.disabled || speaks ? (item.hint ?? '') : ''
        // Budgeted in terminal columns via `middleEllipsis`, not code units:
        // a CJK glyph is two columns and one code point.
        const shownHint = hintText === '' ? '' : middleEllipsis(hintText, room)
        const bg = bandFor(i, selected)

        return (
          <SelectRow
            key={item.value}
            index={i}
            isActive={isActive && !item.disabled}
            onChoose={() => onSubmit(item.value)}
            onPointer={() => highlightRow(i)}
          >
            {/*
              The band is a Box of exactly `width` columns rather than padded
              Text: Ink trims trailing whitespace from every rendered line, so
              a padded Text band would stop where the words do.
            */}
            <Box width={width} {...(bg ? { backgroundColor: bg } : {})}>
              <Text color={colourProp(palette.accent)}>{marker}</Text>
              <Text
                bold={selected}
                {...(item.disabled
                  ? { color: colourProp(palette.dim) }
                  : selected
                    ? { color: colourProp(palette.fg) }
                    : {})}
              >
                {label}
              </Text>
              {spoken !== null && spoken !== undefined && spoken !== false ? (
                <Text>
                  {'  '}
                  {spoken}
                </Text>
              ) : shownHint ? (
                // A tone is the row saying something about the choice rather
                // than describing it — "likely bigger" on a lossless target.
                <Text
                  color={colourProp(
                    item.tone === 'warn'
                      ? palette.warn
                      : item.tone === 'ok'
                        ? palette.ok
                        : palette.dim,
                  )}
                >
                  {`  ${shownHint}`}
                </Text>
              ) : null}
              {badge ? (
                <>
                  <Box flexGrow={1} />
                  <Text color={colourProp(palette.accent)}>{badge}</Text>
                </>
              ) : null}
            </Box>
          </SelectRow>
        )
      })}
    </Box>
  )
}
