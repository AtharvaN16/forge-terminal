import { statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { Box, Text } from 'ink'
import { useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { moveItem, nextSortMode, type SortMode, sortSources } from '../../core/order.js'
import { mergeOutputPath } from '../../core/output-path.js'
import type { SourceInfo } from '../../core/types.js'
import { formatBytes } from '../../core/units.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { middleEllipsis } from '../width.js'
import { HintBar } from './HintBar.js'
import { Prompt } from './Prompt.js'

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
   * The edited order and the output path to plan against — default from
   * `mergeOutputPath`, or the renamed one if `n` was used. Merge order *is*
   * page order, so this is the one place that order gets decided.
   */
  onSubmit: (ordered: SourceInfo[], outputPath: string) => void
  onCancel: () => void
  /**
   * `x` dropped the list below two sources — merge no longer applies. Takes
   * the count still remaining rather than the flow guessing it, so whatever
   * gets said about it back at the hub is a real number.
   */
  onTooFew: (remaining: number) => void
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
  heldIndex,
}: MergeListProps) {
  const palette = useTheme()
  const mtimes = useMemo(() => mtimesFor(sources), [sources])

  const [order, setOrder] = useState<SourceInfo[]>(sources)
  const [cursor, setCursor] = useState(heldIndex ?? 0)
  const [held, setHeld] = useState<number | null>(heldIndex ?? null)
  const [mode, setMode] = useState<SortMode>('dropped')
  const [renaming, setRenaming] = useState(false)
  const [stemText, setStemText] = useState('')
  const [customStem, setCustomStem] = useState<string | undefined>(undefined)

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
  const customStemRef = useRef(customStem)
  customStemRef.current = customStem

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

  const defaultOutputPath = mergeOutputPath(order.map((s) => s.path))
  const outputExt = extname(defaultOutputPath) || '.pdf'
  const outputPath = customStem
    ? join(dirname(defaultOutputPath), `${customStem}${outputExt}`)
    : defaultOutputPath

  const currentOutputPath = (): string => {
    const def = mergeOutputPath(orderRef.current.map((s) => s.path))
    const stem = customStemRef.current
    return stem ? join(dirname(def), `${stem}${extname(def) || '.pdf'}`) : def
  }

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

  const openRename = () => {
    if (heldRef.current !== null) return
    setStemText(customStemRef.current ?? basename(defaultOutputPath, outputExt))
    setRenaming(true)
  }

  const submitRename = (raw: string) => {
    const cleaned = raw.trim().replace(/\//g, '-')
    setCustomStem(cleaned === '' ? undefined : cleaned)
    setRenaming(false)
  }

  useKeys(
    (_input, key) => {
      if (key.escape) setRenaming(false)
    },
    { isActive: renaming },
  )

  useKeys(
    (input, key) => {
      if (key.upArrow) moveCursor(-1)
      if (key.downArrow) moveCursor(1)
      if (input === ' ') toggleHold()
      if (key.escape) putBackOrCancel()
      if (input === 'x') removeCurrent()
      if (input === 's') cycleSort()
      if (input === 'n') openRename()
      if (key.return && heldRef.current === null) onSubmit(orderRef.current, currentOutputPath())
    },
    { isActive: !renaming },
  )

  const totalPages = order.reduce((n, s) => n + pagesOf(s), 0)

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
    Math.max(0, ...order.map((s) => stringWidth(basename(s.path)))) + 4,
    Math.max(4, width - ROW_CHROME),
  )

  const rows = order.map((s, i) => {
    const isCursor = i === cursor
    const isHeld = i === held
    const mark = isHeld ? '⇅' : isCursor ? SYMBOLS.cursor : ' '
    const name = middleEllipsis(basename(s.path), nameWidth)
    const numStr = String(i + 1).padStart(2)
    // Padded by column count, not by `padEnd`'s code units, for the same
    // reason the width above is measured in columns.
    const nameStr = `${name}${' '.repeat(Math.max(0, nameWidth - stringWidth(name)))}`
    const pages = pagesOf(s)
    const pagesStr = `${pages} ${pages === 1 ? 'page' : 'pages'}`.padStart(9)
    const sizeStr = formatBytes(s.bytes).padStart(10)
    const bg = isCursor && palette.selectionBg !== '' ? palette.selectionBg : undefined

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
          ['esc', 'put back'],
        ]
      : [
          ['↑↓', 'select'],
          ['space', 'pick up'],
          ['s', 'sort'],
          ['x', 'remove'],
          ['n', 'rename'],
          ['↵', 'confirm'],
          ['esc', 'cancel'],
        ]

  return (
    <Box flexDirection="column">
      <Text color={colourProp(palette.dim)}>
        {`${order.length} ${order.length === 1 ? 'file' : 'files'} to merge`}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {rows}
      </Box>
      {renaming ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colourProp(palette.label)}>Name the output</Text>
          <Prompt
            value={stemText}
            onChange={setStemText}
            onSubmit={submitRename}
            placeholder={basename(defaultOutputPath, outputExt)}
            isActive
            variant="field"
            width={width}
          />
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Text color={colourProp(palette.dim)}>
            {`${SYMBOLS.longArrow} ${middleEllipsis(outputPath, Math.max(12, width - 4))}  ·  ${totalPages} ${totalPages === 1 ? 'page' : 'pages'}`}
          </Text>
          {mode !== 'dropped' ? (
            <Text color={colourProp(palette.dim)}>{`sorted: ${mode} ▾`}</Text>
          ) : null}
        </Box>
      )}
      <HintBar width={width} pairs={hintPairs} />
    </Box>
  )
}
