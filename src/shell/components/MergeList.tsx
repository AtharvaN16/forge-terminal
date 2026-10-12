import { statSync } from 'node:fs'

import { Box, Text } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { moveItem, nextSortMode, type SortMode, sortSources } from '../../core/order.js'
import type { SourceInfo } from '../../core/types.js'
import { formatBytes } from '../../core/units.js'
import { displayName } from '../../utils/display-path.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { middleEllipsis } from '../width.js'
import { HintBar } from './HintBar.js'

/**
 * Real modification times for `sortSources`'s `newest`/`oldest` modes. A
 * missing or unreadable file (never expected here — everything staged was
 * already probed — but cheap to guard) is simply left out of the map;
 * `sortSources` already treats an absent entry as 0, "oldest", rather than
 * this throwing and taking the picker down with it.
 */
function mtimesFor(sources: SourceInfo[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const s of sources) {
    try {
      map.set(s.path, statSync(s.path).mtimeMs)
    } catch {
      // left out of the map — see the doc comment above
    }
  }
  return map
}

const pagesOf = (s: SourceInfo): number => (s.kind === 'document' ? s.pages : 0)

export interface MergeListProps {
  sources: SourceInfo[]
  width: number
  /**
   * The edited order. Merge order *is* page order, so this is the one place
   * that order gets decided; the file is named on Save as, after this.
   */
  onSubmit: (ordered: SourceInfo[]) => void
  onCancel: () => void
  /**
   * `x` dropped the list below two sources — merge no longer applies. Takes
   * the count still remaining rather than the flow guessing it, so whatever
   * gets said about it back at the hub is a real number.
   */
  onTooFew: (remaining: number) => void
  /** The list as it stands after every move, sort or removal, for whatever counts it (the title). */
  onOrderChange?: ((ordered: SourceInfo[]) => void) | undefined
  /**
   * Seeds the held row. Only ever set by a test — real use always starts
   * with nothing picked up and gets there through `space`, the same way
   * `PageGrid`'s `selected` is an uncontrolled seed rather than a live prop.
   */
  heldIndex?: number
}

/**
 * The reorderable list `/pdf` → Merge plans from.
 *
 * Pick-up-and-move, not a modifier chord: `space` grabs the row under the
 * cursor, arrows then move the *row* rather than the cursor, `space` drops
 * it, `esc` puts it back. Deliberately not `shift+↑↓` — modifier-plus-arrow
 * is the least reliably detected input across terminals, and a held row
 * that visibly travels explains itself where a chord does not.
 *
 * Uncontrolled after mount, the same way `PageGrid` is: `sources` seeds the
 * starting order and this component owns all further edits itself, only
 * ever reporting out through `onSubmit`, `onCancel` and `onTooFew`.
 */
export function MergeList({
  sources,
  width,
  onSubmit,
  onCancel,
  onTooFew,
  onOrderChange,
  heldIndex,
}: MergeListProps) {
  const palette = useTheme()
  const mtimes = useMemo(() => mtimesFor(sources), [sources])

  const [order, setOrder] = useState<SourceInfo[]>(sources)
  useEffect(() => {
    onOrderChange?.(order)
  }, [order, onOrderChange])
  const [cursor, setCursor] = useState(heldIndex ?? 0)
  const [held, setHeld] = useState<number | null>(heldIndex ?? null)
  const [mode, setMode] = useState<SortMode>('dropped')

  /**
   * `useInput` handlers are synchronous, but `useState` updates are not —
   * several keypresses can be delivered through the same handler closure
   * before React re-renders (see the same comment in `Select.tsx` and
   * `PageGrid.tsx`). These refs are the source of truth the handlers below
   * read and write; the `useState` pairs above exist only to trigger a
   * render with the latest value.
   */
  const orderRef = useRef(order)
  const cursorRef = useRef(cursor)
  const heldRef = useRef(held)
  const modeRef = useRef(mode)

  /**
   * What `s` sorts from, and what cycling back around to `dropped` restores
   * — `sortSources`'s `dropped` case is identity, so it has to be handed a
   * list rather than reading the screen.
   *
   * Starts as the as-staged order and is replaced whenever a row is dropped
   * somewhere new by hand. Sorting never touches it, so `s` remains
   * reversible; a hand-dragged order is the more expensive thing to lose,
   * and without this someone who dragged a row and then pressed `s` once
   * could never get their arrangement back. `dropped` is also the only mode
   * that renders no `sorted: … ▾` line, so it can honestly mean "the order
   * you have" rather than "the order they arrived in". Also shrinks when `x`
   * removes a file.
   */
  const baseRef = useRef(sources)

  /** The order to restore to if a held row is put back with `esc`. */
  const heldSnapshotRef = useRef<SourceInfo[] | null>(null)

  const clampIndex = (i: number, len: number) => Math.min(Math.max(i, 0), Math.max(0, len - 1))

  const moveCursor = (delta: number) => {
    if (heldRef.current !== null) {
      const from = heldRef.current
      const to = clampIndex(from + delta, orderRef.current.length)
      if (to === from) return
      const next = moveItem(orderRef.current, from, to)
      orderRef.current = next
      setOrder(next)
      heldRef.current = to
      setHeld(to)
      cursorRef.current = to
      setCursor(to)
      return
    }
    const next = clampIndex(cursorRef.current + delta, orderRef.current.length)
    if (next === cursorRef.current) return
    cursorRef.current = next
    setCursor(next)
  }

  const toggleHold = () => {
    if (heldRef.current === null) {
      heldSnapshotRef.current = orderRef.current
      heldRef.current = cursorRef.current
      setHeld(cursorRef.current)
    } else {
      // Dropping a row commits the arrangement: it becomes what `s` sorts
      // from and what cycling back to `dropped` restores (see `baseRef`).
      // Only reached by `space` — `esc` goes through `putBackOrCancel`,
      // which restores the snapshot instead and leaves the baseline alone.
      baseRef.current = orderRef.current
      heldRef.current = null
      setHeld(null)
      heldSnapshotRef.current = null
    }
  }

  const putBackOrCancel = () => {
    if (heldRef.current !== null) {
      const snapshot = heldSnapshotRef.current
      if (snapshot) {
        orderRef.current = snapshot
        setOrder(snapshot)
      }
      heldRef.current = null
      setHeld(null)
      heldSnapshotRef.current = null
      return
    }
    onCancel()
  }

  const removeCurrent = () => {
    if (heldRef.current !== null) return
    const i = cursorRef.current
    const removed = orderRef.current[i]
    if (!removed) return
    const next = orderRef.current.filter((_, idx) => idx !== i)
    orderRef.current = next
    setOrder(next)
    baseRef.current = baseRef.current.filter((s) => s.path !== removed.path)
    if (next.length < 2) {
      onTooFew(next.length)
      return
    }
    const clamped = clampIndex(i, next.length)
    cursorRef.current = clamped
    setCursor(clamped)
  }

  const cycleSort = () => {
    if (heldRef.current !== null) return
    // `modeRef`, not `mode`: two `s` presses delivered in one tick share this
    // render's closure, so reading the state would advance the cycle once for
    // both of them (see the ref note above).
    const next = nextSortMode(modeRef.current)
    const sorted = sortSources(baseRef.current, next, mtimes)
    modeRef.current = next
    setMode(next)
    orderRef.current = sorted
    setOrder(sorted)
    const clamped = clampIndex(cursorRef.current, sorted.length)
    cursorRef.current = clamped
    setCursor(clamped)
  }

  useKeys((input, key) => {
    if (key.upArrow) moveCursor(-1)
    if (key.downArrow) moveCursor(1)
    if (input === ' ') toggleHold()
    if (key.escape) putBackOrCancel()
    if (input === 'x') removeCurrent()
    if (input === 's') cycleSort()
    if (key.return && heldRef.current === null) onSubmit(orderRef.current)
  })

  /**
   * Everything on a row that is not the name: two leading spaces, the
   * pick-up mark, a space, the two-digit number, two spaces, then the
   * right-aligned page count (9) and size (10).
   */
  const ROW_CHROME = 27
  /**
   * The name column is as wide as the longest name, but never wider than the
   * room left on the row — spec §13: content is truncated, not wrapped. One
   * long filename used to push every row past the terminal width, and Ink
   * wrapped the lot. Measured in columns rather than code units, because
   * `middleEllipsis` budgets in columns and a name can contain a wide glyph.
   */
  const nameWidth = Math.min(
    Math.max(0, ...order.map((s) => stringWidth(displayName(s.path)))) + 4,
    Math.max(4, width - ROW_CHROME),
  )

  const rows = order.map((s, i) => {
    const isCursor = i === cursor
    const isHeld = i === held
    // The picker's strip marks the row you are on; a row picked up says so with ⇅.
    const mark = isHeld ? '⇅' : isCursor ? SYMBOLS.strip : ' '
    const name = middleEllipsis(displayName(s.path), nameWidth)
    const numStr = String(i + 1).padStart(2)
    // Padded by column count, not by `padEnd`'s code units, for the same
    // reason the width above is measured in columns.
    const nameStr = `${name}${' '.repeat(Math.max(0, nameWidth - stringWidth(name)))}`
    const pages = pagesOf(s)
    const pagesStr = `${pages} ${pages === 1 ? 'page' : 'pages'}`.padStart(9)
    const sizeStr = formatBytes(s.bytes).padStart(10)
    // The picker's band: grey, as every list's is.
    const bg = isCursor && palette.listBand !== '' ? palette.listBand : undefined

    return (
      <Text key={s.path} {...(bg ? { backgroundColor: bg } : {})}>
        <Text>{'  '}</Text>
        <Text {...(isCursor || isHeld ? { color: colourProp(palette.accent) } : {})}>{mark}</Text>
        <Text> </Text>
        <Text bold={isCursor} color={colourProp(isCursor ? palette.fg : palette.dim)}>
          {`${numStr}  ${nameStr}`}
        </Text>
        <Text color={colourProp(palette.dim)}>{pagesStr}</Text>
        <Text color={colourProp(palette.dim)}>{sizeStr}</Text>
      </Text>
    )
  })

  const hintPairs: Array<[string, string]> =
    held !== null
      ? [
          ['↑↓', 'move'],
          ['space', 'drop'],
        ]
      : [
          ['↑↓', 'choose'],
          ['space', 'pick up'],
          ['↵', 'confirm'],
        ]
  const hintFoot: Array<[string, string]> =
    held !== null
      ? [['esc', 'put back']]
      : [
          ['s', 'sort'],
          ['x', 'remove'],
          ['esc', 'back'],
        ]

  return (
    <Box flexDirection="column">
      {/* How many, and how many pages, is the title's to say (pdf.tsx). */}
      <Box flexDirection="column">{rows}</Box>
      {mode !== 'dropped' ? (
        <Box marginTop={1}>
          <Text color={colourProp(palette.dim)}>{`sorted: ${mode} ▾`}</Text>
        </Box>
      ) : null}
      <HintBar width={width} pairs={hintPairs} foot={hintFoot} />
    </Box>
  )
}
