import { Box } from 'ink'
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import type { BarChip, Trail } from '../bar-art.js'
import { menuHintRow } from '../home-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeGradient, type Palette } from '../theme.js'
import { HeaderBar } from './HeaderBar.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'

/**
 * The / menu as a popup (decided 2026-10-17, mockups/transcribe-2026-10-round2.html,
 * "/ menu" 1–7). Typing / on home opens a box over the screen, one column in
 * from each side, with no line round it, only its fill: the hatched bar with
 * the menu's chip (and, inside a setting, its name), a blank row, the list or
 * the setting, a blank row, and the popup's own field at the foot: home's
 * filled field, closing the box (F). Under the
 * box, the "/ menu" hint lit gold, then the key row for whatever is showing.
 *
 * A setting opened from the list is drawn inside the box, its own content
 * and keys unchanged: it draws its bar with `ScreenBar` and its keys with
 * `ScreenKeys`, which here leave the bar to the popup and hand the keys to
 * the popup's key row, and on their own (first-run /theme) draw as before.
 */

type Keys = { pairs: Array<[string, string]>; foot?: Array<[string, string]> | undefined }

const InMenu = createContext<((keys: Keys) => void) | null>(null)

/** Whether this is drawn inside the popup, for a setting laid out other than with `ScreenBar`. */
export const useInMenu = () => useContext(InMenu) !== null

/** The menu's chip: its gold, and the gold hatching every setting's bar has. */
export const menuChip = (p: Palette): BarChip => ({
  label: 'menu',
  colour: p.brand,
  stops: modeGradient(p, 'menu'),
})

/** A setting's header bar, or nothing inside the popup, which draws its own with the setting's name. */
export function ScreenBar(props: { chip: BarChip; trail: Trail; width: number; drift?: boolean }) {
  if (useContext(InMenu)) return null
  return (
    <Box marginBottom={1}>
      <HeaderBar mode="convert" {...props} />
    </Box>
  )
}

/** A setting's key row, or, inside the popup, its keys given to the popup's key row. */
export function ScreenKeys({
  pairs,
  foot,
  width,
}: Keys & {
  width: number
}) {
  const report = useContext(InMenu)
  const said = JSON.stringify([pairs, foot])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `said` stands for pairs and foot
  useEffect(() => {
    report?.({ pairs, foot })
  }, [report, said])
  if (report) return null
  return <HintBar width={width} pairs={pairs} foot={foot} />
}

/**
 * The box's edge (mockups/kinds-2026-10.html, M1): no line, the ring is the
 * fill alone, the same footprint. Where there is no fill to show the box by
 * (no colour), the rounded line stays.
 */
const NO_LINE = {
  topLeft: ' ',
  top: ' ',
  topRight: ' ',
  left: ' ',
  bottomLeft: ' ',
  bottom: ' ',
  bottomRight: ' ',
  right: ' ',
}

/** Rows the popup takes above the hint, the key row's gap, its rule and its keys. */
const BELOW = 3

export function MenuPopup({
  width,
  height,
  title,
  body,
  field,
  keys,
}: {
  width: number
  height: number
  /** The setting showing, named at the end of the bar; none on the list. */
  title?: string
  body: ReactNode
  field: ReactNode
  /** The list's keys; a setting gives its own through `ScreenKeys`. */
  keys: Keys
}) {
  const palette = useTheme()
  // A setting's keys, kept with the setting that gave them: back on the list,
  // or on another setting before it has said its own, they are not shown.
  const [given, setGiven] = useState<{ title: string; keys: Keys }>()
  const provided = useMemo(
    () => (title ? (keys: Keys) => setGiven({ title, keys }) : null),
    [title],
  )
  const shown = title && given?.title === title ? given.keys : keys
  const inner = Math.max(20, width - 6)
  const boxHeight = Math.max(8, height - BELOW)
  const fill = palette.selectionBg || undefined
  const edgeProps = fill
    ? ({ borderStyle: NO_LINE, borderBackgroundColor: colourProp(fill) } as const)
    : ({ borderStyle: 'round' } as const)
  // F (mockups/menu-field-2026-10.html, 2026-10-19): the field is home's
  // own — a filled block three rows tall, edge to edge of the box and closing
  // it at the bottom, the marker in the list's column. Without a fill to show
  // the block by, it stays a line inside the box, as before.
  const shelf = palette.shelf || undefined
  const block = fill !== undefined && shelf !== undefined
  return (
    <Box flexDirection="column" width={width} minHeight={height}>
      <Box
        marginLeft={1}
        width={width - 2}
        height={block ? boxHeight - 3 : boxHeight}
        {...edgeProps}
        {...(block ? { borderBottom: false } : {})}
        flexDirection="column"
        paddingX={1}
        {...(fill ? { backgroundColor: fill } : {})}
      >
        <HeaderBar
          mode="convert"
          chip={menuChip(palette)}
          trail={{ answers: [], current: title ?? '' }}
          width={inner}
        />
        <Text> </Text>
        <Box flexDirection="column" flexGrow={1}>
          <InMenu.Provider value={provided}>{body}</InMenu.Provider>
        </Box>
        <Text> </Text>
        {block ? null : field}
      </Box>
      {block ? (
        <Box
          marginLeft={1}
          width={width - 2}
          backgroundColor={shelf}
          paddingY={1}
          paddingLeft={2}
          flexShrink={0}
        >
          {field}
        </Box>
      ) : null}
      <HintBar
        width={width}
        pairs={shown.pairs}
        foot={shown.foot}
        hint={<Runs row={menuHintRow({ palette, width, open: true })} />}
      />
    </Box>
  )
}
