import { basename } from 'node:path'
import { Box, Text } from 'ink'
import stringWidth from 'string-width'
import type { ForgeError } from '../core/errors.js'
import { FORMATS } from '../core/formats.js'
import type { Result, SourceInfo } from '../core/types.js'
import { formatBytes, percentChange } from '../core/units.js'
import { Banner } from './components/Banner.js'
import { FileCard } from './components/FileCard.js'
import { useTheme } from './ThemeContext.js'
import { colourProp, SYMBOLS, VERSION } from './theme.js'
import { bandFor, middleEllipsis } from './width.js'

/**
 * What scrolls past above the live prompt: a dropped file, a finished
 * conversion, an error, or a plain status note. Dumb by design — this
 * module renders a `Result` or a `ForgeError`; it never converts anything
 * or decides what went wrong.
 */
export type HistoryBlock =
  /**
   * The banner. It lives in history rather than in the live tree because
   * Ink flushes `<Static>` output above everything that re-renders — a
   * banner in the dynamic tree is redrawn *below* the scrollback on every
   * update, which is how it ended up in the middle of the session.
   */
  | { kind: 'banner'; id: string; width: number; defaultOutput: string }
  | { kind: 'separator'; id: string; width: number }
  | { kind: 'file'; id: string; source: SourceInfo }
  | { kind: 'result'; id: string; result: Result }
  | { kind: 'error'; id: string; error: ForgeError }
  | { kind: 'note'; id: string; text: string }

function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  return direction === 'same' ? 'same size' : `${pct}% ${direction}`
}

/**
 * `ok` (green) reads as "this is what you wanted." A convert or compress
 * that comes out *larger* is the opposite of that — most often a lossless
 * target re-encoding a lossy source (PNG from a JPEG, say), not a defect,
 * but still a result worth a second look, which is what `larger` (a
 * dedicated orange — see its doc comment on `Palette`) signals. `same`
 * stays `ok`: nothing surprising happened.
 */
function changeColour(from: number, to: number): 'ok' | 'larger' {
  return percentChange(from, to).direction === 'larger' ? 'larger' : 'ok'
}

export function HistoryEntry({ block, width }: { block: HistoryBlock; width: number }) {
  const palette = useTheme()

  if (block.kind === 'banner') {
    return <Banner width={block.width} version={VERSION} defaultOutput={block.defaultOutput} />
  }

  if (block.kind === 'separator') {
    // Heavy double-dash, not the light one used for ordinary borders: this
    // marks a break between separate operations in one session, a coarser
    // structural event than a border ever draws. Spaced (`╍ `, not a solid
    // `╍╍╍`) and in `dim` rather than `border` for the same reason — this
    // has to read as a deliberate marker, not another rule.
    const width = Math.max(4, block.width)
    const line = '╍ '.repeat(Math.ceil(width / 2)).slice(0, width)
    return (
      <Box marginTop={1} marginBottom={2}>
        <Text color={colourProp(palette.dim)}>{line}</Text>
      </Box>
    )
  }

  if (block.kind === 'file') {
    return (
      <Box marginBottom={1}>
        <FileCard source={block.source} width={width} />
      </Box>
    )
  }

  if (block.kind === 'note') {
    return (
      <Box marginBottom={1}>
        <Text color={colourProp(palette.dim)}>{block.text}</Text>
      </Box>
    )
  }

  if (block.kind === 'error') {
    const e = block.error
    /**
     * Framed, not three loose lines.
     *
     * This used to render flush against the scrollback above it in the same
     * plain text as everything else, and a user reported reading straight
     * past a refusal — then typing the command it had just declined. The
     * frame makes the title, the reason and the way forward one object with
     * an edge, which is the difference between output you skim and output
     * you stop at.
     *
     * Capped at the same 52 columns as `FileCard` so a wide terminal gets a
     * card rather than a rule to the far edge, and `-2` leaves room for the
     * border glyphs Ink draws outside the content box.
     */
    const inner = Math.max(8, Math.min(width, 52) - 2)
    return (
      <Box
        flexDirection="column"
        marginBottom={1}
        borderStyle="round"
        borderColor={colourProp(palette.fail)}
        width={inner + 2}
        paddingX={1}
      >
        <Text color={colourProp(palette.fail)} wrap="wrap">
          {SYMBOLS.fail} {e.title}
        </Text>
        <Text color={colourProp(palette.fg)} wrap="wrap">
          {e.detail}
        </Text>
        {e.hint ? (
          <Text color={colourProp(palette.dim)} wrap="wrap">
            {e.hint}
          </Text>
        ) : null}
      </Box>
    )
  }

  const { job, outputBytes, warnings } = block.result
  // Every Result rendered here today comes from a conversion or a
  // compression — both plan a `convert` job — and this card is built around
  // that shape: one source format becoming one target format. A page
  // operation's result gets its own rendering once one exists.
  if (job.op !== 'convert') {
    throw new Error(`HistoryEntry cannot render a "${job.op}" result yet`)
  }
  const fromLabel = FORMATS[job.sources[0].format].label
  const toLabel = FORMATS[job.target].label

  /**
   * Two framed names with an arrow between them, so a finished conversion
   * reads as a before and an after rather than as a sentence. The saving sits
   * underneath, because it is the answer to "was that worth it?" and belongs
   * on its own line rather than competing with the filenames.
   *
   * Below the normal band there is no room for two boxes side by side — a
   * pair needs roughly 2x22 columns plus the arrow — so the compact band
   * keeps the single-line form.
   */
  const band = bandFor(width)
  const fromName = basename(job.sources[0].path)
  const toName = basename(job.outputs[0])

  /**
   * Side by side each box gets under half the terminal, which a real
   * filename — "Screenshot 2026-08-17 at 3.52.36 PM.png" — does not fit
   * inside. Rather than ellipsing the middle out of both names, the pair
   * stacks vertically when either is too long: one box per row, each with
   * the full width, and the arrow between them turns downward.
   *
   * Truncation is then a last resort rather than the normal case.
   */
  const sideBySideText = Math.min(30, Math.floor((Math.min(width, 76) - 5) / 2)) - 4
  const fitsSideBySide =
    stringWidth(fromName) <= sideBySideText && stringWidth(toName) <= sideBySideText

  const paired = band !== 'compact' && width >= 56
  const stacked = paired && !fitsSideBySide

  if (!paired) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          <Text color={colourProp(palette.ok)}>{`${SYMBOLS.ok} done`}</Text>
          <Text
            color={colourProp(palette.dim)}
          >{`  ${middleEllipsis(basename(job.outputs[0]), Math.max(8, width - 8))}`}</Text>
        </Text>
        <Text>
          <Text color={colourProp(palette.dim)}>
            {`  ${formatBytes(job.sources[0].bytes)} ${SYMBOLS.arrow} ${formatBytes(outputBytes)} · `}
          </Text>
          <Text color={colourProp(palette[changeColour(job.sources[0].bytes, outputBytes)])}>
            {changePhrase(job.sources[0].bytes, outputBytes)}
          </Text>
        </Text>
        {warnings.map((w) => (
          <Text key={w.message} color={colourProp(palette.warn)}>
            {SYMBOLS.warn} {w.message}
          </Text>
        ))}
      </Box>
    )
  }

  // Two boxes and the arrow gutter share the row; each box carries its own
  // border, so the text inside is the box width less the two frame glyphs
  // and a column of padding on each side.
  // The connector is ` ──→ ` — five columns — and the top and bottom edges
  // must span the same gap, or the boxes stop lining up.
  const CONNECTOR = ` ${SYMBOLS.longArrow} `
  const boxWidth = Math.min(30, Math.floor((Math.min(width, 76) - CONNECTOR.length) / 2))
  const textWidth = boxWidth - 4

  const cell = (label: string, name: string) => {
    const rule = '─'.repeat(Math.max(0, boxWidth - 2 - stringWidth(label) - 3))
    const shown = middleEllipsis(name, textWidth)
    const pad = ' '.repeat(Math.max(0, textWidth - stringWidth(shown)))
    return {
      top: (
        <>
          <Text color={colourProp(palette.border)}>{'╭─ '}</Text>
          <Text color={colourProp(palette.tag)}>{label}</Text>
          <Text color={colourProp(palette.border)}>{` ${rule}╮`}</Text>
        </>
      ),
      mid: (
        <>
          <Text color={colourProp(palette.border)}>{'│ '}</Text>
          <Text color={colourProp(palette.fg)}>{`${shown}${pad}`}</Text>
          <Text color={colourProp(palette.border)}>{' │'}</Text>
        </>
      ),
      bottom: <Text color={colourProp(palette.border)}>{`╰${'─'.repeat(boxWidth - 2)}╯`}</Text>,
    }
  }

  if (stacked) {
    const full = Math.min(width, 76)
    const fullText = full - 4

    const wide = (label: string, name: string) => {
      const rule = '─'.repeat(Math.max(0, full - 2 - stringWidth(label) - 3))
      const shown = middleEllipsis(name, fullText)
      const pad = ' '.repeat(Math.max(0, fullText - stringWidth(shown)))
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={colourProp(palette.border)}>{'╭─ '}</Text>
            <Text color={colourProp(palette.tag)}>{label}</Text>
            <Text color={colourProp(palette.border)}>{` ${rule}╮`}</Text>
          </Text>
          <Text>
            <Text color={colourProp(palette.border)}>{'│ '}</Text>
            <Text color={colourProp(palette.fg)}>{`${shown}${pad}`}</Text>
            <Text color={colourProp(palette.border)}>{' │'}</Text>
          </Text>
          <Text color={colourProp(palette.border)}>{`╰${'─'.repeat(full - 2)}╯`}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colourProp(palette.ok)}>{`${SYMBOLS.ok} done`}</Text>
        <Box marginTop={1} flexDirection="column">
          {wide(fromLabel, fromName)}
          <Text color={colourProp(palette.dim)}>{`${' '.repeat(Math.floor(full / 2))}│`}</Text>
          <Text color={colourProp(palette.dim)}>{`${' '.repeat(Math.floor(full / 2))}▼`}</Text>
          {wide(toLabel, toName)}
        </Box>
        <Box marginTop={1}>
          <Text>
            <Text color={colourProp(palette.dim)}>
              {`  ${formatBytes(job.sources[0].bytes)} ${SYMBOLS.arrow} ${formatBytes(outputBytes)} · `}
            </Text>
            <Text color={colourProp(palette[changeColour(job.sources[0].bytes, outputBytes)])}>
              {changePhrase(job.sources[0].bytes, outputBytes)}
            </Text>
          </Text>
        </Box>
        {warnings.map((w) => (
          <Text key={w.message} color={colourProp(palette.warn)}>
            {SYMBOLS.warn} {w.message}
          </Text>
        ))}
      </Box>
    )
  }

  const from = cell(fromLabel, fromName)
  const to = cell(toLabel, toName)
  const gutter = ' '.repeat(CONNECTOR.length)

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={colourProp(palette.ok)}>{`${SYMBOLS.ok} done`}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {from.top}
          <Text>{gutter}</Text>
          {to.top}
        </Text>
        <Text>
          {from.mid}
          <Text color={colourProp(palette.dim)}>{CONNECTOR}</Text>
          {to.mid}
        </Text>
        <Text>
          {from.bottom}
          <Text>{gutter}</Text>
          {to.bottom}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          <Text color={colourProp(palette.dim)}>
            {`  ${formatBytes(job.sources[0].bytes)} ${SYMBOLS.arrow} ${formatBytes(outputBytes)} · `}
          </Text>
          <Text color={colourProp(palette[changeColour(job.sources[0].bytes, outputBytes)])}>
            {changePhrase(job.sources[0].bytes, outputBytes)}
          </Text>
        </Text>
      </Box>
      {warnings.map((w) => (
        <Text key={w.message} color={colourProp(palette.warn)}>
          {SYMBOLS.warn} {w.message}
        </Text>
      ))}
    </Box>
  )
}
