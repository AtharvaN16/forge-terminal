import { dirname } from 'node:path'
import { Box } from 'ink'
import { FORMATS } from '../../core/formats.js'
import type { Result } from '../../core/types.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import type { Trail } from '../bar-art.js'
import { type DoneFacts, doneBody, doneLayout, doneNotes } from '../done-art.js'
import { blank, HOME_MARGIN, type Row, type Run, width as widthOf } from '../home-art.js'
import { easeOut, motionEnabled, PRESS_MS, useTween } from '../motion.js'
import { keyIsDown } from '../pressed-key.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { HeaderBar } from './HeaderBar.js'
import { KeyRow, KeyRule, Runs } from './Home.js'
import { NoticeLine, Notices, noticeRows, useNotices } from './Notices.js'

/**
 * Done (round 24, mockups/done-2026-10-round18.html): what a single-file
 * convert or compress leaves on screen. The header bar's trail ends in
 * "Done" — and says the folder, so the body does not; under it, the strip
 * with the formats and the change, one bar sized by bytes (see
 * `done-art.ts`) and the two sizes, then any offer or warning low above the
 * keys. No file card: the bar is the file.
 *
 * `DoneScreen` fills the terminal's height, as home does, so the keys sit on
 * the bottom row. `DoneRecord` is the compact body without the padding and
 * the keys, for the scrollback once the screen is left — and with the folder
 * under it, since the header that said it is gone (audit #9).
 */

/** What the panels say about a convert result. */
export function doneFacts(result: Result, mode: ShellMode): DoneFacts {
  const { job, outputBytes } = result
  if (job.op !== 'convert') throw new Error(`Done cannot draw a "${job.op}" result`)
  const source = job.sources[0]
  const output = job.outputs[0]
  if (!source || output === undefined) throw new Error('Done needs a source and an output')
  return {
    mode,
    before: {
      format: FORMATS[source.format]?.label ?? source.format.toUpperCase(),
      name: displayName(source.path),
      bytes: source.bytes,
    },
    after: {
      format: FORMATS[job.target]?.label ?? job.target.toUpperCase(),
      name: displayName(output),
      bytes: outputBytes,
    },
  }
}

/**
 * The bar draws itself once as the screen opens (M5a): over BAR_MS a smaller
 * file's band pulls back from the old length to the new one, or a larger
 * file's growth pushes out; the change's words fade in over its last part.
 */
const BAR_MS = 520
const LABEL_FROM = 480
const LABEL_MS = 140
const DRAW_MS = LABEL_FROM + LABEL_MS

const Blank = ({ rows = 1 }: { rows?: number }) =>
  rows > 0 ? <Box height={rows} flexShrink={0} /> : null

/** The body's rows; an empty one is a blank row. */
function Body({ rows }: { rows: Row[] }) {
  return (
    <>
      {rows.map((row, i) => {
        const key = `row-${i}`
        return row.length === 0 ? <Blank key={key} /> : <Runs key={key} row={row} />
      })}
    </>
  )
}

/** What sits beside the formats' chip, for a result a preset can be made from. */
export interface DonePreset {
  /** `key`: p save as preset. `saved`: the confirmation. `update`: p update, once it changed. */
  save: 'key' | 'saved' | 'update'
  /** The preset saved this session, for `saved` and `update`. */
  name?: string | undefined
}

/** A key drawn as the key row draws it, for a hint that sits in the body: the cap on the key grey, the words dim. */
export function keyHint(palette: ReturnType<typeof useTheme>, key: string, words: string): Run[] {
  const noColour = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
  const capped = palette.keycapBg !== '' && !noColour
  return [
    capped
      ? {
          text: ` ${key} `,
          fg: keyIsDown(key) ? palette.brand : palette.fg,
          bg: palette.keycapBg,
          bold: true,
        }
      : { text: `[${key}]`, fg: palette.fg, bold: true },
    { text: ` ${words}`, fg: palette.dim },
  ]
}

export function DoneScreen({
  mode,
  trail,
  result,
  offers,
  again,
  offer,
  reveal,
  width,
  height,
  pressed,
  afterName,
  keys: ownKeys,
  block,
  preset,
  chain,
}: {
  mode: ShellMode
  /** The run's answers, ending in "Done". */
  trail: Trail
  result: Result
  /** What the result's bar is named, when not its file: "On the clipboard". */
  afterName?: string | undefined
  /** The key row, when not the usual ↵ · c · o · s. */
  keys?: Array<[string, string]> | undefined
  /** Rows shown where the offers go, in their place: E3's tinted panel. */
  block?: Row[] | undefined
  /**
   * A result a preset can be made from (round 24, K26): p save as preset
   * quiet at the bottom left, → continue editing on its frame at the bottom
   * right, above the rule.
   */
  preset?: DonePreset | undefined
  /** What was done, once Continue editing changed it: the strip says every step. */
  chain?: string[] | undefined
  /** Offers to show at the foot (`✧` sentences), in order. */
  offers: string[]
  /** What ↵ does: "convert another", "compress again". */
  again: string
  /** The format `c` converts to, when there is a measured suggestion. */
  offer?: string | undefined
  /** What `s` is called on this platform ("Show in Finder"). */
  reveal: string
  width: number
  height: number
  /**
   * The key last pressed here (`o`, `s`); `n` counts presses, so pressing the
   * same key again shows again. Opening a file takes the system a moment, and
   * the inverted cap says the key was taken meanwhile.
   */
  pressed?: { key: string; n: number } | undefined
}) {
  const palette = useTheme()
  const press = useTween(pressed?.n, PRESS_MS, { enabled: motionEnabled(palette.name) })
  const ms =
    DRAW_MS * useTween(result, DRAW_MS, { enabled: motionEnabled(palette.name), onMount: true })
  const draw =
    ms >= DRAW_MS
      ? undefined
      : { bar: easeOut(ms / BAR_MS), label: Math.max(0, Math.min(1, (ms - LABEL_FROM) / LABEL_MS)) }
  const facts = doneFacts(result, mode)
  if (afterName !== undefined) facts.after.name = afterName
  const notes =
    block ??
    doneNotes({
      palette,
      offers,
      warnings: result.warnings.map((w) => w.message),
      width,
    })
  // What the shell just said (a failed open) sits on the keys, with a blank
  // row above, out of the blank rows Done has; one line where they are fewer.
  // The preset's foot takes a row of them. When the notice would not fit, the
  // body steps back first — a three-row bar — so the notice can say all it
  // has to.
  const notices = useNotices()
  const fullRows = notices.length > 0 ? noticeRows(notices, width, palette) + 1 : 0
  const footRows = preset ? 1 : 0
  const spareFor = (rows: number) => {
    const bare = doneLayout({ height, body: rows, notes: notes.length })
    return bare.top + bare.bottom - footRows + (notes.length > 0 ? bare.between - 1 : 0)
  }
  // The body steps back on a screen too short for it with its notes and the
  // preset's foot, too: nothing is ever pushed off the keys.
  const fits = (rows: number) =>
    4 + rows + (notes.length > 0 ? notes.length + 1 : 0) + footRows <= height
  const roomy = doneBody({ palette, facts, width, draw, chain })
  const body =
    !fits(roomy.length) || (fullRows > 0 && spareFor(roomy.length) < fullRows)
      ? doneBody({ palette, facts, width, draw, chain, compact: true })
      : roomy
  const full = fullRows > 0 && spareFor(body.length) >= fullRows
  const noticed = full ? fullRows : notices.length > 0 ? 1 : 0
  const { top, between, bottom } = doneLayout({
    height: height - noticed,
    body: body.length,
    notes: notes.length,
  })
  // A row between the preset's foot and the rule, where there is one to spare.
  const gap = bottom >= 2 ? 1 : 0
  const keys: Array<[string, string]> = ownKeys ?? [
    ['↵', again],
    ...(offer ? ([['c', offer]] as Array<[string, string]>) : []),
    ['o', 'open'],
    ['s', reveal.charAt(0).toLowerCase() + reveal.slice(1)],
  ]
  return (
    <Box flexDirection="column" width={width} height={height}>
      <HeaderBar mode={mode} trail={trail} width={width} />
      <Blank />
      <Blank rows={top} />
      <Body rows={body} />
      {notes.length > 0 ? (
        <>
          <Blank rows={between} />
          {notes.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the notes are positional
            <Runs key={i} row={row} />
          ))}
        </>
      ) : null}
      {preset && bottom > 0 ? (
        <>
          <Blank rows={bottom - 1 - gap} />
          <Runs row={presetFoot(palette, preset, width)} />
          <Blank rows={gap} />
        </>
      ) : (
        <Blank rows={bottom} />
      )}
      {full ? (
        <Box marginTop={1} flexShrink={0}>
          <Notices notices={notices} width={width} />
        </Box>
      ) : noticed > 0 ? (
        <NoticeLine notices={notices} width={width} />
      ) : null}
      <KeyRule width={width} />
      <KeyRow
        main={keys}
        foot={[['ctrl-c', 'quit']]}
        width={width}
        pressed={press < 1 ? pressed?.key : undefined}
      />
    </Box>
  )
}

/**
 * The foot of a result a preset can be made from (round 25): p save as
 * preset quiet at the bottom left — p in the dim grey, its words quieter —
 * and continue editing → in the same two greys at the bottom right, ending
 * on the block's edge. One row.
 */
function presetFoot(palette: ReturnType<typeof useTheme>, preset: DonePreset, width: number): Row {
  const left: Run[] =
    preset.save === 'saved'
      ? [
          { text: '✓ saved as ', fg: palette.ok },
          { text: preset.name ?? '', fg: palette.ok, bold: true },
        ]
      : [
          { text: 'p', fg: palette.dim, bold: true },
          {
            text: preset.save === 'update' ? ` update ${preset.name ?? ''}` : ' save as preset',
            fg: palette.border,
          },
        ]
  // Quiet like p (round 25): the words in the border grey, → after them in
  // the dim grey, bold — no frame, no key cap.
  const onward: Run[] = [
    { text: 'continue editing ', fg: palette.border },
    { text: '→', fg: palette.dim, bold: true },
  ]
  const end = width - HOME_MARGIN
  const at = Math.max(HOME_MARGIN + widthOf(left) + 1, end - widthOf(onward))
  return [blank(HOME_MARGIN), ...left, blank(at - HOME_MARGIN - widthOf(left)), ...onward]
}

/**
 * Done as the scrollback keeps it, once the screen is left: the body and any
 * warning, without the padding, the offers or the keys.
 */
export function DoneRecord({
  result,
  mode,
  width,
  place,
}: {
  result: Result
  mode: ShellMode
  width: number
  /** The folder line and the bar's name, when not the result's own: "Clipboard". */
  place?: { folder: string; name: string } | undefined
}) {
  const palette = useTheme()
  const facts = doneFacts(result, mode)
  if (place) facts.after.name = place.name
  // The scrollback keeps the compact picture: the same bar and words in six
  // rows, so the history stays as tight as it was.
  const body = doneBody({
    palette,
    facts,
    width,
    folder: place?.folder ?? displayPath(dirname(result.job.outputs[0] ?? '')),
    compact: true,
  })
  const warnings = doneNotes({
    palette,
    offers: [],
    warnings: result.warnings.map((w) => w.message),
    width,
  })
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Body rows={body} />
      {warnings.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {warnings.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the notes are positional
            <Runs key={i} row={row} />
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
