import { Box, Text } from 'ink'
import type { ReactNode } from 'react'
import { FIELD_WIDTH, fieldBlank } from '../save-as-art.js'
import { useTheme } from '../ThemeContext.js'
import { Runs } from './Home.js'
import { Prompt } from './Prompt.js'

/**
 * Save as's field, for any one-line answer: filled, the block's width (76 at
 * 80 columns, four short of a narrower terminal), a blank row of its fill
 * above and below, and filled at every width — only no colour leaves it bare.
 * `after` follows the value on its line, quiet ("pages each → 4 files");
 * `right` sits at the field's right edge (the size field's units).
 */
export function FilledField({
  value,
  onChange,
  onSubmit,
  placeholder,
  isActive,
  width,
  after,
  right,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder: string
  isActive: boolean
  /** The live terminal width. */
  width: number
  after?: ReactNode
  right?: ReactNode
}) {
  const palette = useTheme()
  const noColour = (process.env.NO_COLOR ?? '') !== ''
  const plain = noColour || palette.selectionBg === ''
  const fieldWidth = Math.max(24, Math.min(FIELD_WIDTH, width - 4))
  const fill = plain ? undefined : palette.selectionBg
  const pad = plain ? null : <Runs row={fieldBlank({ palette, width: fieldWidth })} />
  return (
    <Box marginTop={2} flexDirection="column">
      {pad}
      <Box width={fieldWidth} {...(fill ? { backgroundColor: fill } : {})}>
        <Text> </Text>
        <Prompt
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          isActive={isActive}
          variant="inline"
          after={after}
          width={fieldWidth - 2}
        />
        {right ? (
          <>
            <Box flexGrow={1} />
            {right}
          </>
        ) : null}
      </Box>
      {pad}
    </Box>
  )
}
