import { Box, Text } from 'ink'
import { FIELD_WIDTH, fieldBlank } from '../save-as-art.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { Runs } from './Home.js'
import { Prompt } from './Prompt.js'
/** The units `parseSize` accepts, in the order a person scans them. */
export const SIZE_UNIT_IDS = ['b', 'kb', 'mb', 'gb'] as const

export type SizeUnit = (typeof SIZE_UNIT_IDS)[number]

const LABELS: Record<SizeUnit, string> = { b: 'B', kb: 'KB', mb: 'MB', gb: 'GB' }

/**
 * The target size, as one answer in Save as's filled field: the amount after
 * the marker, the units at the field's right. The chosen unit is on Save as's
 * grey chip while the amount is being typed, and becomes its white pill once
 * tab moves to the units — the same two looks the folder has in Save as.
 * Without colour, the chosen unit is bracketed.
 */
export function SizeField({
  value,
  onChange,
  onSubmit,
  placeholder,
  unit,
  unitFocused,
  width,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder: string
  unit: SizeUnit
  unitFocused: boolean
  width: number
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
          isActive={!unitFocused}
          variant="inline"
          width={fieldWidth - 24}
        />
        <Box flexGrow={1} />
        <Text>
          {SIZE_UNIT_IDS.map((id) => {
            const chosen = id === unit
            const label = LABELS[id]
            if (!chosen) {
              return (
                <Text key={id} color={colourProp(palette.dim)}>
                  {`  ${label}  `}
                </Text>
              )
            }
            if (plain) return <Text key={id}>{` [${label}] `}</Text>
            return (
              <Text
                key={id}
                bold
                color={colourProp(unitFocused ? palette.ink : palette.fg)}
                backgroundColor={unitFocused ? palette.pill : palette.folderChip}
              >
                {`  ${label}  `}
              </Text>
            )
          })}
          {'  '}
        </Text>
      </Box>
      {pad}
    </Box>
  )
}
