import { basename, dirname } from 'node:path'
import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import stringWidth from 'string-width'
import type { Result } from '../../core/types.js'
import { formatBytes, percentChange } from '../../core/units.js'
import { displayPath } from '../../utils/display-path.js'
import { fileLink, hyperlinksSupported } from '../hyperlink.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { middleEllipsis } from '../width.js'

/**
 * A finished conversion, as a receipt.
 *
 * This replaces two framed filenames with the saving written underneath in
 * dim text. The saving is the answer to "was that worth it?", so here it is
 * the hero: before and after as two bars on one scale, the larger of the two
 * filling it. Every number is measured — the job has already run — so the
 * bars are not progress and invent nothing.
 *
 * Drawn by hand rather than with Ink's border, for the same reason as
 * `FileCard`: the title sits inside the top edge.
 */

/** The card never grows past this, however wide the terminal is. */
export const RECEIPT_MAX = 68
const BAR_CELLS = 24
const TITLE = `${SYMBOLS.ok} DONE`

/**
 * Bar lengths for two sizes on one scale. The larger side gets every cell;
 * the other is scaled to it and never drawn empty unless it really is zero
 * bytes. Two zeros draw as two full bars — "the same", which they are.
 */
export function receiptBars(
  before: number,
  after: number,
  cells: number,
): { before: number; after: number; grew: boolean } {
  const big = Math.max(before, after)
  if (big === 0) return { before: cells, after: cells, grew: false }
  const scale = (n: number) => (n === 0 ? 0 : Math.max(1, Math.round((cells * n) / big)))
  return { before: scale(before), after: scale(after), grew: after > before }
}

/** Word-wraps `text` to `width` columns, hard-breaking any longer word. */
export function wrapWords(text: string, width: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word
    while (stringWidth(w) > width) {
      if (line) {
        out.push(line)
        line = ''
      }
      out.push(w.slice(0, width))
      w = w.slice(width)
    }
    if (!w) continue
    if (!line) line = w
    else if (stringWidth(`${line} ${w}`) <= width) line = `${line} ${w}`
    else {
      out.push(line)
      line = w
    }
  }
  if (line) out.push(line)
  return out
}

function changePhrase(from: number, to: number): string {
  const { pct, direction } = percentChange(from, to)
  return direction === 'same' ? 'same size' : `${pct}% ${direction}`
}

export function ReceiptCard({ result, width }: { result: Result; width: number }) {
  const palette = useTheme()
  const { job, outputBytes, warnings } = result
  if (job.op !== 'convert') throw new Error(`ReceiptCard cannot render a "${job.op}" result`)
  const source = job.sources[0]
  const output = job.outputs[0]
  if (!source || output === undefined) throw new Error('ReceiptCard needs a source and an output')

  const W = Math.min(width, RECEIPT_MAX)
  const inner = W - 2
  /** Text area: the inner width less two columns of padding on each side. */
  const T = inner - 4
  const edge = colourProp(palette.ok)
  const fill = (plain: string) => ' '.repeat(Math.max(0, T - stringWidth(plain)))

  /** One padded row. `plain` is what `content` shows, for measuring only. */
  const row = (key: string, content: ReactNode, plain: string) => (
    <Text key={key}>
      <Text color={edge}>{'│  '}</Text>
      {content}
      <Text>{fill(plain)}</Text>
      <Text color={edge}>{'  │'}</Text>
    </Text>
  )
  const blank = (key: string) => <Text key={key} color={edge}>{`│${' '.repeat(inner)}│`}</Text>

  // Names on one line when both fit beside the arrow; otherwise one per
  // line, the output under an arrow. Ellipsing is the last resort — only a
  // name wider than the card on its own line loses its middle.
  const fromName = basename(source.path)
  const toName = basename(output)
  const ARROW = `  ${SYMBOLS.longArrow}  `
  const oneLine = stringWidth(fromName) + stringWidth(ARROW) + stringWidth(toName) <= T
  const LEAD = `${SYMBOLS.longArrow} `
  const nameLines = oneLine
    ? [`${fromName}${ARROW}${toName}`]
    : [middleEllipsis(fromName, T), `${LEAD}${middleEllipsis(toName, T - stringWidth(LEAD))}`]

  // Sizes on one scale. The bar gives up cells before the numbers do.
  const before = formatBytes(source.bytes)
  const after = formatBytes(outputBytes)
  const sizeW = Math.max(stringWidth(before), stringWidth(after))
  const phrase = changePhrase(source.bytes, outputBytes)
  const cells = Math.max(
    4,
    Math.min(BAR_CELLS, T - 'before  '.length - 2 - sizeW - 2 - stringWidth(phrase)),
  )
  const bars = receiptBars(source.bytes, outputBytes, cells)
  const outcome = colourProp(bars.grew ? palette.larger : palette.ok)
  const bar = (n: number, colour: string | undefined) => (
    <>
      <Text color={colour}>{'█'.repeat(n)}</Text>
      <Text color={colourProp(palette.border)}>{'░'.repeat(cells - n)}</Text>
    </>
  )
  const beforeText = `before  ${'█'.repeat(cells)}  ${before.padEnd(sizeW)}`
  const afterText = `after   ${'█'.repeat(cells)}  ${after.padEnd(sizeW)}  ${phrase}`

  // Where it went: the full path, with its folder linked where the terminal
  // has links. Padding is measured from `shown`; a link only adds escapes.
  const label = 'saved to '
  const shown = middleEllipsis(displayPath(output), T - label.length)
  const folder = dirname(output)

  const rule = '─'.repeat(Math.max(0, inner - stringWidth(TITLE) - 3))
  const warningLines = warnings.flatMap((w) => wrapWords(`${SYMBOLS.warn} ${w.message}`, T))

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        <Text color={edge}>{'╭─ '}</Text>
        <Text color={edge} bold>
          {TITLE}
        </Text>
        <Text color={edge}>{` ${rule}╮`}</Text>
      </Text>
      {blank('b1')}
      {nameLines.map((line) =>
        row(
          line,
          <Text color={colourProp(palette.fg)} bold>
            {line}
          </Text>,
          line,
        ),
      )}
      {blank('b2')}
      {row(
        'before',
        <>
          <Text color={colourProp(palette.dim)}>{'before  '}</Text>
          {bar(bars.before, colourProp(palette.dim))}
          <Text color={colourProp(palette.dim)}>{`  ${before.padEnd(sizeW)}`}</Text>
        </>,
        beforeText,
      )}
      {row(
        'after',
        <>
          <Text color={colourProp(palette.dim)}>{'after   '}</Text>
          {bar(bars.after, outcome)}
          <Text color={colourProp(palette.fg)} bold>{`  ${after.padEnd(sizeW)}`}</Text>
          <Text color={outcome} bold>{`  ${phrase}`}</Text>
        </>,
        afterText,
      )}
      {blank('b3')}
      {row(
        'saved',
        <>
          <Text color={colourProp(palette.dim)}>{label}</Text>
          <Text color={colourProp(palette.fg)}>
            {hyperlinksSupported() ? fileLink(shown, folder) : shown}
          </Text>
        </>,
        `${label}${shown}`,
      )}
      {warningLines.map((line, i) =>
        row(`w${i}`, <Text color={colourProp(palette.warn)}>{line}</Text>, line),
      )}
      <Text color={edge}>{`╰${'─'.repeat(inner)}╯`}</Text>
    </Box>
  )
}
