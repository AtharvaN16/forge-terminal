import { Box } from 'ink'
import { createContext, useContext } from 'react'
import { type HistoryBlock, SavedTo } from '../blocks.js'
import { wrapWords } from '../done-art.js'
import { HOME_MARGIN } from '../home-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import type { Palette } from '../theme.js'
import { colourProp } from '../theme.js'
import { endEllipsis } from '../width.js'
import { ErrorLine } from './ErrorLine.js'
import { ErrorPanel, errorPanelRows } from './ErrorPanel.js'

/**
 * What the shell just said, held live for a while before it goes to the
 * scrollback (App's `notices`). Every screen fills the window, so a block
 * `<Static>` prints is already off the top of the screen the moment it is
 * printed; held, it is read where the user is looking. Home draws them under
 * its field; every other screen above its keys (`HintBar`), through here.
 */
export type Notice = Extract<HistoryBlock, { kind: 'note' | 'error' }>

export const isNotice = (block: HistoryBlock): block is Notice =>
  block.kind === 'note' || block.kind === 'error'

/** The notices the screen in front should draw above its keys; home draws its own. */
export const NoticesContext = createContext<readonly Notice[]>([])
export const useNotices = () => useContext(NoticesContext)

/**
 * A note's rows at `width`: each of its lines wrapped, its indent kept (as
 * `/help`'s columns have one), then "saved to" where it has one.
 */
function noteLines(text: string, width: number): string[] {
  return text.split('\n').flatMap((line) => {
    const indent = /^ */.exec(line)?.[0] ?? ''
    const wrapped = wrapWords(line, Math.max(1, width - indent.length))
    return wrapped.length === 0 ? [''] : wrapped.map((l) => indent + l)
  })
}

/** How many rows `Notices` draws for `notices` at `width` (the margin is outside it). */
export function noticeRows(notices: readonly Notice[], width: number, palette: Palette): number {
  const inner = Math.max(8, width - 2 * HOME_MARGIN)
  return notices.reduce(
    (rows, n, i) =>
      rows +
      (i > 0 ? 1 : 0) +
      (n.kind === 'error'
        ? errorPanelRows(n.error, inner, palette).length
        : noteLines(n.text, inner).length + (n.savedTo ? 1 : 0)),
    0,
  )
}

/** The notices, one under another with a blank row between, at home's margin. */
export function Notices({ notices, width }: { notices: readonly Notice[]; width: number }) {
  const palette = useTheme()
  const inner = Math.max(8, width - 2 * HOME_MARGIN)
  return (
    <Box flexDirection="column" flexShrink={0}>
      {notices.map((n, i) => (
        <Box key={n.id} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
          {n.kind === 'error' ? (
            <ErrorPanel error={n.error} width={inner} />
          ) : (
            <Box flexDirection="column" marginLeft={HOME_MARGIN}>
              {noteLines(n.text, inner).map((line, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the lines are positional
                <Text key={j} color={colourProp(palette.dim)}>
                  {line}
                </Text>
              ))}
              {n.savedTo ? <SavedTo output={n.savedTo} width={inner} /> : null}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

/**
 * The newest notice in one row, for a screen with no rows to spare: an error
 * as E5·b's tinted row, a note's first line. The full one is in the
 * scrollback once it goes.
 */
export function NoticeLine({ notices, width }: { notices: readonly Notice[]; width: number }) {
  const palette = useTheme()
  const newest = notices.at(-1)
  if (!newest) return null
  const inner = Math.max(8, width - 2 * HOME_MARGIN)
  if (newest.kind === 'error')
    return (
      <ErrorLine
        title={newest.error.title}
        reason={newest.error.short ?? newest.error.detail}
        width={inner}
      />
    )
  const first = newest.text.split('\n').find((l) => l.trim() !== '') ?? ''
  return (
    <Box marginLeft={HOME_MARGIN}>
      <Text color={colourProp(palette.dim)}>{endEllipsis(first.trim(), inner)}</Text>
    </Box>
  )
}
