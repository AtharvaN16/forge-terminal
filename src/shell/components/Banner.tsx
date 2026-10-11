import { Box, Text } from 'ink'
import { glyphColour, HEAT, MARK_AT_REST, MARK_WIDTH, REST_STEP, WORDMARK } from '../mark.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { bandFor } from '../width.js'

/** Re-exported: the wordmark's data lives in mark.ts, beside the mark's. */
export { WORDMARK }

/** Re-exported so callers that only need the still mark do not reach past this. */
export const MARK = MARK_AT_REST

const GAP = '  '
/** Columns the mark, gap and wordmark need before any padding. */
export const FULL_WIDTH = MARK_WIDTH + GAP.length + (WORDMARK[0]?.length ?? 0)

/** Sparks and heat are their own colours; everything else is the anvil. */
function markRow(row: string, index: number, anvil: string | undefined) {
  const step = REST_STEP
  const heat = HEAT[4] ?? HEAT[0]
  return (
    <>
      {Array.from(row).map((ch, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed constant art
        <Text key={i} color={glyphColour(ch, index, step, heat, anvil ?? '') ?? undefined}>
          {ch}
        </Text>
      ))}
    </>
  )
}

/**
 * Splits a wordmark row into face runs and edge runs so each takes its own
 * colour. The face uses the palette's plain foreground — by construction it
 * contrasts with the user's background in either theme — and the brand colour sits
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
          <Text color={colourProp(palette.brand)}>{'⚒ '}</Text>
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
      {MARK.map((row, i) => {
        // Bottom-aligned, as the intro draws it: the wordmark is shorter
        // than the mark, so its rows sit level with the anvil's lowest ones.
        const word = WORDMARK[i - (MARK.length - WORDMARK.length)]
        return (
          // The row index is a stable identity here: this is fixed-length
          // constant art, never reordered, filtered or appended to.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed constant art
          <Text key={i}>
            {markRow(row, i, colourProp(palette.dim))}
            {word ? (
              <>
                <Text>{GAP}</Text>
                {splitFace(word).map((run, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed constant art
                  <Text key={j} color={colourProp(run.edge ? palette.brand : palette.fg)}>
                    {run.text}
                  </Text>
                ))}
              </>
            ) : null}
          </Text>
        )
      })}
      <Text>{''}</Text>
      <Text>
        <Text color={colourProp(palette.dim)}>{status}</Text>
        <Text>{' '.repeat(gap)}</Text>
        <Text color={colourProp(palette.dim)}>{defaultOutput}</Text>
      </Text>
    </Box>
  )
}
