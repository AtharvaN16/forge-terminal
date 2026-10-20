import { Box, type DOMElement, measureElement } from 'ink'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { KeyRow } from './Home.js'
import { type Notice, NoticeLine, Notices, noticeRows, useNotices } from './Notices.js'

/**
 * Keys that belong in the footnote, in the order the footnote says them: the
 * mode keys ("1–4", however many modes there are), esc, then quit.
 */
const FOOT_ORDER = ['mode', 'esc', 'ctrl-c'] as const
const footSlot = (key: string): (typeof FOOT_ORDER)[number] | undefined =>
  /^1–\d$/.test(key) ? 'mode' : key === 'esc' || key === 'ctrl-c' ? key : undefined

/**
 * A step's keys, the decided way (F1): what this screen is for as caps at the
 * left, and mode, esc and quit as a quiet footnote at the right edge — under
 * a rule the width of the terminal, on the window's last rows.
 * The rule is the user's own and stays on every key row.
 *
 * Every screen draws its keys through here, so the row is the same
 * everywhere: without a footnote of its own, a footnote key passed among
 * `pairs` moves there; and every row ends `ctrl-c quit`.
 */
export function HintBar({
  pairs,
  foot,
  width,
  above,
  off,
  hint,
}: {
  pairs: Array<[string, string]>
  /**
   * The footnote, when the screen decides it (Working's "esc stop" is a main
   * key there, by design). Left out, it is made from `pairs`: mode, esc and
   * quit move to it, in that order.
   */
  foot?: Array<[string, string]> | undefined
  width: number
  /** One row a blank row above the rule: a note about a key on the screen (Quality's d, N4). */
  above?: ReactNode
  /** Keys among `pairs` that do nothing right now, greyed. */
  off?: readonly string[]
  /**
   * A row in the blank above the rule, as the / menu's "/ menu" hint sits.
   * Something the shell just said takes the row while it shows.
   */
  hint?: ReactNode
}) {
  const palette = useTheme()
  const notices = useNotices()
  /**
   * What the shell just said sits on the keys, out of the spacer, when the
   * screen has the rows for it. Until that is measured — and on a screen
   * that fills the window — the newest takes the blank row above the rule
   * instead, as one line: never more rows than the window has.
   */
  const spacer = useRef<DOMElement | null>(null)
  const [fits, setFits] = useState<readonly Notice[] | null>(null)
  const full = notices.length > 0 && fits === notices
  useEffect(() => {
    if (notices.length === 0 || full || !spacer.current) return
    const free = measureElement(spacer.current).height
    if (free >= noticeRows(notices, width, palette) + 1) setFits(notices)
  })
  const given = foot !== undefined
  const main = given ? pairs : pairs.filter(([key]) => footSlot(key) === undefined)
  const from = foot ?? pairs
  const extra = (foot ?? []).filter(([key]) => footSlot(key) === undefined)
  const footed = FOOT_ORDER.flatMap((slot) => {
    if (slot === 'ctrl-c') return [['ctrl-c', 'quit'] as [string, string]]
    const found = from.find(([key]) => footSlot(key) === slot)
    return found ? [found] : []
  })
  // The spacer takes whatever height the screen has left, so the keys sit on
  // the window's last row on every screen, as home's do — when the boxes
  // above stretch to the frame (each screen's outer Box grows).
  const line = notices.length > 0 && !full
  return (
    <>
      <Box ref={spacer} flexGrow={1} />
      {above ? (
        <Box marginTop={1} flexShrink={0}>
          {above}
        </Box>
      ) : null}
      {full ? (
        <Box marginTop={1} flexShrink={0}>
          <Notices notices={notices} width={width} />
        </Box>
      ) : null}
      <Box width={width} marginTop={line || hint ? 0 : 1} flexDirection="column" flexShrink={0}>
        {line ? <NoticeLine notices={notices} width={width} /> : hint}
        <Text color={colourProp(palette.border)}>{'─'.repeat(width)}</Text>
        <KeyRow main={main} foot={[...extra, ...footed]} width={width} off={off} />
      </Box>
    </>
  )
}
