import { Box, Text } from 'ink'
import type { Choice } from '../../core/actions/index.js'
import { type Command, matchCommands } from '../commands.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { Select } from './Select.js'

/**
 * The list that opens when the prompt buffer starts with `/`.
 *
 * Commands are only worth having if they can be found, and this is the whole
 * discovery mechanism — typing `/` is how anyone learns Forge does more than
 * convert. It was the deciding objection to choosing commands over an action
 * menu, and this answers it.
 *
 * Reuses `Select`, so the cursor, the selection band and the width budgeting
 * are the same ones every other list in the shell uses. Rendered only while
 * the buffer opens a command, so it costs nothing on the ordinary path of
 * dropping a file.
 */
export function CommandPalette({
  fragment,
  width,
  onRun,
  onCancel,
}: {
  /** What has been typed after the slash. */
  fragment: string
  width: number
  onRun: (command: Command) => void
  onCancel: () => void
}) {
  const palette = useTheme()
  const matches = matchCommands(fragment)

  if (matches.length === 0) {
    return (
      <Box marginBottom={1}>
        <Text color={colourProp(palette.dim)}>{`  no command matches /${fragment}`}</Text>
      </Box>
    )
  }

  const items: Choice[] = matches.map((c) => ({
    value: c.name,
    label: `/${c.name}`,
    hint: c.description,
  }))

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Select
        width={width}
        items={items}
        onSubmit={(name) => {
          const command = matches.find((c) => c.name === name)
          if (command) onRun(command)
        }}
        onCancel={onCancel}
      />
    </Box>
  )
}
