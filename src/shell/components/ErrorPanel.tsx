import { Box } from 'ink'
import type { ForgeError } from '../../core/errors.js'
import { errorPanel } from '../error-art.js'
import { HOME_MARGIN } from '../home-art.js'
import { useTheme } from '../ThemeContext.js'
import { Runs } from './Home.js'

/**
 * E5: a failure that ends in the scrollback, as the "failed" tab on a tinted
 * panel (see `error-art.ts`). `width` is the panel's, without the margin. The
 * hint is the shell's phrasing where the error has one.
 */
export function ErrorPanel({ error, width }: { error: ForgeError; width: number }) {
  const palette = useTheme()
  // Read at render time, as `KeyRow` reads it: NO_COLOR strips every fill.
  const plain = (process.env.NO_COLOR ?? '') !== ''
  const rows = errorPanel({
    palette,
    title: error.title,
    detail: error.detail,
    hint: error.shellHint ?? error.hint,
    width,
    plain,
  })
  return (
    <Box flexDirection="column" marginLeft={HOME_MARGIN}>
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the rows are positional
        <Runs key={i} row={row} />
      ))}
    </Box>
  )
}
