import { Box, Text, useInput } from 'ink'
import { useRef } from 'react'
import { unescapePath } from '../../utils/unescape-path.js'

interface PromptProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder: string
  isActive: boolean
  bordered: boolean
}

/**
 * The bottom-of-screen input box: where a file gets dropped or a path gets
 * typed. Fully controlled — `value` is owned by the caller — but the text
 * an in-flight `useInput` event must act on is mirrored into `valueRef` on
 * every render, so a burst of stdin events delivered through the same
 * handler closure before React re-renders still accumulates onto the real
 * current value rather than a stale one, and a caller-driven reset (e.g.
 * clearing the field after submit) is picked up the moment it renders. See
 * Select.tsx and PathInput.tsx for the same pattern and its rationale.
 */
export function Prompt({
  value,
  onChange,
  onSubmit,
  placeholder,
  isActive,
  bordered,
}: PromptProps) {
  const valueRef = useRef(value)
  valueRef.current = value

  useInput(
    (input, key) => {
      if (key.escape) return

      if (key.return) {
        onSubmit(unescapePath(valueRef.current))
        return
      }

      if (key.backspace || key.delete) {
        const next = valueRef.current.slice(0, -1)
        valueRef.current = next
        onChange(next)
        return
      }

      if (input) {
        /**
         * Ink does not split a chunk that contains both text and a line
         * ending: a dropped file path and the terminal's own Enter often
         * land in the same `stdin` chunk as one event, whose `input` is
         * `"path\r"` (or `"path\n"`, or `"path\r\n"`) and whose
         * `key.return` is false — and a bare `\n` sets no key flag at all,
         * merged or not. Checking `key.return` alone would silently bake
         * the raw line ending into the buffer and never submit. So an
         * embedded CR/LF is treated as an inline Enter: everything before
         * it is the final value, everything from it onward — the line
         * ending and anything after — is discarded, and submission follows
         * the same path as the `key.return` branch above.
         */
        const breakIndex = input.search(/[\r\n]/)
        if (breakIndex !== -1) {
          const next = valueRef.current + input.slice(0, breakIndex)
          valueRef.current = next
          onChange(next)
          onSubmit(unescapePath(next))
          return
        }

        const next = valueRef.current + input
        valueRef.current = next
        onChange(next)
      }
    },
    { isActive },
  )

  const body = (
    <Text>
      <Text dimColor>{'› '}</Text>
      {value ? <Text>{value}</Text> : <Text dimColor>{placeholder}</Text>}
    </Text>
  )

  if (!bordered) return <Box>{body}</Box>

  return (
    <Box borderStyle="round" borderDimColor paddingX={1}>
      {body}
    </Box>
  )
}
