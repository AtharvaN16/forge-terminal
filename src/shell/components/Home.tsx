import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import stringWidth from 'string-width'
import { COLOUR_SAMPLES, choiceCards } from '../colour/colour-art.js'
import type { CommandList } from '../commands.js'
import {
  brandRows,
  commandRows,
  HOME_MARGIN,
  MODE_KINDS,
  type Row,
  surfaceRows,
  tabRows,
  WORDMARK3,
} from '../home-art.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, type ShellMode } from '../theme.js'
import { middleEllipsis } from '../width.js'

/**
 * The home screen (mockups/flow-parts-2026-10.html, tab 3): the brand band,
 * the drop zone block, the field on its own line, whatever the field has to
 * offer in a list below it, and the keys on the last row under a rule.
 *
 * It fills the terminal's height exactly, so the keys sit on the bottom row
 * and Ink draws it as a full screen — no line below it, no scrolling. What a
 * shorter terminal gives up, in order, is the size of the drop surface, the
 * brand, and then the drop surface itself (`homeLayout`).
 */

/** Rows that are always there: a blank top row, the tabs, a blank, the field and the keys. */
const BASE = 6
/** The brand band and the blank row under it. */
const BRAND = 4
/** The list's blank first row, three entries and the rule above the keys. */
const LIST_MIN = 5
const SURFACE_MAX = 8
const SURFACE_MIN = 4

export interface HomeLayout {
  brand: boolean
  /** Rows of drop surface; 0 when there is no room for one. */
  surface: number
  /** Rows between the field and the keys. */
  list: number
}

export function homeLayout(width: number, height: number): HomeLayout {
  const word = WORDMARK3[0]?.length ?? 0
  const brandFits = width - HOME_MARGIN * 2 - word - 3 >= 2
  if (brandFits) {
    const surface = Math.min(SURFACE_MAX, height - BASE - BRAND - LIST_MIN)
    if (surface >= SURFACE_MIN)
      return { brand: true, surface, list: height - BASE - BRAND - surface }
  }
  const surface = Math.min(SURFACE_MAX, height - BASE - LIST_MIN)
  if (surface >= SURFACE_MIN) return { brand: false, surface, list: height - BASE - surface }
  return { brand: false, surface: 0, list: Math.max(0, height - BASE) }
}

type Pair = [string, string]
export interface KeySet {
  main: Pair[]
  foot: Pair[]
}

/**
 * The key row for the home screen's state. Only keys that do something right
 * now: Tab and the arrows appear with completions to act on, not before.
 */
export function homeKeys({
  typing,
  completions,
  commands,
  colour = false,
}: {
  typing: boolean
  completions: number
  /** The command list is open. */
  commands: boolean
  /** Colour's home: the two cards to choose between, and nothing to send. */
  colour?: boolean
}): KeySet {
  if (commands) {
    return {
      main: [
        ['↵', 'run'],
        ['esc', 'back'],
      ],
      foot: [
        ['↑↓', 'choose'],
        ['type', 'filter'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (typing && completions > 0) {
    return {
      main: [
        ['↵', 'send'],
        ['tab', 'complete'],
      ],
      foot: [
        ['↑↓', 'choose'],
        ['esc', 'clear'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (typing) {
    return {
      main: [['↵', 'send']],
      foot: [
        ['esc', 'clear'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (colour) {
    return {
      main: [
        ['←→', 'choose'],
        ['↵', 'open'],
      ],
      foot: [
        ['1–4', 'mode'],
        ['ctrl-n', 'new'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  // No "/ commands": the tab row says it.
  return {
    main: [['↵', 'send']],
    foot: [
      ['1–4', 'mode'],
      ['esc', 'clear'],
      ['ctrl-n', 'new'],
      ['ctrl-c', 'quit'],
    ],
  }
}

/** One drawn row. Never wraps: the art is laid out to the width already. */
export function Runs({ row }: { row: Row }) {
  return (
    <Box flexShrink={0}>
      <Text wrap="truncate">
        {row.map((run, i) => (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: a row's runs are positional
            key={i}
            color={colourProp(run.fg ?? '')}
            backgroundColor={colourProp(run.bg ?? '')}
            bold={run.bold ?? false}
          >
            {run.text}
          </Text>
        ))}
      </Text>
    </Box>
  )
}

const Gap = () => <Box height={1} flexShrink={0} />

/**
 * The command list where there is no drop surface to swap it into — under
 * the field while a file waits — drawn the same way as on home's panel, on
 * the terminal's own background.
 */
export function CommandMenu({
  width,
  commands,
}: {
  width: number
  commands: CommandList & { selected: number }
}) {
  const palette = useTheme()
  const rows = commandRows({ width, palette, ...commands, rows: 0, max: 12, panel: false })
  return (
    <Box flexDirection="column" flexShrink={0} marginBottom={1}>
      {/* Without the blank rows that pad it on the panel: the field above has its own margin. */}
      {rows.slice(1, -1).map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
        <Runs key={i} row={row} />
      ))}
    </Box>
  )
}

/**
 * Keys as caps on the left — what this screen is for — and everything else as
 * a dim footnote at the right edge (F1, mockup tab 1). A narrow row loses
 * footnote items from its right end; the caps never shrink and the row never
 * wraps.
 */
export function KeyRow({
  main,
  foot,
  width,
  lead = HOME_MARGIN + 1,
}: KeySet & {
  width: number
  /** Where the first key starts: one cell in from the content above it. */
  lead?: number
}) {
  const palette = useTheme()
  const noColour = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
  const capped = palette.keycapBg !== '' && !noColour
  const cap = (key: string) => (capped ? ` ${key} ` : `[${key}]`)

  const left = main.reduce(
    (n, [key, word], i) => n + (i ? 2 : 0) + stringWidth(cap(key)) + 1 + stringWidth(word),
    lead,
  )
  let shown = [...foot]
  // A footnote item with no word is a sentence on its own ("nothing is saved until it is done").
  const note = () => shown.map(([key, word]) => (word ? `${key} ${word}` : key)).join(' · ')
  while (shown.length > 0 && left + 3 + stringWidth(note()) + 1 > width) shown = shown.slice(0, -1)
  const gap = Math.max(1, width - left - stringWidth(note()) - 1)

  return (
    <Box flexShrink={0}>
      <Text wrap="truncate">
        {' '.repeat(lead)}
        {main.map(([key, word], i) => (
          <Text key={key}>
            {i ? '  ' : ''}
            <Text
              backgroundColor={capped ? palette.keycapBg : undefined}
              color={colourProp(palette.fg)}
              bold
            >
              {cap(key)}
            </Text>
            <Text color={colourProp(palette.dim)}>{` ${word}`}</Text>
          </Text>
        ))}
        {' '.repeat(gap)}
        <Text color={colourProp(palette.border)}>{note()}</Text>
      </Text>
    </Box>
  )
}

/** The band's narrowest: wide enough that a short path still reads as a row. */
const BAND_MIN = 34

/**
 * Path completions, as their own list a row clear of the field — never
 * attached to it. The chosen row is the picker's: a band with a `▌` strip in
 * the mode's colour. `rows` is how many entries fit; the window follows the
 * choice.
 */
export function Suggestions({
  items,
  selected,
  width,
  rows = 3,
}: {
  items: string[]
  selected: number
  width: number
  rows?: number
}) {
  const palette = useTheme()
  const indent = ' '.repeat(HOME_MARGIN + 2)
  const room = Math.max(10, width - indent.length * 2)
  const longest = Math.max(0, ...items.map((item) => stringWidth(item)))
  const band = Math.min(room, Math.max(BAND_MIN, longest + 4))
  const visible = Math.max(1, rows)
  const start = Math.min(Math.max(0, selected - visible + 1), Math.max(0, items.length - visible))
  const fill = colourProp(palette.listBand)

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Gap />
      {items.slice(start, start + visible).map((item, i) => {
        const text = middleEllipsis(item, band - 3)
        if (start + i !== selected) {
          return (
            <Text key={item} wrap="truncate">
              {`${indent}  `}
              <Text color={colourProp(palette.dim)}>{text}</Text>
            </Text>
          )
        }
        return (
          <Text key={item} wrap="truncate">
            {indent}
            <Text backgroundColor={fill} color={colourProp(palette.accent)}>
              ▌
            </Text>
            <Text backgroundColor={fill}> </Text>
            <Text backgroundColor={fill} color={colourProp(palette.fg)} bold>
              {text}
            </Text>
            <Text backgroundColor={fill}>
              {' '.repeat(Math.max(0, band - 2 - stringWidth(text)))}
            </Text>
          </Text>
        )
      })}
    </Box>
  )
}

export function Home({
  width,
  height,
  mode,
  typing,
  savesTo,
  field,
  list,
  commands,
  keys,
  colourChoice = 0,
}: {
  width: number
  height: number
  mode: ShellMode
  /** Something is in the field: the block steps back so the field leads. */
  typing: boolean
  /** Where output goes, as the user would type it. */
  savesTo: string
  /** The field — a `Prompt` in its `home` variant. */
  field: ReactNode
  /** What sits under the field, given how many entries it has room for. */
  list?: ((rows: number) => ReactNode) | undefined
  /**
   * The field holds a command: "/ commands" is the active tab and the list
   * takes the drop surface's place, in place — nothing else moves.
   */
  commands?: (CommandList & { selected: number }) | undefined
  keys: KeySet
  /** Colour's home: which card is chosen, Palette (0) or Scale (1). */
  colourChoice?: 0 | 1
}) {
  const palette = useTheme()
  const layout = homeLayout(width, height)
  const art = { width, palette, mode }
  const panel = commands
    ? commandRows({
        ...art,
        ...commands,
        rows: layout.surface,
        // What the list below the field would have had is free while it is open.
        max: layout.surface + layout.list,
      })
    : layout.surface > 0
      ? mode === 'colour' && !typing
        ? choiceCards({ width, palette, selected: colourChoice, samples: COLOUR_SAMPLES })
        : surfaceRows({ ...art, rows: layout.surface, typing, kinds: MODE_KINDS[mode] })
      : []

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Gap />
      {layout.brand ? (
        <>
          {brandRows(art).map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows of art
            <Runs key={`brand${i}`} row={row} />
          ))}
          <Gap />
        </>
      ) : null}
      {tabRows({
        ...art,
        savesTo,
        // Colour writes no files: what it makes goes to the clipboard.
        ...(mode === 'colour' ? { right: { label: 'copies to', value: 'clipboard' } } : {}),
        commands: commands !== undefined,
      }).map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows of art
        <Runs key={`tabs${i}`} row={row} />
      ))}
      {panel.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows of art
        <Runs key={`surface${i}`} row={row} />
      ))}
      <Gap />
      {/* Colour's home has nothing to type until something is: its field
          shows once `/`, `#` or a drop has put text in it. */}
      <Box flexShrink={0}>{mode === 'colour' && !typing ? <Text> </Text> : field}</Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {list?.(Math.max(1, layout.list - 2))}
      </Box>
      {/* The rule takes the list's last row, so the layout is unchanged. */}
      <Text color={colourProp(palette.border)}>{'─'.repeat(width)}</Text>
      <KeyRow {...keys} width={width} />
    </Box>
  )
}
