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
 * A row is only ever `perRow` cells wide with `GAP` columns between them —
 * the gap *between rows* (the last cell of one row and the first of the
 * next) is not drawn or reachable by the cursor. Rendering it would need a
 * fourth line per row, and `rowsPerPage` is computed as exactly three lines
 * a row (see `gridLayout`). `a` (select/cut everything) still reaches every
 * page or gap in the document regardless of this, since it writes the whole
 * array directly rather than going through the cursor.
 */
export function PageGrid({
  mode,
  pageCount,
  selected: initialSelected,
  cuts: initialCuts,
  onSubmit,
  onCancel,
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
  const maxCol = (r: number, s: number) => {
    const n = cellsInRow(r, s)
    // cell mode: one cursor stop per cell. gap mode: one fewer, since a row
    // of n cells has n - 1 gaps between them.
    return mode === 'cell' ? Math.max(0, n - 1) : Math.max(0, n - 2)
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

  const resetAll = () => {
    if (mode === 'cell') {
      selectedRef.current = []
      setSelectedPages([])
    } else {
      cutsRef.current = []
      setCutGaps([])
    }
  }

  const toggleCurrent = () => {
    const offset = screenRef.current * pagesPerScreen
    const { row, col } = cursorRef.current
    const n = cellsInRow(row, screenRef.current)
    if (mode === 'cell') {
      if (col >= n) return
      const pageIndex = offset + row * perRow + col
      const next = selectedRef.current.includes(pageIndex)
        ? selectedRef.current.filter((p) => p !== pageIndex)
        : [...selectedRef.current, pageIndex]
      selectedRef.current = next
      setSelectedPages(next)
    } else {
      if (col >= Math.max(0, n - 1)) return
      const gapIndex = offset + row * perRow + col
      const next = cutsRef.current.includes(gapIndex)
        ? cutsRef.current.filter((g) => g !== gapIndex)
        : [...cutsRef.current, gapIndex]
      cutsRef.current = next
      setCutGaps(next)
    }
  }

  useInput((input, key) => {
    if (key.leftArrow) moveCursor(0, -1)
    if (key.rightArrow) moveCursor(0, 1)
    if (key.upArrow) moveCursor(-1, 0)
    if (key.downArrow) moveCursor(1, 0)
    if (input === ' ') toggleCurrent()
    if (input === 'a') toggleAll()
    if (input === 'r') resetAll()
    if (input === 'g') goToScreen(0)
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
  ) => {
    const cursorHere = mode === 'gap' && cursor.row === r && cursor.col === c
    const bg = cursorHere ? cursorBg : undefined
    if (mode === 'gap' && lineKind === 'number') {
      const cut = cutsSet.has(gapIndex)
      const glyph = cut ? '┃' : '┆'
      const glyphColour = cut ? colourProp(palette.accent) : border
      return (
        <Text key={`${lineKind}${c}`} backgroundColor={bg}>
          <Text color={border}> </Text>
          <Text color={glyphColour}>{glyph}</Text>
          <Text color={border}> </Text>
        </Text>
      )
    }
    return (
      <Text key={`${lineKind}${c}`} backgroundColor={bg} color={border}>
        {' '.repeat(GAP)}
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

      if (c < n - 1) {
        const gapIndex = pageIndex // the gap right after this page
        topSegs.push(gapSegment('top', r, c, gapIndex))
        numSegs.push(gapSegment('number', r, c, gapIndex))
        bottomSegs.push(gapSegment('bottom', r, c, gapIndex))
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
