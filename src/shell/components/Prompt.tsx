import { Box, Text, useInput } from 'ink'
import { useRef, useState } from 'react'
import stringWidth from 'string-width'
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
 * The drop area: where a file gets dropped or a path gets typed.
 *
 * Fully controlled — `value` is owned by the caller — but the text an
 * in-flight `useInput` event must act on is mirrored into `valueRef` on every
 * render, so a burst of stdin events delivered through the same handler
 * closure before React re-renders still accumulates onto the real current
 * value rather than a stale one, and a caller-driven reset (e.g. clearing the
 * field after submit) is picked up the moment it renders. See Select.tsx and
 * PathInput.tsx for the same pattern and its rationale.
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

  /**
   * Insertion point, counted in code points from the start. A ref for the
   * same reason `valueRef` is: arrow keys and text can arrive in one flush,
   * and each must act on where the caret genuinely is now.
   *
   * Clamped on every read rather than only on write, because the caller can
   * replace `value` from underneath us — Tab completion does exactly that —
   * and a caret left past the new end would insert into nothing.
   */
  // Initialised to the end of whatever the field was mounted with. The rename
  // field is seeded by its parent before this component exists, so the
  // "value changed from outside" check below never fires for that first
  // value — starting at 0 is what put typed text in front of the name.
  const caretRef = useRef(Array.from(value).length)

  /**
   * A caret move changes no text, so `onChange(value)` hands React the string
   * it already has and it bails out of re-rendering — the caret would move in
   * the ref and never on screen. This counter exists solely to give those
   * renders something that actually changed.
   */
  const [, bump] = useState(0)
  const rerender = () => bump((n) => n + 1)

  /**
   * The last value this component itself produced. When `value` arrives
   * different from it, the parent replaced the text from outside — seeding
   * the rename field with a filename, or Tab completing a path — and the
   * caret belongs at the end of the new text, not wherever it happened to sit
   * in the old. Without this the rename field opened with the caret at 0 and
   * everything typed landed in front of the name.
   */
  const ownRef = useRef(value)
  if (value !== ownRef.current) {
    ownRef.current = value
    caretRef.current = Array.from(value).length
  }

  const chars = () => Array.from(valueRef.current)
  const caret = () => Math.min(Math.max(caretRef.current, 0), chars().length)

  const commit = (next: string, at: number) => {
    valueRef.current = next
    caretRef.current = at
    ownRef.current = next
    onChange(next)
  }

  useInput(
    (input, key) => {
      if (key.escape) return

      // Before the text branch: Ink reports Tab with `key.tab` *and* a "\t"
      // in `input`, so falling through would append a literal tab to the path.
      if (key.leftArrow) {
        caretRef.current = Math.max(0, caret() - 1)
        rerender()
        return
      }

      if (key.rightArrow) {
        caretRef.current = Math.min(chars().length, caret() + 1)
        rerender()
        return
      }

      // ctrl-a / ctrl-e, as every readline-driven shell does.
      if (key.ctrl && input === 'a') {
        caretRef.current = 0
        rerender()
        return
      }
      if (key.ctrl && input === 'e') {
        caretRef.current = chars().length
        rerender()
        return
      }

      // ctrl-u clears the whole field, ctrl-w the word before the caret —
      // both the readline bindings, so they need no explaining to anyone who
      // has used a terminal.
      if (key.ctrl && input === 'u') {
        commit('', 0)
        return
      }
      if (key.ctrl && input === 'w') {
        const c = chars()
        const at = caret()
        let i = at
        while (i > 0 && c[i - 1] === ' ') i--
        while (i > 0 && c[i - 1] !== ' ' && c[i - 1] !== '/') i--
        commit([...c.slice(0, i), ...c.slice(at)].join(''), i)
        return
      }

      if (key.return) {
        onSubmit(unescapePath(valueRef.current))
        valueRef.current = ''
        caretRef.current = 0
        onChange('')
        return
      }

      if (key.backspace || key.delete) {
        const c = chars()
        const at = caret()
        if (at === 0) return
        commit([...c.slice(0, at - 1), ...c.slice(at)].join(''), at - 1)
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
        const c = chars()
        const at = caret()

        if (breakIndex !== -1) {
          const next = [...c.slice(0, at), ...input.slice(0, breakIndex), ...c.slice(at)].join('')
          onSubmit(unescapePath(next))
          // Reset immediately, same as the key.return branch above: a
          // second merged path+Enter event arriving in the same tick must
          // start from an empty buffer, not concatenate onto this one.
          valueRef.current = ''
          caretRef.current = 0
          onChange('')
          return
        }

        const typed = Array.from(input)
        commit([...c.slice(0, at), ...typed, ...c.slice(at)].join(''), at + typed.length)
      }
    },
    { isActive },
  )

  const cells = Array.from(value)
  const at = Math.min(Math.max(caretRef.current, 0), cells.length)

  /**
   * The caret is drawn as an inverse block on the character it sits on, and
   * on a trailing space when it is at the end. `inverse` rather than a
   * palette colour: it swaps whatever foreground and background the terminal
   * is already using, so it is visible in either theme and under NO_COLOR,
   * where a coloured caret would vanish along with everything else.
   */
  const before = cells.slice(0, at).join('')
  const under = cells[at] ?? ' '
  const after = cells.slice(at + 1).join('')

  /**
   * `inverse` is an SGR attribute, so with colour suppressed it emits nothing
   * and the caret disappears — leaving no way to tell where typing will land
   * in the middle of a name. Under NO_COLOR the caret becomes a literal
   * glyph instead, which is the same rule the rest of the shell follows:
   * meaning never rides on colour alone (spec §13).
   */
  const noColour = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== ''
  const caretGlyph = (ch: string) =>
    noColour ? <Text color={colourProp(palette.fg)}>{`▏${ch}`}</Text> : <Text inverse>{ch}</Text>

  const line = value ? (
    <Text>
      <Text color={colourProp(palette.fg)}>{before}</Text>
      {isActive ? (
        <Text inverse>{under}</Text>
      ) : (
        <Text color={colourProp(palette.fg)}>{under}</Text>
      )}
      <Text color={colourProp(palette.fg)}>{after}</Text>
    </Text>
  ) : (
    <Text>
      {isActive ? <Text inverse> </Text> : null}
      <Text color={colourProp(palette.dim)}>{placeholder}</Text>
    </Text>
  )

  if (!bordered) {
    return (
      <Box flexDirection="column">
        <Box width={width}>
          <Text>
            <Text color={colourProp(palette.accent)}>{'› '}</Text>
            {line}
          </Text>
        </Box>
      </Box>
    )
  }

  /**
   * A filled drop area, drawn without a border: the fill *is* the boundary,
   * and a stroke around it only competed with the panel it was outlining.
   * Three rows because this is the target you drag a file onto, and a
   * one-line box is a small target.
   *
   * Every row is padded to exactly the same width — an earlier version
   * budgeted the text row differently from the blank ones, which is what left
   * the ragged notch on the right.
   *
   * Measured: Ink trims trailing whitespace from a rendered line, but only
   * when it really is whitespace — with a background set the run ends in the
   * reset sequence and survives intact. So the fill exists exactly when
   * colour does, and under NO_COLOR it collapses to the prompt line alone,
   * which is the right outcome either way.
   */
  const bg = palette.selectionBg === '' ? undefined : palette.selectionBg
  const shown = value === '' ? placeholder : value
  const lead = 4 // two columns of inset, plus the "› "
  const fill = ' '.repeat(Math.max(0, width - lead - stringWidth(shown) - 1))
  const blank = ' '.repeat(Math.max(0, width))

  if (!bg) {
    // No colour: there is no fill to draw, so the prompt is just its line.
    return (
      <Box flexDirection="column">
        <Box width={width}>
          <Text>
            <Text color={colourProp(palette.accent)}>{'  › '}</Text>
            {line}
          </Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Text backgroundColor={bg}>{blank}</Text>
      <Text backgroundColor={bg}>
        <Text color={colourProp(palette.accent)}>{'  › '}</Text>
        {line}
        {fill}
      </Text>
      <Text backgroundColor={bg}>{blank}</Text>
    </Box>
  )
}
