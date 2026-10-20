import { Box } from 'ink'
import { cloneElement, isValidElement, type ReactNode, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { COLOUR_CARD_KEYS, COLOUR_SAMPLES, choiceCards } from '../colour/colour-art.js'
import {
  askRows,
  brandIntro,
  brandRows,
  DROP_RING_MS,
  folderCardOnDots,
  formatRows,
  HOME_MARGIN,
  INTRO_MS,
  MODE_DROP_TITLES,
  MODE_FORMATS,
  MODE_KINDS,
  MODE_NOTES,
  menuHintRow,
  type Row,
  type SuggestionItem,
  searchingRows,
  stagedCardRows,
  stagedListRows,
  suggestionRows,
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
import { keyIsDown } from '../pressed-key.js'
import type { StagedView, UnderField } from '../stage.js'
import { Text } from '../Text.js'
import { ThemeProvider, useTheme } from '../ThemeContext.js'
import { colourProp, MODE_KEYS, type ShellMode } from '../theme.js'
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
  colour = false,
  staged,
  formats = false,
  asking = false,
}: {
  typing: boolean
  completions: number
  /** Colour's home: the three cards to choose between, and nothing to send. */
  colour?: boolean
  /** Files are staged: how many, and ↵'s word for them (`stagedVerb`); null when ↵ does nothing. */
  staged?: { count: number; verb: string | null } | undefined
  /** Tab lists the supported formats here: a bare home in a mode that has a list. */
  formats?: boolean
  /** The drop area asks whether to search the Mac by name: ↵ yes, esc not now. */
  asking?: boolean
}): KeySet {
  if (asking) {
    return {
      main: [
        ['↵', 'search'],
        ['esc', 'not now'],
      ],
      foot: [['ctrl-c', 'quit']],
    }
  }
  // ↵ is said in the field, "enter send", once something is typed (2026-10-19);
  // an empty field has nothing to send. Typing, esc clear is a key here; with something
  // staged it is on the row above, beside "/ menu" (`menuHintRow`).
  if (typing && completions > 0) {
    return {
      main: [
        ['esc', 'clear'],
        ['tab', 'complete'],
      ],
      foot: [
        ['↑↓', 'choose'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (typing) {
    return {
      main: [['esc', 'clear']],
      foot: [['ctrl-c', 'quit']],
    }
  }
  if (colour) {
    return {
      main: [[COLOUR_CARD_KEYS.join(' ').toUpperCase(), 'open']],
      foot: [
        [MODE_ARROWS, 'mode'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  if (staged && staged.count > 0) {
    return {
      main: staged.verb === null ? [] : [['↵', staged.verb]],
      foot: [
        [MODE_ARROWS, 'mode'],
        ['ctrl-c', 'quit'],
      ],
    }
  }
  // No "/ menu": the tab row says it.
  return {
    main: [],
    foot: [
      ...(formats ? [['tab', 'supported formats'] as Pair] : []),
      [MODE_ARROWS, 'mode'],
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
 * Keys as caps on the left — what this screen is for — and everything else as
 * a dim footnote at the right edge (F1, mockup tab 1). A narrow row loses
 * footnote items from its right end; the caps never shrink and the row never
 * wraps.
 */
/**
 * The rule over a key row: margin to margin, the width home's band and drop
 * zone run (2026-10-20 — the home screen's margins are the app's).
 */
export function KeyRule({ width }: { width: number }) {
  const palette = useTheme()
  return (
    <Text color={colourProp(palette.border)}>
      {' '.repeat(HOME_MARGIN)}
      {'─'.repeat(Math.max(0, width - 2 * HOME_MARGIN))}
    </Text>
  )
}

export function KeyRow({
  main,
  foot,
  width,
  lead = HOME_MARGIN,
  pressed,
  on = [],
  off = [],
  note,
}: KeySet & {
  width: number
  /** A mode's standing caveat, in the app's orange (`larger`) at the row's left edge after the keys; dropped where it does not fit. */
  note?: string | undefined
  /**
   * Where the first key's cap starts: on the margin, the column the content
   * above starts on (2026-10-19; it was a cell in, which nothing called for).
   */
  lead?: number
  /** A key just pressed, drawn down for a moment so the press shows (M6b). */
  pressed?: string | undefined
  /**
   * Keys held down while what they opened is showing: Tab, while the supported
   * formats are listed. Drawn as a pressed key is — one look for both
   * (2026-10-20, B): the key alone in the brand's orange, its words as they were.
   */
  on?: readonly string[]
  /** Keys that do nothing right now, greyed: Quality's ↵ where nothing would be written (E3). */
  off?: readonly string[]
}) {
  const palette = useTheme()
  const noColour = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
  const capped = palette.keycapBg !== '' && !noColour
  const cap = (key: string) => (capped ? ` ${key} ` : `[${key}]`)
  const isDown = (key: string) =>
    !off.includes(key) && (key === pressed || on.includes(key) || keyIsDown(key))

  const left = main.reduce(
    (n, [key, word], i) => n + (i ? 2 : 0) + stringWidth(cap(key)) + 1 + stringWidth(word),
    lead,
  )
  let shown = [...foot]
  // A footnote item with no word is a sentence on its own ("nothing is saved until it is done").
  const footText = () => shown.map(([key, word]) => (word ? `${key} ${word}` : key)).join(' · ')
  // The note only where the whole footnote still fits beside it. The
  // footnote ends on the margin, the block's last column.
  const noteWidth = note ? (main.length > 0 ? 2 : 0) + stringWidth(note) : 0
  const said =
    note !== undefined && left + noteWidth + 1 + stringWidth(footText()) + HOME_MARGIN <= width
  while (
    shown.length > 0 &&
    left + (said ? noteWidth + 1 : 3) + stringWidth(footText()) + HOME_MARGIN > width
  )
    shown = shown.slice(0, -1)
  const gap = Math.max(
    1,
    width - left - (said ? noteWidth : 0) - stringWidth(footText()) - HOME_MARGIN,
  )

  return (
    <Box flexShrink={0}>
      <Text wrap="truncate">
        {' '.repeat(lead)}
        {main.map(([key, word], i) => (
          <Text key={key}>
            {i ? '  ' : ''}
            <Text
              backgroundColor={capped ? palette.keycapBg : undefined}
              color={colourProp(
                isDown(key) ? palette.brand : off.includes(key) ? palette.border : palette.fg,
              )}
              bold={!off.includes(key) || isDown(key)}
              // No fill to colour: without colour the key is reversed instead.
              inverse={!capped && isDown(key)}
            >
              {cap(key)}
            </Text>
            <Text
              color={colourProp(off.includes(key) ? palette.border : palette.dim)}
            >{` ${word}`}</Text>
          </Text>
        ))}
        {said ? (
          <Text color={colourProp(palette.larger)}>{`${main.length > 0 ? '  ' : ''}${note}`}</Text>
        ) : null}
        {' '.repeat(gap)}
        {/* The footnote's keys bright, what they do faded (2026-10-19); an item
            with no word is a sentence, faded whole. */}
        {shown.map(([key, word], i) => (
          <Text key={`${key}${word}`}>
            {i ? <Text color={colourProp(palette.border)}>{' · '}</Text> : null}
            <Text
              color={colourProp(isDown(key) ? palette.brand : word ? palette.fg : palette.border)}
              bold={isDown(key)}
              inverse={!capped && isDown(key)}
            >
              {key}
            </Text>
            {word ? <Text color={colourProp(palette.border)}>{` ${word}`}</Text> : null}
          </Text>
        ))}
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
  staged,
  under,
  note,
  noteRows,
  keys,
  colourChoice = 0,
  intro = false,
  update,
  formats = false,
  suggest,
  ask,
  searching = false,
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
  /** ? is held: the drop surface lists the supported formats in place of its dots. */
  formats?: boolean
  /** What the field suggests while something is typed: listed on the drop surface (S2). */
  suggest?: { items: readonly SuggestionItem[]; selected: number } | undefined
  /** A question on the drop surface while a name is typed: whether to search the Mac (P2). */
  ask?: { title: string; body: string } | undefined
  /** A name is being looked for: the drop surface says so (L1). */
  searching?: boolean
}) {
  const palette = useTheme()
  const layout = homeLayout(width, height, noteRows)
  const art = { width, palette, mode }
  // The drop surface ripples (M1) only while it is all that is on the panel
  // and nothing is typed; anything else holds it still, and it starts again
  // from empty when the panel is bare once more.
  const bare = !staged && !typing && !formats && mode !== 'colour' && layout.surface > 0
  const ripple = useElapsed(bare && motionEnabled(palette.name))
  // The searching line's spinner turns while it shows; still where motion is off.
  const spun = useElapsed(typing && searching && motionEnabled(palette.name), 80)
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
  const panel =
    layout.surface > 0
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
          : typing && ask
            ? askRows({ width, palette, rows: layout.surface, ...ask })
            : typing && searching
              ? searchingRows({
                  ...art,
                  rows: layout.surface,
                  glyph:
                    SPINNER_FRAMES[Math.floor((spun ?? 0) / 80) % SPINNER_FRAMES.length] ?? '⠋',
                })
              : typing && suggest && suggest.items.length > 0
                ? suggestionRows({ ...art, rows: layout.surface, ...suggest })
                : formats && !staged && MODE_FORMATS[mode]
                  ? formatRows({
                      ...art,
                      rows: layout.surface,
                      kinds: MODE_FORMATS[mode] ?? [],
                    })
                  : staged && staged.files.length === 1 && staged.files[0]
                    ? stagedCardRows({ ...art, rows: layout.surface, file: staged.files[0], ring })
                    : staged && staged.files.length > 1
                      ? stagedListRows({ ...art, rows: layout.surface, view: staged })
                      : surfaceRows({
                          ...art,
                          rows: layout.surface,
                          // Never faded for typing (2026-10-19): the drop area
                          // keeps its strength whatever is in the field.
                          typing: false,
                          kinds: MODE_KINDS[mode],
                          ...(MODE_DROP_TITLES[mode] ? { title: MODE_DROP_TITLES[mode] } : {}),
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
  const resting = layout.brand ? brandRows({ ...art, update }) : []
  const brand = introducing
    ? brandIntro(resting, easeOut(introAt / INTRO_MS) * (width + 8), palette)
    : resting
  const tabsAtRest = tabRows(art)
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
      {/* "/ menu" at the right while the field is empty, and "esc clear" at
          the left while something is staged. Typing — a path or a command —
          the list below the field needs the row, and esc clear is on the key
          row beside ↵ send. */}
      {typing ? null : (
        <Runs
          row={menuHintRow({
            palette,
            width,
            open: false,
            clear: staged !== undefined,
          })}
        />
      )}
      {/* The rule takes the list's last row, so the layout is unchanged. */}
      <KeyRule width={width} />
      <KeyRow
        {...keys}
        width={width}
        on={formats ? ['tab'] : []}
        note={typing ? undefined : MODE_NOTES[mode]}
      />
    </Box>
  )
}
