import { dirname } from 'node:path'
import { Box, Text } from 'ink'
import type { ForgeError } from '../core/errors.js'
import type { Result, SourceInfo } from '../core/types.js'
import { displayPath } from '../utils/display-path.js'
import type { Trail } from './bar-art.js'
import { DoneRecord } from './components/Done.js'
import { FileCard } from './components/FileCard.js'
import { HeaderBar } from './components/HeaderBar.js'
import { fileLink, hyperlinksSupported } from './hyperlink.js'
import { useTheme } from './ThemeContext.js'
import { colourProp, type ShellMode, SYMBOLS } from './theme.js'
import { middleEllipsis } from './width.js'

/**
 * What scrolls past above the live prompt: a dropped file, a finished
 * conversion, an error, or a plain status note. Dumb by design — this
 * module renders a `Result` or a `ForgeError`; it never converts anything
 * or decides what went wrong.
 */
export type HistoryBlock =
  | { kind: 'separator'; id: string; width: number }
  | { kind: 'file'; id: string; source: SourceInfo }
  /**
   * A finished convert or compress, filed once Done is left. `mode` colours
   * its arrow; convert where it is not given.
   */
  | { kind: 'result'; id: string; result: Result; mode?: ShellMode | undefined }
  | { kind: 'error'; id: string; error: ForgeError }
  /**
   * `savedTo` is an output path, for a note that reports written files (a
   * page operation, a rasterisation) — it adds the same "saved to" line a
   * conversion result carries.
   */
  | { kind: 'note'; id: string; text: string; savedTo?: string }
  /**
   * The header bar as it stood when a run finished, its trail ending in
   * "Done": it heads the result below it, and stays with it in the
   * scrollback as the record of what was chosen.
   */
  | { kind: 'bar'; id: string; mode: ShellMode; trail: Trail }

/**
 * The folder a result was written to. Two filenames and a size used to be
 * the whole result, so a destination typed with a stray leading `d` created
 * `d/…/out/` three levels deep and nothing on screen said so (audit #9).
 *
 * The folder rather than the full path — the note above says what was
 * written. `~`-abbreviated and middle-ellipsed to the width, and an OSC 8 link
 * to the folder where the terminal has them, through the same `fileLink` as
 * Done's folder line. This lives in history, so the answer is still in the
 * scrollback after the next conversion starts.
 */
function SavedTo({ output, width }: { output: string; width: number }) {
  const palette = useTheme()
  const folder = dirname(output)
  const prefix = '  saved to '
  const shown = middleEllipsis(displayPath(folder), Math.max(8, width - prefix.length))
  return (
    <Text>
      <Text color={colourProp(palette.dim)}>{prefix}</Text>
      <Text color={colourProp(palette.fg)}>
        {hyperlinksSupported() ? fileLink(shown, folder) : shown}
      </Text>
    </Text>
  )
}

export function HistoryEntry({ block, width }: { block: HistoryBlock; width: number }) {
  const palette = useTheme()

  if (block.kind === 'bar') {
    return (
      <Box marginBottom={1}>
        <HeaderBar mode={block.mode} trail={block.trail} width={width} />
      </Box>
    )
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
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colourProp(palette.dim)}>{block.text}</Text>
        {block.savedTo ? <SavedTo output={block.savedTo} width={width} /> : null}
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
        {/* The shell's own phrasing where it has one: `hint` is written for
            the CLI, and a slash command or a flag only exists on one side. */}
        {(e.shellHint ?? e.hint) ? (
          <Text color={colourProp(palette.dim)} wrap="wrap">
            {e.shellHint ?? e.hint}
          </Text>
        ) : null}
      </Box>
    )
  }

  // Every Result rendered here comes from a conversion or a compression —
  // both plan a `convert` job — and Done is built around that shape: one
  // source becoming one written file. A page operation's results are notes.
  if (block.result.job.op !== 'convert') {
    throw new Error(`HistoryEntry cannot render a "${block.result.job.op}" result yet`)
  }
  /** Done as the scrollback keeps it, under the run's bar (K3·a). */
  return <DoneRecord result={block.result} mode={block.mode ?? 'convert'} width={width} />
}
