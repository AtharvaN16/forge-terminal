import { Box, Text, useInput } from 'ink'
import { useRef, useState } from 'react'
import type { Choice, PathPreset } from '../../core/actions.js'
import { unescapePath } from '../../utils/unescape-path.js'
import { SYMBOLS } from '../theme.js'
import { Select } from './Select.js'

const TYPE_IT = '__type__'

interface PathInputProps {
  label: string
  presets: PathPreset[]
  /** Renders the resolved output filename for a candidate destination. */
  preview: (path: string) => string
  onSubmit: (path: string) => void
  onCancel?: () => void
}

/**
 * A destination picker: preset folders via `Select`, plus a "type a path"
 * escape hatch that swaps in a free-text field. The preview follows
 * whichever preset is highlighted, driven entirely by `Select`'s
 * `onHighlight` — this component never registers its own arrow-key
 * handler, since Ink delivers input to every mounted `useInput` hook and
 * two handlers would both move on one keypress.
 */
export function PathInput({ label, presets, preview, onSubmit, onCancel }: PathInputProps) {
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

  const items: Choice[] = [
    ...presets.map((p) => ({ value: p.path, label: p.label, hint: p.path })),
    { value: TYPE_IT, label: 'Type a path…' },
  ]

  useInput(
    (input, key) => {
      if (key.escape) {
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
      if (input) {
        textRef.current += input
        setText(textRef.current)
      }
    },
    { isActive: typing },
  )

  if (typing) {
    return (
      <Box flexDirection="column">
        <Text>{label}</Text>
        <Text>
          {'› '}
          {text}
        </Text>
      </Box>
    )
  }

  const highlighted = items[highlight]

  return (
    <Box flexDirection="column">
      <Text>{label}</Text>
      <Select
        items={items}
        onHighlight={setHighlight}
        onSubmit={(value) => {
          if (value === TYPE_IT) setTyping(true)
          else onSubmit(value)
        }}
        {...(onCancel ? { onCancel } : {})}
      />
      {highlighted && highlighted.value !== TYPE_IT ? (
        <Text dimColor>
          {'  '}
          {SYMBOLS.arrow} {preview(highlighted.value)}
        </Text>
      ) : null}
    </Box>
  )
}
