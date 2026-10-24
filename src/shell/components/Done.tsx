import { dirname } from 'node:path'
import { Box } from 'ink'
import { FORMATS } from '../../core/formats.js'
import type { Result } from '../../core/types.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import type { Trail } from '../bar-art.js'
import {
  type DoneAction,
  type DoneFacts,
  doneActionRows,
  doneBody,
  doneLayout,
  doneNotes,
} from '../done-art.js'
import type { Row, Run } from '../home-art.js'
import { easeOut, motionEnabled, PRESS_MS, useTween } from '../motion.js'
import { keyIsDown } from '../pressed-key.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { HeaderBar } from './HeaderBar.js'
import { KeyRow, KeyRule, Runs } from './Home.js'
import { NoticeLine, Notices, noticeRows, useNotices } from './Notices.js'
import type { DoneLinks } from './PresetSave.js'

/**
 * Done (round 24, mockups/done-2026-10-round18.html): what a single-file
 * convert or compress leaves on screen. The header bar's trail ends in
 * "Done" — and says the folder, so the body does not; under it, the strip
 * with the formats and the change, one bar sized by bytes (see
 * `done-art.ts`) and the two sizes, then any offer or warning low above the
 * keys. No file card: the bar is the file.
 *
 * Under it, the way on (mockups/done-next-2026-10-round9.html, Y31): the
 * actions in a frame and Home as its own block, ←→ to choose and ↵ to
 * confirm, every action on its own key too.
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

/** What a Done action does, for the shell to act on. */
export type DoneActionId = 'open' | 'reveal' | 'preset' | 'edit' | 'undo' | 'copy'

/**
 * Done's actions besides Home, in order: Open, then Finder (or, for an image
 * placed on the clipboard, Undo and Save a copy), then Save as preset and
 * Continue editing where a preset can be made from the result.
 */
export function doneActions({
  preset,
  reveal,
  clipboard,
}: {
  preset?: DonePreset | undefined
  /** What revealing is called on this platform: "Show in Finder". */
  reveal: string
  /** `placed`: the result is on the clipboard, with no file to show. */
  clipboard?: 'placed' | undefined
}): Array<DoneAction & { id: DoneActionId }> {
  const where = reveal.replace(/^Show in /, '')
  return [
    { id: 'open', key: 'o', label: 'Open' },
    ...(clipboard === 'placed'
      ? [
          { id: 'undo' as const, key: 'u', label: 'Undo' },
          { id: 'copy' as const, key: 's', label: 'Save a copy' },
        ]
      : [{ id: 'reveal' as const, key: 'f', label: where }]),
    ...(preset
      ? [
          {
            id: 'preset' as const,
            key: 'p',
            label:
              preset.save === 'saved'
                ? `✓ ${preset.name ?? 'saved'}`
                : preset.save === 'update'
                  ? 'Update preset'
                  : 'Save as preset',
            ok: preset.save === 'saved',
          },
          { id: 'edit' as const, key: 'e', label: 'Continue editing' },
        ]
      : []),
  ]
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

/**
 * Done's key row: ←→ choose and ↵ confirm under the actions' frame; where
 * the window is too narrow for the frame, every action said as a key
 * instead. `c` and its offer after either.
 */
export function doneKeys({
  actions,
  framed,
  offer,
}: {
  actions: readonly DoneAction[]
  framed: boolean
  offer?: string | undefined
}): Array<[string, string]> {
  const extra: Array<[string, string]> = offer ? [['c', offer]] : []
  return framed
    ? [['←→', 'choose'], ['↵', 'confirm'], ...extra]
    : [
        ['↵', 'home'],
        ...actions.map((a): [string, string] => [a.key, a.label.toLowerCase()]),
        ...extra,
      ]
}

/**
 * Done's way on alone, for a Done that lays itself out (edit's, with its
 * pictures): the actions' frame and Home, three rows, or nothing where the
 * window is too narrow for them (`doneKeys` then says them).
 */
export function DoneActions({
  mode,
  actions,
  selected,
  width,
  pressed,
}: {
  mode: ShellMode
  actions: readonly DoneAction[]
  selected?: number | undefined
  width: number
  pressed?: { key: string; n: number } | undefined
}) {
  const palette = useTheme()
  const press = useTween(pressed?.n, PRESS_MS, { enabled: motionEnabled(palette.name) })
  const rows = doneActionRows({
    palette,
    mode,
    actions,
    selected: selected ?? actions.length,
    width,
    down: (key) => keyIsDown(key) || (press < 1 && pressed?.key === key),
  })
  if (!rows) return null
  return (
    <Box flexDirection="column">
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the rows are positional
        <Runs key={`action-${i}`} row={row} />
      ))}
    </Box>
  )
}

export function DoneScreen({
  mode,
  trail,
  result,
  offers,
  offer,
  actions,
  selected,
  width,
  height,
  pressed,
  afterName,
  block,
  links,
}: {
  mode: ShellMode
  /** The run's answers, ending in "Done". */
  trail: Trail
  result: Result
  /** What the result's bar is named, when not its file: "On the clipboard". */
  afterName?: string | undefined
  /** Rows shown where the offers go, in their place: E3's tinted panel. */
  block?: Row[] | undefined
  /** The ways on besides Home (`doneActions`). */
  actions: readonly DoneAction[]
  /** The action chosen with ←→, an index into `actions`; `actions.length`, the default, is Home. */
  selected?: number | undefined
  /**
   * The chain the file was made by (C1): the strip says the source, every
   * step, and the + slot Continue editing fills.
   */
  links?: DoneLinks | undefined
  /** Offers to show at the foot (`✧` sentences), in order. */
  offers: string[]
  /** What `c` does, on the key row, when there is a measured suggestion: "WebP", "compress it". */
  offer?: string | undefined
  width: number
  height: number
  /**
   * The key last pressed here (`o`, `f`); `n` counts presses, so pressing the
   * same key again shows again. Its button's key lights for a moment.
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
  // The actions take three of them. When the notice would not fit, the
  // body steps back first — a three-row bar — so the notice can say all it
  // has to.
  const notices = useNotices()
  const fullRows = notices.length > 0 ? noticeRows(notices, width, palette) + 1 : 0
  const framed = doneActionRows({
    palette,
    mode,
    actions,
    selected: selected ?? actions.length,
    width,
    // Held down, or just pressed (M6b): opening a file takes the system a
    // moment, and the lit key says it was taken meanwhile.
    down: (key) => keyIsDown(key) || (press < 1 && pressed?.key === key),
  })
  const spareFor = (rows: number, foot: number) => {
    const bare = doneLayout({ height, body: rows, notes: notes.length })
    return bare.top + bare.bottom - foot + (notes.length > 0 ? bare.between - 1 : 0)
  }
  // The body steps back on a screen too short for it with its notes and the
  // actions, too: nothing is ever pushed off the keys.
  const fits = (rows: number, foot: number) =>
    4 + rows + (notes.length > 0 ? notes.length + 1 : 0) + foot <= height
  const roomy = doneBody({ palette, facts, width, draw, links })
  const tall = framed?.length ?? 0
  const body =
    !fits(roomy.length, tall) || (fullRows > 0 && spareFor(roomy.length, tall) < fullRows)
      ? doneBody({ palette, facts, width, draw, links, compact: true })
      : roomy
  // Still no room for what the shell has to say: the actions lose the
  // frame's rows above and below them, so the whole notice can show.
  const flat = framed !== undefined && fullRows > 0 && spareFor(body.length, tall) < fullRows
  const actionRows = flat ? framed.slice(1, 2) : framed
  const footRows = actionRows?.length ?? 0
  const full = fullRows > 0 && spareFor(body.length, footRows) >= fullRows
  const noticed = full ? fullRows : notices.length > 0 ? 1 : 0
  const { top, between, bottom } = doneLayout({
    height: height - noticed,
    body: body.length,
    notes: notes.length,
  })
  // A row between the actions and the rule, where there is one to spare.
  const gap = bottom >= footRows + 1 ? 1 : 0
  const shown = actionRows !== undefined && bottom >= footRows
  const keys = doneKeys({ actions, framed: shown, offer })
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
      {shown && actionRows ? (
        <>
          <Blank rows={bottom - footRows - gap} />
          {actionRows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the rows are positional
            <Runs key={`action-${i}`} row={row} />
          ))}
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
