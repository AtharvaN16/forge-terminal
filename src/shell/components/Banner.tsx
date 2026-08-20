import { Box, Text } from 'ink'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { bandFor } from '../width.js'

/**
 * `█` is the letter face; `╔═╗║╚╝` is its edge. The edge is the whole point:
 * solid-slab block letters leave O and G, and E and F, with near-identical
 * silhouettes at this size, and the outline is what tells them apart. Six
 * rows rather than five, because five does not leave enough vertical room to
 * describe a letterform.
 *
 * Every row must be exactly the same length or the letters shear. Trailing
 * spaces are therefore significant, and a test pins it.
 */
export const WORDMARK = [
  '███████╗ ██████╗ ██████╗  ██████╗ ███████╗',
  '██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝',
  '█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  ',
  '██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  ',
  '██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗',
  '╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝',
] as const

/** An anvil with the hammer above it. Same row count as WORDMARK. */
export const MARK = [
  '   ▟█▙     ',
  '    ▐▌     ',
  ' ▗▄▄▄▄▄▄▄▄▖',
  '▐██████████',
  ' ▝▀▀▐██▌▀▀ ',
  ' ▗▄██████▄▖',
] as const

const GAP = '  '
/** Columns the mark, gap and wordmark need before any padding. */
export const FULL_WIDTH = MARK[0].length + GAP.length + WORDMARK[0].length

/**
 * Splits a wordmark row into face runs and edge runs so each takes its own
 * colour. The face uses the palette's plain foreground — by construction it
 * contrasts with the user's background in either theme — and the accent sits
 * on the edge only, where it reads as an accent rather than as the letterform
 * itself. A wordmark drawn entirely in the accent is a mid-tone against both
 * backgrounds and reads muddy.
 */
function splitFace(row: string): { text: string; edge: boolean }[] {
  const runs: { text: string; edge: boolean }[] = []
  for (const ch of row) {
    const edge = ch !== '█'
    const last = runs.at(-1)
    if (last && last.edge === edge) last.text += ch
    else runs.push({ text: ch, edge })
  }
  return runs
}

/**
 * Shown on every shell launch. The status line carries the default output
 * folder, which is what makes that setting discoverable without a settings
 * screen — and it follows `d` immediately, so the change is visible where it
 * was made.
 */
export function Banner({
  width,
  version,
  defaultOutput,
}: {
  width: number
  version: string
  defaultOutput: string
}) {
  const palette = useTheme()

  // Below the compact band the art does not fit: 42 columns of wordmark plus
  // 11 of mark needs 55 before any padding at all.
  if (bandFor(width) === 'compact' || width < FULL_WIDTH) {
    return (
      <Box marginTop={1} marginBottom={1}>
        <Text>
          <Text color={colourProp(palette.accent)}>{'⚒ '}</Text>
          <Text color={colourProp(palette.fg)} bold>
            Forge
          </Text>
          <Text color={colourProp(palette.dim)}>{` ${version}`}</Text>
        </Text>
      </Box>
    )
  }

  const status = ` Convert ${version}  · image`
  const gap = Math.max(2, width - status.length - defaultOutput.length - 1)

  return (
    // marginTop clears the shell prompt the user typed `forge` at; without it
    // the mark sits flush against their own command line.
    <Box flexDirection="column" marginTop={1} marginBottom={2}>
      {WORDMARK.map((word, i) => (
        // The row index is a stable identity here: this is fixed-length
        // constant art, never reordered, filtered or appended to.
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed constant art
        <Text key={i}>
          <Text color={colourProp(palette.dim)}>{MARK[i]}</Text>
          <Text>{GAP}</Text>
          {splitFace(word).map((run, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed constant art
            <Text key={j} color={colourProp(run.edge ? palette.accent : palette.fg)}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
      <Text>
        <Text color={colourProp(palette.dim)}>{status}</Text>
        <Text>{' '.repeat(gap)}</Text>
        <Text color={colourProp(palette.dim)}>{defaultOutput}</Text>
      </Text>
    </Box>
  )
}
