import { Box, Text, useInput } from 'ink'
import { useRef } from 'react'
import { unescapePath } from '../../utils/unescape-path.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'

interface PromptProps {
  value: string
  onChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder: string
  isActive: boolean
  bordered: boolean
  /**
   * The live terminal width. Ink's `Box` has no notion of the caller's
   * `initialWidth` test prop — left unset, a bordered `Box` expands to fill
   * whatever `stdout.columns` genuinely is, which in production coincides
   * with the width App.tsx computed but in a narrow real terminal (or a test
   * that pins a narrower `initialWidth`) does not. Passing it through
   * explicitly is what keeps the bordered box from overflowing.
   */
  width: number
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
 *
 * On submission the buffer is also reset right here, synchronously, rather
 * than only via the caller clearing `value` and that flowing back through a
 * re-render: two Enter-terminated events delivered in the same synchronous
 * tick (e.g. two paths pasted back to back, or a fast burst of separate
 * writes) reach this same closure before React ever gets a chance to
 * re-render and resync `valueRef` from a cleared `value` prop. Without this,
 * the second event's text would concatenate onto the just-submitted first
 * event's text instead of starting clean, producing a path that exists
 * nowhere on disk.
 */
export function Prompt({
  value,
  onChange,
  onSubmit,
  placeholder,
  isActive,
  bordered,
  width,
}: PromptProps) {
  const palette = useTheme()
  const valueRef = useRef(value)
  // Deliberately a plain assignment in the render body, not a `useEffect`:
  // Ink's renderer has no browser paint to tear before, so there is no
  // "render without committing" hazard `useLayoutEffect` guards against
  // elsewhere. `useInput`'s handler (below) runs between renders, and by
  // reading `valueRef.current` — never the `value` prop directly — it always
  // sees whatever this line last wrote, which is current as of the most
  // recent render, synchronously, with no effect-scheduling delay.
  valueRef.current = value

  useInput(
    (input, key) => {
      if (key.escape) return

      if (key.return) {
        onSubmit(unescapePath(valueRef.current))
        valueRef.current = ''
        onChange('')
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
          onSubmit(unescapePath(next))
          // Reset immediately, same as the key.return branch above: a
          // second merged path+Enter event arriving in the same tick must
          // start from an empty buffer, not concatenate onto this one.
          valueRef.current = ''
          onChange('')
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
      <Text color={colourProp(palette.accent)}>{'› '}</Text>
      {value ? (
        <Text color={colourProp(palette.fg)}>{value}</Text>
      ) : (
        <Text color={colourProp(palette.dim)}>{placeholder}</Text>
      )}
    </Text>
  )

  if (!bordered) return <Box width={width}>{body}</Box>

  return (
    <Box borderStyle="round" borderColor={colourProp(palette.border)} paddingX={1} width={width}>
      {body}
    </Box>
  )
}
