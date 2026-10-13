import { dirname } from 'node:path'
import { Box } from 'ink'
import { FORMATS } from '../../core/formats.js'
import type { Result } from '../../core/types.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import type { Trail } from '../bar-art.js'
import { type DoneFacts, doneBody, doneLayout, doneNotes } from '../done-art.js'
import type { Row } from '../home-art.js'
import { easeOut, motionEnabled, useTween } from '../motion.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, type ShellMode } from '../theme.js'
import { HeaderBar } from './HeaderBar.js'
import { KeyRow, Runs } from './Home.js'

/**
 * Done (B6a): what a single-file convert or compress leaves on screen. The
 * header bar's trail ends in "Done" — and says the folder, so the body does
 * not; under it, the formats, one bar sized by bytes (see `done-art.ts`) and
 * the two sizes, then any offer or warning low above the keys. No file card:
 * the bar is the file.
 *
 * `DoneScreen` fills the terminal's height, as home does, so the keys sit on
 * the bottom row. `DoneRecord` is the same body without the padding and the
 * keys, for the scrollback once the screen is left — and with the folder
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
/** How long a pressed key's cap stays inverted (M6b). */
const PRESS_MS = 130

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
}: {
  mode: ShellMode
  /** The run's answers, ending in "Done". */
  trail: Trail
  result: Result
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
  const body = doneBody({ palette, facts: doneFacts(result, mode), width, draw })
  const notes = doneNotes({
    palette,
    offers,
    warnings: result.warnings.map((w) => w.message),
    width,
  })
  const { top, between, bottom } = doneLayout({
    height,
    body: body.length,
    notes: notes.length,
  })
  const keys: Array<[string, string]> = [
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
      <Blank rows={bottom} />
      <Text color={colourProp(palette.border)}>{'─'.repeat(width)}</Text>
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
}: {
  result: Result
  mode: ShellMode
  width: number
}) {
  const palette = useTheme()
  const body = doneBody({
    palette,
    facts: doneFacts(result, mode),
    width,
    folder: displayPath(dirname(result.job.outputs[0] ?? '')),
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
