import { Box, Text } from 'ink'
import { useRef, useState } from 'react'
import stringWidth from 'string-width'
import type { Choice } from '../../core/actions/index.js'
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
}

/** The first row that isn't `disabled`, or 0 if every row is (nothing to land on anyway). */
function firstEnabled(items: Choice[]): number {
  const i = items.findIndex((item) => !item.disabled)
  return i === -1 ? 0 : i
}

export function Select({
  items,
  onSubmit,
  onCancel,
  showHints = true,
  onHighlight,
  isActive = true,
  width,
}: SelectProps) {
  const palette = useTheme()
  const [index, setIndex] = useState(() => firstEnabled(items))

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
  const indexRef = useRef(firstEnabled(items))

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

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        // A disabled row is never the live selection, even if `index`
        // somehow pointed at one (it shouldn't — `move` and the initial
        // index both skip disabled rows) — the dim hub row for an
        // unavailable action must never draw the cursor or go bold.
        const selected = i === index && !item.disabled
        const cursor = selected ? `${SYMBOLS.cursor} ` : '  '
        const label = item.label.padEnd(labelWidth)
        const hint = showHints && item.hint ? `  ${item.hint}` : ''

        /**
         * The band hugs the content rather than filling the row edge to edge,
         * because Ink trims trailing whitespace from every rendered line —
         * measured: a Text of "❯ WebP" plus twenty spaces comes back six
         * columns wide. A padded band is therefore not merely wasteful, it
         * does not exist. Hugging the content is also what the reference
         * implementations actually draw.
         *
         * The hint is budgeted in terminal columns via `middleEllipsis`, not
         * code units, for the reason documented there: a CJK glyph is two
         * columns and one code point, so a length-based budget overflows the
         * terminal by exactly the difference.
         */
        const badgeWidth = item.badge ? stringWidth(item.badge) + 5 : 0
        const used = stringWidth(cursor) + stringWidth(label) + badgeWidth
        const shownHint = hint === '' ? '' : middleEllipsis(hint, Math.max(0, width - used))

        return (
          <Text
            key={item.value}
            {...(selected && palette.selectionBg !== ''
              ? { backgroundColor: palette.selectionBg }
              : {})}
          >
            <Text {...(selected ? { color: colourProp(palette.accent) } : {})}>{cursor}</Text>
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
            {shownHint ? <Text color={colourProp(palette.dim)}>{shownHint}</Text> : null}
            {item.badge ? (
              // Accent, bracketed and spaced: as a plain dim suffix it read as
              // the tail of the path it followed rather than a label about it.
              <Text color={colourProp(palette.accent)}>{`   [${item.badge}]`}</Text>
            ) : null}
          </Text>
        )
      })}
    </Box>
  )
}
