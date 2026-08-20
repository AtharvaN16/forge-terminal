import { Box, Text, useInput } from 'ink'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'

const GAP = 3 // columns between cells, on all three lines

/**
 * How the grid fits the terminal.
 *
 * `cellWidth` is fixed by the *document's* largest page number, not the
 * visible page's, so the grid does not resize under the cursor when paging
 * past 99.
 */
export function gridLayout(
  pageCount: number,
  width: number,
  height: number,
): { perRow: number; rowsPerPage: number; cellWidth: number } {
  const cellWidth = String(pageCount).length + 4 // '│', pad, digits, ' ', '│'
  const usable = Math.max(cellWidth, width - 4)
  const perRow = Math.max(1, Math.floor((usable + GAP) / (cellWidth + GAP)))
  // Three lines a row, plus header, footer, hints and the prompt below.
  const rowsPerPage = Math.max(1, Math.floor((height - 8) / 3))
  return { perRow, rowsPerPage, cellWidth }
}

interface Cursor {
  row: number
  col: number
}

interface PageGridProps {
  mode: 'cell' | 'gap'
  pageCount: number
  /** 0-based page indices, initial and — since there is no onChange — final. */
  selected: number[]
  /**
   * 0-based gap indices. Gap `i` sits between (0-based) pages `i` and
   * `i + 1`.
   */
  cuts: number[]
  onSubmit: (result: number[]) => void
  onCancel?: () => void
  /**
   * `r` and `g` used to be the grid's own reset/home shortcuts; they are not
   * the grid's business — the typed-range editor they open onto is owned by
   * the flow mounting this component. Both keys call this, if given, and are
   * otherwise ignored.
   *
   * Carries the current selection (cell mode) or cuts (gap mode) — this
   * component is uncontrolled and `onSubmit` only fires on Enter, so without
   * this the flow has no way to see a page picked or a cut placed before the
   * toggle, and the range editor it opens would silently start from
   * nothing.
   */
  onToggleView?: (current: number[]) => void
  width: number
  height: number
}

/**
 * Every page of the document as a small framed cell, with two cursor modes:
 *
 * - `cell` — the cursor sits on a page; space selects it. Used by extract
 *   and delete. A selected page is marked in its top border (`╭─✓─╮`).
 * - `gap` — the cursor sits between two pages; space cuts there. Used by
 *   split. `┃` is a cut, `┆` is an uncut gap. Never `✂` — `string-width`
 *   reports it as one column, but it is a Dingbat that many terminals give
 *   emoji presentation at two, which would shear the row exactly like a
 *   mis-sized card.
 *
 * `selected`/`cuts` are seeded from props once, the way an uncontrolled
 * input takes a `defaultValue` — there is no `onChange`, only `onSubmit` on
 * Enter, so after mount this component is the arrays' sole owner.
 *
 * In gap mode, a row is `cell gap cell gap … cell gap` — every cell gets a
 * gap immediately after it, including a trailing one after the row's last
 * cell that reaches the first page of the next row. That trailing gap is
 * the row-boundary cut point: without it, a page count that does not divide
 * evenly into whole rows would have cut positions no cursor could ever
 * reach. The one row that omits it is whichever row holds the document's
 * very last page, since there is no next page left to cut against. Cursor
 * columns line up with gaps this way too — column `c` in gap mode is always
 * "the gap after cell `c`" — so right-arrow off a row's last gap and
 * left-arrow off a row's first gap simply continue into the neighbouring
 * row rather than clamping, the one place this component's cursor wraps.
 */
export function PageGrid({
  mode,
  pageCount,
  selected: initialSelected,
  cuts: initialCuts,
  onSubmit,
  onCancel,
  onToggleView,
  width,
  height,
}: PageGridProps) {
  const palette = useTheme()
  const { perRow, rowsPerPage, cellWidth } = gridLayout(pageCount, width, height)
  const pagesPerScreen = Math.max(1, perRow * rowsPerPage)
  const totalScreens = Math.max(1, Math.ceil(pageCount / pagesPerScreen))

  const [selectedPages, setSelectedPages] = useState<number[]>(initialSelected)
  const [cutGaps, setCutGaps] = useState<number[]>(initialCuts)
  const [screen, setScreen] = useState(0)
  const [cursor, setCursor] = useState<Cursor>({ row: 0, col: 0 })

  /**
   * `useInput` handlers are synchronous, but `useState` updates are not —
   * several keypresses can be delivered through the same handler closure
   * before React re-renders, so `useState` cannot be the source of truth for
   * what to act on *right now* (see the same comment in `Select.tsx`). These
   * refs are that source of truth; the `useState` pair above exists only to
   * trigger a render with the latest value.
   */
  const selectedRef = useRef(selectedPages)
  const cutsRef = useRef(cutGaps)
  const screenRef = useRef(screen)
  const cursorRef = useRef(cursor)

  const visibleCount = (s: number) =>
    Math.min(pagesPerScreen, Math.max(0, pageCount - s * pagesPerScreen))
  const rowsInScreen = (s: number) => Math.max(1, Math.ceil(visibleCount(s) / perRow))
  const cellsInRow = (r: number, s: number) =>
    Math.max(0, Math.min(perRow, visibleCount(s) - r * perRow))

  /** Whether this row's last cell has a next page to cut against. */
  const hasTrailingGap = (r: number, s: number) => {
    const n = cellsInRow(r, s)
    if (n === 0) return false
    const lastPageIndex = s * pagesPerScreen + r * perRow + (n - 1)
    return lastPageIndex < pageCount - 1
  }

  /** Gaps in this row: one per cell, minus one unless the row has a trailing gap. */
  const gapCount = (r: number, s: number) => {
    const n = cellsInRow(r, s)
    if (n === 0) return 0
    return hasTrailingGap(r, s) ? n : Math.max(0, n - 1)
  }

  const maxCol = (r: number, s: number) => {
    // cell mode: one cursor stop per cell. gap mode: one per gap (see
    // `gapCount` — this is what makes the trailing, row-boundary gap a
    // reachable cursor stop).
    if (mode === 'cell') return Math.max(0, cellsInRow(r, s) - 1)
    return Math.max(0, gapCount(r, s) - 1)
  }

  const clampCursor = (row: number, col: number, s: number): Cursor => {
    const r = Math.min(Math.max(row, 0), rowsInScreen(s) - 1)
    const c = Math.min(Math.max(col, 0), maxCol(r, s))
    return { row: r, col: c }
  }

  const moveCursor = (dRow: number, dCol: number) => {
    const next = clampCursor(
      cursorRef.current.row + dRow,
      cursorRef.current.col + dCol,
      screenRef.current,
    )
    if (next.row === cursorRef.current.row && next.col === cursorRef.current.col) return
    cursorRef.current = next
    setCursor(next)
  }

  const setCursorTo = (next: Cursor) => {
    cursorRef.current = next
    setCursor(next)
  }

  /**
   * Left/right in gap mode continue into the neighbouring row rather than
   * clamping at the row's edge — otherwise the trailing gap at the end of a
   * row (the row-boundary cut point) would be a dead end you could reach
   * but never leave, and the gap at the start of the next row would be
   * unreachable by arrow key at all. Cell mode keeps the plain clamp: every
   * cell already has its own reachable cursor stop, so there is nothing a
   * wrap would add.
   */
  const stepRight = () => {
    if (mode !== 'gap') {
      moveCursor(0, 1)
      return
    }
    const { row, col } = cursorRef.current
    const s = screenRef.current
    if (col < maxCol(row, s)) {
      moveCursor(0, 1)
      return
    }
    if (row < rowsInScreen(s) - 1) setCursorTo({ row: row + 1, col: 0 })
  }

  const stepLeft = () => {
    if (mode !== 'gap') {
      moveCursor(0, -1)
      return
    }
    const { row, col } = cursorRef.current
    const s = screenRef.current
    if (col > 0) {
      moveCursor(0, -1)
      return
    }
    if (row > 0) setCursorTo({ row: row - 1, col: maxCol(row - 1, s) })
  }

  const goToScreen = (s: number) => {
    const next = Math.min(Math.max(s, 0), totalScreens - 1)
    const alreadyHome =
      next === screenRef.current && cursorRef.current.row === 0 && cursorRef.current.col === 0
    // No-op at an end (pgup/pgdn already at the boundary, cursor already
    // home): nothing moved, nothing to report — the same rule `Select.tsx`
    // follows. `g` from elsewhere on screen 0 still needs to land the
    // cursor home, which is why this isn't just `next !== screenRef.current`.
    if (alreadyHome) return
    if (next !== screenRef.current) {
      screenRef.current = next
      setScreen(next)
    }
    const resetCursor = { row: 0, col: 0 }
    cursorRef.current = resetCursor
    setCursor(resetCursor)
  }

  const toggleAll = () => {
    if (mode === 'cell') {
      const all = selectedRef.current.length === pageCount
      const next = all ? [] : Array.from({ length: pageCount }, (_, i) => i)
      selectedRef.current = next
      setSelectedPages(next)
    } else {
      const totalGaps = Math.max(0, pageCount - 1)
      const all = cutsRef.current.length === totalGaps
      const next = all ? [] : Array.from({ length: totalGaps }, (_, i) => i)
      cutsRef.current = next
      setCutGaps(next)
    }
  }

  const toggleCurrent = () => {
    const offset = screenRef.current * pagesPerScreen
    const { row, col } = cursorRef.current
    if (mode === 'cell') {
      if (col >= cellsInRow(row, screenRef.current)) return
      const pageIndex = offset + row * perRow + col
      const next = selectedRef.current.includes(pageIndex)
        ? selectedRef.current.filter((p) => p !== pageIndex)
        : [...selectedRef.current, pageIndex]
      selectedRef.current = next
      setSelectedPages(next)
    } else {
      if (col >= gapCount(row, screenRef.current)) return
      const gapIndex = offset + row * perRow + col
      const next = cutsRef.current.includes(gapIndex)
        ? cutsRef.current.filter((g) => g !== gapIndex)
        : [...cutsRef.current, gapIndex]
      cutsRef.current = next
      setCutGaps(next)
    }
  }

  useInput((input, key) => {
    if (key.leftArrow) stepLeft()
    if (key.rightArrow) stepRight()
    if (key.upArrow) moveCursor(-1, 0)
    if (key.downArrow) moveCursor(1, 0)
    if (input === ' ') toggleCurrent()
    if (input === 'a') toggleAll()
    if ((input === 'r' || input === 'g') && onToggleView) {
      onToggleView(mode === 'cell' ? selectedRef.current : cutsRef.current)
    }
    if (key.pageUp) goToScreen(screenRef.current - 1)
    if (key.pageDown) goToScreen(screenRef.current + 1)
    if (key.return) onSubmit(mode === 'cell' ? selectedRef.current : cutsRef.current)
    if (key.escape && onCancel) onCancel()
  })

  // --- rendering ---

  const selectedSet = new Set(selectedPages)
  const cutsSet = new Set(cutGaps)
  const offset = screen * pagesPerScreen
  const cursorBg = colourProp(palette.selectionBg)
  const border = colourProp(palette.border)

  const dashes = '─'.repeat(Math.max(0, cellWidth - 2))
  const plainTop = `╭${dashes}╮`
  const plainBottom = `╰${dashes}╯`

  // Centres a single-column mark in the top border's inner run, the same
  // width the plain border's dashes fill.
  const innerWidth = Math.max(0, cellWidth - 2)
  const leftPad = Math.max(0, Math.floor((innerWidth - 1) / 2))
  const rightPad = Math.max(0, innerWidth - 1 - leftPad)
  const markedTopLeft = `╭${'─'.repeat(leftPad)}`
  const markedTopRight = `${'─'.repeat(rightPad)}╮`

  const gapSegment = (
    lineKind: 'top' | 'number' | 'bottom',
    r: number,
    c: number,
    gapIndex: number,
    isTrailing: boolean,
  ) => {
    const cursorHere = mode === 'gap' && cursor.row === r && cursor.col === c
    const bg = cursorHere ? cursorBg : undefined
    if (mode === 'gap' && lineKind === 'number') {
      const cut = cutsSet.has(gapIndex)
      const glyph = cut ? '┃' : '┆'
      const glyphColour = cut ? colourProp(palette.accent) : border
      // A trailing gap is a row's last rendered content. Ink trims trailing
      // whitespace from every line (see `Select.tsx`), so a centred
      // " <glyph> " would lose its final space there and shear this row
      // against ones without a trailing gap. Right-aligning it — no
      // trailing space — keeps all three columns; a non-trailing gap can
      // stay centred, since a cell always follows it on the line.
      return isTrailing ? (
        <Text key={`${lineKind}${c}`} backgroundColor={bg}>
          <Text color={border}>{'  '}</Text>
          <Text color={glyphColour}>{glyph}</Text>
        </Text>
      ) : (
        <Text key={`${lineKind}${c}`} backgroundColor={bg}>
          <Text color={border}> </Text>
          <Text color={glyphColour}>{glyph}</Text>
          <Text color={border}> </Text>
        </Text>
      )
    }
    // Border lines: blank for an ordinary gap. The row's trailing gap would
    // otherwise be three whitespace columns at the very end of the line —
    // exactly what Ink's trim removes — vanishing from the printed width
    // entirely rather than just losing one column like the number line
    // above. Dashes avoid that (no invented glyph, no trim) and read as the
    // frame continuing into the next row, which is what a trailing gap is.
    const fill = isTrailing ? '─'.repeat(GAP) : ' '.repeat(GAP)
    return (
      <Text key={`${lineKind}${c}`} backgroundColor={bg} color={border}>
        {fill}
      </Text>
    )
  }

  const buildRow = (r: number): ReactNode => {
    const n = cellsInRow(r, screen)
    if (n <= 0) return null

    const topSegs: ReactNode[] = []
    const numSegs: ReactNode[] = []
    const bottomSegs: ReactNode[] = []

    for (let c = 0; c < n; c++) {
      const pageIndex = offset + r * perRow + c
      const pageNumber = pageIndex + 1
      const cellCursor = mode === 'cell' && cursor.row === r && cursor.col === c
      const cellBg = cellCursor ? cursorBg : undefined
      const isSelected = selectedSet.has(pageIndex)

      topSegs.push(
        isSelected ? (
          <Text key={`t${c}`} backgroundColor={cellBg}>
            <Text color={border}>{markedTopLeft}</Text>
            <Text color={colourProp(palette.ok)}>{SYMBOLS.ok}</Text>
            <Text color={border}>{markedTopRight}</Text>
          </Text>
        ) : (
          <Text key={`t${c}`} backgroundColor={cellBg} color={border}>
            {plainTop}
          </Text>
        ),
      )

      numSegs.push(
        <Text key={`n${c}`} backgroundColor={cellBg}>
          <Text color={border}>{'│'}</Text>
          <Text color={colourProp(palette.fg)}>
            {`${String(pageNumber).padStart(Math.max(0, cellWidth - 3))} `}
          </Text>
          <Text color={border}>{'│'}</Text>
        </Text>,
      )

      bottomSegs.push(
        <Text key={`b${c}`} backgroundColor={cellBg} color={border}>
          {plainBottom}
        </Text>,
      )

      // A gap follows every cell except a row's last one — unless this is
      // gap mode and the row has a trailing gap (see `hasTrailingGap`), in
      // which case the last cell gets one too: the row-boundary cut point.
      const isLastInRow = c === n - 1
      const isTrailing = isLastInRow && mode === 'gap' && hasTrailingGap(r, screen)
      if (!isLastInRow || isTrailing) {
        const gapIndex = pageIndex // the gap right after this page
        topSegs.push(gapSegment('top', r, c, gapIndex, isTrailing))
        numSegs.push(gapSegment('number', r, c, gapIndex, isTrailing))
        bottomSegs.push(gapSegment('bottom', r, c, gapIndex, isTrailing))
      }
    }

    return (
      <Box flexDirection="column" key={`row${r}`}>
        <Text>{topSegs}</Text>
        <Text>{numSegs}</Text>
        <Text>{bottomSegs}</Text>
      </Box>
    )
  }

  const rows = Array.from({ length: rowsInScreen(screen) }, (_, r) => buildRow(r))

  const fileCount = cutGaps.length + 1
  const header =
    mode === 'cell'
      ? `${selectedPages.length} of ${pageCount} selected`
      : `${fileCount} ${fileCount === 1 ? 'file' : 'files'}`

  const footer =
    totalScreens > 1 ? `pages ${offset + 1}–${offset + visibleCount(screen)} of ${pageCount}` : null

  return (
    <Box flexDirection="column">
      <Text color={colourProp(palette.dim)}>{header}</Text>
      <Box flexDirection="column" marginTop={1}>
        {rows}
      </Box>
      {footer ? (
        <Box marginTop={1}>
          <Text color={colourProp(palette.dim)}>{footer}</Text>
        </Box>
      ) : null}
    </Box>
  )
}
