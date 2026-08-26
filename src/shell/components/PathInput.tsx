import { Box, Text } from 'ink'
import { useRef, useState } from 'react'
import stringWidth from 'string-width'
import type { Choice, PathPreset } from '../../core/actions/index.js'
import { unescapePath } from '../../utils/unescape-path.js'
import { isStrayEscapeSequence } from '../mouse.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, SYMBOLS } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { middleEllipsis } from '../width.js'
import { Select } from './Select.js'

const TYPE_IT = '__type__'

interface PathInputProps {
  label: string
  presets: PathPreset[]
  /** Renders the resolved output filename for a candidate destination. */
  preview: (path: string) => string
  onSubmit: (path: string) => void
  onCancel?: () => void
  /**
   * The live terminal width. A preset's hint is its *absolute* path, which is
   * routinely longer than the terminal on its own — spec §13 says content is
   * truncated with a middle ellipsis, never wrapped and never allowed to
   * overflow, so the hints have to be budgeted against a real number rather
   * than printed at whatever length they happen to be.
   */
  width: number
  /** False in the compact band (<60 columns), exactly as the target picker does. */
  showHints: boolean
  /** The folder currently saved as the default, so its row can be tagged. */
  defaultPath: string
  /** Called when `d` is pressed on a highlighted preset. */
  onMakeDefault?: (path: string) => void
  /** Called when `r` is pressed, carrying the highlighted destination. */
  onRename?: (path: string) => void
}

/**
 * A destination picker: preset folders via `Select`, plus a "type a path"
 * escape hatch that swaps in a free-text field. The preview follows
 * whichever preset is highlighted, driven entirely by `Select`'s
 * `onHighlight` — this component never registers its own arrow-key
 * handler, since Ink delivers input to every mounted `useInput` hook and
 * two handlers would both move on one keypress.
 */
export function PathInput({
  label,
  presets,
  preview,
  onSubmit,
  onCancel,
  width,
  showHints,
  defaultPath,
  onMakeDefault,
  onRename,
}: PathInputProps) {
  const palette = useTheme()
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  const [highlight, setHighlight] = useState(0)

  /**
   * As in Select.tsx: `useInput` handlers are synchronous but `useState`
   * updates are not, so a whole dropped/pasted path — and, close behind
   * it, the Enter that submits — can be delivered through this handler
   * before React re-renders in between. `textRef` is the source of truth
   * Enter reads from; `text`/`setText` exist only to trigger a render with
   * the latest value for display.
   */
  const textRef = useRef('')

  const labels = [...presets.map((p) => p.label), 'Type a path…']
  // Mirrors the row `Select` actually draws: two columns of cursor gutter,
  // the padded label column, then two columns of gap before the hint.
  const labelColumn = Math.max(0, ...labels.map((l) => stringWidth(l)))
  const hintBudget = Math.max(8, width - labelColumn - 4)

  const items: Choice[] = [
    ...presets.map((p) => {
      const isDefault = p.path === defaultPath
      // The badge has its own column, so the path is given a smaller budget
      // when one is present rather than letting the row grow past the width.
      const budget = isDefault ? Math.max(8, hintBudget - 12) : hintBudget
      return {
        value: p.path,
        label: p.label,
        hint: middleEllipsis(p.path, budget),
        ...(isDefault ? { badge: 'default' } : {}),
      }
    }),
    { value: TYPE_IT, label: 'Type a path…' },
  ]

  /**
   * Separate from the typing handler below and gated on `!typing`, because
   * Ink delivers input to every mounted `useInput` hook: without the gate a
   * `d` typed into the free-text path field would also fire this and quietly
   * rewrite the user's default.
   */
  useKeys(
    (input) => {
      const item = items[highlight]
      if (!item || item.value === TYPE_IT) return

      if (input === 'r' && onRename) {
        onRename(item.value)
        return
      }

      if (input !== 'd' || !onMakeDefault) return
      // Already the default: a no-op, not an error. Pressing d twice is a
      // reasonable thing for someone to do.
      if (item.value === defaultPath) return
      onMakeDefault(item.value)
    },
    { isActive: !typing },
  )

  useKeys(
    (input, key) => {
      // Clears first, same as `Prompt`: only once the field is already
      // empty does escape fall through to backing out of typing mode.
      if (key.escape) {
        if (textRef.current !== '') {
          textRef.current = ''
          setText('')
          return
        }
        onCancel?.()
        return
      }
      if (key.return) {
        onSubmit(unescapePath(textRef.current))
        return
      }
      if (key.backspace || key.delete) {
        textRef.current = textRef.current.slice(0, -1)
        setText(textRef.current)
        return
      }
      // An unhandled Ctrl chord (e.g. Ctrl+N) is not text — without this an
      // unclaimed one would fall through and type its bare letter.
      if (key.ctrl) return
      if (input) {
        /**
         * A DSR reply or a mouse report Ink could not resolve reaches here
         * looking like ordinary text starting with `[` — its leading ESC is
         * already gone. See `isStrayEscapeSequence` in mouse.ts for why the
         * match is this narrow: brackets are legal in filenames, and
         * `shot[1].png` must still type.
         */
        if (isStrayEscapeSequence(input)) return

        /**
         * Ink does not split a chunk that contains both text and a line
         * ending: a dropped path with a trailing newline — e.g. one copied
         * from a file listing or an editor's multi-line selection — and the
         * terminal's own Enter land in the same `stdin` chunk as one event,
         * whose `input` is `"path\r"` (or `\n`, or `\r\n`) and whose
         * `key.return` is false. Checking `key.return` alone would silently
         * bake a raw CR/LF into the buffer and never submit. So an embedded
         * CR/LF is treated as an inline Enter: everything before it is the
         * final text, everything from it onward — the line ending and
         * anything after — is discarded, and submission follows the same
         * path as the `key.return` branch above.
         */
        const breakIndex = input.search(/[\r\n]/)
        if (breakIndex !== -1) {
          textRef.current += input.slice(0, breakIndex)
          setText(textRef.current)
          onSubmit(unescapePath(textRef.current))
          return
        }
        textRef.current += input
        setText(textRef.current)
      }
    },
    { isActive: typing },
  )

  if (typing) {
    return (
      <Box flexDirection="column">
        <Text color={colourProp(palette.dim)}>{label}</Text>
        <Text>
          <Text color={colourProp(palette.accent)}>{'› '}</Text>
          <Text color={colourProp(palette.fg)}>{text}</Text>
        </Text>
      </Box>
    )
  }

  const highlighted = items[highlight]

  return (
    <Box flexDirection="column">
      <Text color={colourProp(palette.label)}>{label}</Text>
      <Select
        width={width}
        items={items}
        onHighlight={setHighlight}
        onSubmit={(value) => {
          if (value === TYPE_IT) setTyping(true)
          else onSubmit(value)
        }}
        showHints={showHints}
        {...(onCancel ? { onCancel } : {})}
      />
      {highlighted && highlighted.value !== TYPE_IT ? (
        <Box marginTop={1}>
          <Text color={colourProp(palette.dim)}>
            {'  '}
            {SYMBOLS.arrow} {preview(highlighted.value)}
          </Text>
        </Box>
      ) : null}
    </Box>
  )
}
