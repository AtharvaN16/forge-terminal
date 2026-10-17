import { Box } from 'ink'
import { cloneElement, isValidElement, type ReactNode, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { COLOUR_CARD_KEYS, COLOUR_SAMPLES, choiceCards } from '../colour/colour-art.js'
import type { CommandList } from '../commands.js'
import {
  brandIntro,
  brandRows,
  commandRows,
  DROP_RING_MS,
  folderCardOnDots,
  HOME_MARGIN,
  INTRO_MS,
  MODE_KINDS,
  type Row,
  stagedCardRows,
  stagedListRows,
  surfaceRows,
  tabRows,
  underRow,
  WORDMARK3,
} from '../home-art.js'
import {
  blendRows,
  easeOut,
  fadedPalette,
  motionEnabled,
  useBlendedRows,
  useElapsed,
  useTween,
} from '../motion.js'
import type { StagedView, UnderField } from '../stage.js'
import { Text } from '../Text.js'
import { ThemeProvider, useTheme } from '../ThemeContext.js'
import { colourProp, MODE_KEYS, menuPalette, type ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { folderCardLines } from '../watch-art.js'
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

/** Rows that are always there: a blank top row, the tabs, the field's shelf (three rows) and the keys. */
const BASE = 7
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

/**
 * `noteRows`: a note under the field that the list must hold (a failed run's
 * E5 panel), with its blank row above and the rule below; the drop surface
 * gives up what the list lacks for it.
 */
export function homeLayout(width: number, height: number, noteRows = 0): HomeLayout {
  const listMin = Math.max(LIST_MIN, noteRows + 2)
  const word = WORDMARK3[0]?.length ?? 0
  const brandFits = width - HOME_MARGIN * 2 - word - 3 >= 2
  if (brandFits) {
    const surface = Math.min(SURFACE_MAX, height - BASE - BRAND - listMin)
    if (surface >= SURFACE_MIN)
      return { brand: true, surface, list: height - BASE - BRAND - surface }
  }
  const surface = Math.min(SURFACE_MAX, height - BASE - listMin)
  if (surface >= SURFACE_MIN) return { brand: false, surface, list: height - BASE - surface }
  return { brand: false, surface: 0, list: Math.max(0, height - BASE) }
}

type Pair = [string, string]
export interface KeySet {
  main: Pair[]
  foot: Pair[]
}

/**
 * The mode keys on an empty field: the digits and ←→, which step through the
 * modes in tab order (decided 2026-10-13). Said on the key row because a key
 * nobody is told about is a key nobody uses.
 */
const MODE_ARROWS = `${MODE_KEYS} ←→`

/**
 * The key row for the home screen's state. Only keys that do something right
 * now: Tab and the arrows appear with completions to act on, not before.
 */
export function homeKeys({
  typing,
  completions,
  menu,
  colour = false,
  staged,
}: {
  typing: boolean
  completions: number
  /** The menu is open. */
  menu: boolean
  /** Colour's home: the three cards to choose between, and nothing to send. */
  colour?: boolean
  /** Files are staged: how many, and ↵'s word for them (`stagedVerb`); null when ↵ does nothing. */
  staged?: { count: number; verb: string | null } | undefined
}): KeySet {
  if (menu) {
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
      main: [[COLOUR_CARD_KEYS.join(' ').toUpperCase(), 'open']],
      foot: [
        [MODE_ARROWS, 'mode'],
        ['ctrl-n', 'new'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (staged && staged.count > 0) {
    if (staged.verb === null) {
      return {
        main: [['esc', 'clear']],
        foot: [
          [MODE_ARROWS, 'mode'],
          ['ctrl-c', 'quit'],
        ],
      }
    }
    return {
      main: [['↵', staged.verb]],
      foot: [
        ['esc', 'clear'],
        [MODE_ARROWS, 'mode'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  // No "/ menu": the tab row says it.
  return {
    main: [['↵', 'send']],
    foot: [
      [MODE_ARROWS, 'mode'],
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
  pressed,
  off = [],
}: KeySet & {
  width: number
  /** Where the first key starts: one cell in from the content above it. */
  lead?: number
  /** A key just pressed, drawn inverted for a moment so the press shows (M6b). */
  pressed?: string | undefined
  /** Keys that do nothing right now, greyed: Quality's ↵ where nothing would be written (E3). */
  off?: readonly string[]
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
              backgroundColor={
                capped ? (key === pressed ? palette.fg : palette.keycapBg) : undefined
              }
              color={colourProp(
                key === pressed ? palette.canvas : off.includes(key) ? palette.border : palette.fg,
              )}
              bold={!off.includes(key)}
            >
              {cap(key)}
            </Text>
            <Text
              color={colourProp(
                key === pressed ? palette.fg : off.includes(key) ? palette.border : palette.dim,
              )}
            >{` ${word}`}</Text>
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

/** How long a mode change takes to fade across home (M1b). */
const MODE_FADE_MS = 200
/** How long the tabs take to come up at launch, from half way through the band (M8b); done before it is. */
const INTRO_TABS_MS = 400

export function Home({
  width,
  height,
  mode,
  typing,
  field,
  list,
  commands,
  staged,
  under,
  note,
  noteRows,
  keys,
  colourChoice = 0,
  intro = false,
  update,
}: {
  width: number
  height: number
  mode: ShellMode
  /** Something is in the field: the block steps back so the field leads. */
  typing: boolean
  /** The field — a `Prompt` in its `home` variant. */
  field: ReactNode
  /** What sits under the field, given how many entries it has room for. */
  list?: ((rows: number) => ReactNode) | undefined
  /**
   * The field holds a command: "/ menu" is the active tab and the list
   * takes the drop surface's place, in place — nothing else moves.
   */
  commands?: (CommandList & { selected: number }) | undefined
  /** What is staged: one file draws the card on the surface, several the list. */
  staged?: StagedView | undefined
  /** The row under the field while something is staged: the red left-out line, or a note. */
  under?: UnderField | undefined
  /**
   * A refusal of what was just typed or dropped (an `ErrorLine`), under the
   * field with a blank row above it. It takes its two rows from the list's,
   * and the list is not drawn while it is up.
   */
  note?: ReactNode
  /** The note's height where it may not fit the list as it is (see `homeLayout`). */
  noteRows?: number | undefined
  keys: KeySet
  /** Colour's home: which card is chosen, Extract (0), Scale (1) or Palette (2). */
  colourChoice?: 0 | 1 | 2
  /**
   * The session's first home (M8b): the band draws itself in as it mounts and
   * the tabs fade up under it, once. Any key cuts it short.
   */
  intro?: boolean
  /** A newer Forge (N1): the band's baseline says "/update is available ·" before the version. */
  update?: string | undefined
}) {
  const palette = useTheme()
  const layout = homeLayout(width, height, noteRows)
  const art = { width, palette, mode }
  // The drop surface ripples (M1) only while it is all that is on the panel
  // and nothing is typed; anything else holds it still, and it starts again
  // from empty when the panel is bare once more.
  const bare = !commands && !staged && !typing && mode !== 'colour' && layout.surface > 0
  const ripple = useElapsed(bare && motionEnabled(palette.name))
  // A file that has just landed runs one ring through the card's dots (M2a).
  const landed = staged?.folder
    ? staged.fresh > 0
      ? staged.folder.name
      : null
    : staged && staged.files.length === 1 && staged.fresh > 0
      ? (staged.files[0]?.name ?? null)
      : null
  const ringAt = useTween(landed, DROP_RING_MS, { enabled: motionEnabled(palette.name) })
  const ring = landed !== null && ringAt < 1 ? ringAt : undefined
  const panel = commands
    ? commandRows({
        ...art,
        ...commands,
        rows: layout.surface,
        // What the list below the field would have had is free while it is
        // open — less its last row, which the rule takes (see below). Past
        // that the list scrolls rather than pushing the rule off the screen.
        max: layout.surface + layout.list - 1,
      })
    : layout.surface > 0
      ? mode === 'colour' && !typing
        ? choiceCards({
            width,
            palette,
            selected: colourChoice,
            samples: COLOUR_SAMPLES,
            rows: layout.surface,
          })
        : staged?.folder
          ? folderCardOnDots({
              ...art,
              rows: layout.surface,
              ring,
              card: folderCardLines({
                palette,
                mode,
                name: staged.folder.name,
                lines: staged.folder.lines,
                width: width - 2 * HOME_MARGIN - 6,
              }),
            })
          : staged && staged.files.length === 1 && staged.files[0]
            ? stagedCardRows({ ...art, rows: layout.surface, file: staged.files[0], ring })
            : staged && staged.files.length > 1
              ? stagedListRows({ ...art, rows: layout.surface, view: staged })
              : surfaceRows({
                  ...art,
                  rows: layout.surface,
                  typing,
                  kinds: MODE_KINDS[mode],
                  ripple,
                })
      : []

  // The row under the field. With no room for a panel the staged headline
  // takes it, so what is staged is still said.
  const first = staged?.files[0]
  const headline: Row | null =
    staged && first && layout.surface === 0
      ? [
          { text: ' '.repeat(HOME_MARGIN + 2) },
          staged.folder
            ? { text: staged.folder.name, fg: palette.fg, bold: true }
            : staged.files.length === 1
              ? { text: first.name, fg: palette.fg, bold: true }
              : { text: staged.headline, fg: palette.fg, bold: true },
          staged.files.length === 1
            ? { text: ` · ${first.size}`, fg: palette.dim }
            : { text: `   ${staged.total}`, fg: palette.border },
        ]
      : null
  const below: Row | null = under ? underRow({ width, palette, under }) : headline

  // A mode change fades the band, the tabs and the panel from one mode's
  // colours to the next's (M1b); nothing else that changes here fades.
  const [skipped, setSkipped] = useState(false)
  const introAt =
    INTRO_MS *
    useTween('intro', INTRO_MS, {
      enabled: intro && !skipped && motionEnabled(palette.name),
      onMount: true,
    })
  const introducing = introAt < INTRO_MS
  useKeys(() => setSkipped(true), { isActive: introducing })
  const resting = layout.brand ? brandRows({ ...art, menu: commands !== undefined, update }) : []
  const brand = introducing
    ? brandIntro(resting, easeOut(introAt / INTRO_MS) * (width + 8), palette)
    : resting
  const tabsAtRest = tabRows({
    ...art,
    menu: commands !== undefined,
  })
  // The tabs come up out of the background as the band's edge passes them.
  const tabsIn = Math.max(0, Math.min(1, (introAt - INTRO_MS * 0.5) / INTRO_TABS_MS))
  const tabs = introducing
    ? tabsAtRest.map((row) =>
        blendRows([], row, tabsIn, { canvas: palette.canvas, fg: palette.fg }),
      )
    : tabsAtRest
  const faded = useBlendedRows(mode, [...brand, ...tabs, ...panel], MODE_FADE_MS, {
    enabled: motionEnabled(palette.name),
    canvas: palette.canvas,
    fg: palette.fg,
  })
  // Colour's home has no field: going to or from it, the field fades with
  // the panel — out over the first half, in over the second — rather than
  // going or coming at once while the rest is still fading (M1b).
  const fieldless = (m: ShellMode) => m === 'colour' && !typing
  const modes = useRef({ now: mode, before: mode })
  if (modes.current.now !== mode) modes.current = { now: mode, before: modes.current.now }
  const fieldAt = easeOut(useTween(mode, MODE_FADE_MS, { enabled: motionEnabled(palette.name) }))
  const crossing = fieldAt < 1 && fieldless(modes.current.before) !== fieldless(mode)
  const fieldShows = !fieldless(crossing && fieldAt < 0.5 ? modes.current.before : mode)
  // Fading out, it is the field colour's home does not have: shown, not typed into.
  const leaving = crossing && fieldless(mode)
  const fieldNow =
    leaving && isValidElement<{ isActive?: boolean }>(field)
      ? cloneElement(field, { isActive: false })
      : field
  const fieldPalette = crossing
    ? fadedPalette(palette, palette.canvas, Math.abs(1 - 2 * fieldAt))
    : palette

  const shownBrand = faded.slice(0, brand.length)
  const shownTabs = faded.slice(brand.length, brand.length + tabs.length)
  const shownPanel = faded.slice(brand.length + tabs.length)

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Gap />
      {layout.brand ? (
        <>
          {shownBrand.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows of art
            <Runs key={`brand${i}`} row={row} />
          ))}
          <Gap />
        </>
      ) : null}
      {shownTabs.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows of art
        <Runs key={`tabs${i}`} row={row} />
      ))}
      {shownPanel.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows of art
        <Runs key={`surface${i}`} row={row} />
      ))}
      {/* Colour's home has nothing to type until something is: its field
          shows once `/`, `#` or a drop has put text in it. */}
      <Box flexShrink={0}>
        {!fieldShows ? (
          <Box height={3} />
        ) : commands ? (
          // While a command is typed the field's marker is the menu's gold.
          <ThemeProvider palette={menuPalette(palette)}>{field}</ThemeProvider>
        ) : crossing ? (
          <ThemeProvider palette={fieldPalette}>{fieldNow}</ThemeProvider>
        ) : (
          field
        )}
      </Box>
      {below ? (
        <>
          <Gap />
          <Runs row={below} />
        </>
      ) : null}
      {note ? (
        <>
          <Gap />
          {note}
        </>
      ) : null}
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {note ? null : list?.(Math.max(1, layout.list - 2 - (below ? 2 : 0)))}
      </Box>
      {/* The rule takes the list's last row, so the layout is unchanged. */}
      <Text color={colourProp(palette.border)}>{'─'.repeat(width)}</Text>
      <KeyRow {...keys} width={width} />
    </Box>
  )
}
