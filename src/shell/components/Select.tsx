import { Box, Text, useInput } from 'ink'
import { useRef, useState } from 'react'
import type { Choice } from '../../core/actions.js'
import { SYMBOLS } from '../theme.js'

interface SelectProps {
  items: Choice[]
  onSubmit: (value: string) => void
  onCancel?: () => void
  showHints?: boolean
  /** Fires whenever the cursor moves, so a parent can preview the highlighted item. */
  onHighlight?: (index: number) => void
  isActive?: boolean
}

export function Select({
  items,
  onSubmit,
  onCancel,
  showHints = true,
  onHighlight,
  isActive = true,
}: SelectProps) {
  const [index, setIndex] = useState(0)

  /**
   * `useInput` handlers are synchronous, but `useState` updates are not —
   * several keypresses can be delivered through the same handler closure
   * before React re-renders, so `useState` cannot be the source of truth
   * for what to act on *right now*. `indexRef` is that source of truth;
   * `index`/`setIndex` exist only to trigger a render with the latest
   * value. In particular, Enter must read `indexRef.current`, not `index`
   * — reading the state would submit whatever was on screen when this
   * render's closure was created, not what the frame the user is looking
   * at actually shows.
   */
  const indexRef = useRef(0)

  const move = (delta: number) => {
    const next = Math.min(Math.max(indexRef.current + delta, 0), items.length - 1)
    if (next === indexRef.current) return // no-op at an end: nothing moved, nothing to report
    indexRef.current = next
    setIndex(next)
    if (onHighlight) onHighlight(next)
  }

  useInput(
    (_input, key) => {
      if (items.length === 0) return
      if (key.downArrow) move(1)
      if (key.upArrow) move(-1)
      if (key.return) {
        const item = items[indexRef.current]
        if (item) onSubmit(item.value)
      }
      if (key.escape && onCancel) onCancel()
    },
    { isActive },
  )

  if (items.length === 0) return null

  const width = Math.max(...items.map((i) => i.label.length))

  return (
    <Box flexDirection="column">
      {items.map((item, i) => {
        const selected = i === index
        return (
          <Text key={item.value}>
            <Text bold={selected}>
              {selected ? `${SYMBOLS.cursor} ` : '  '}
              {item.label.padEnd(width)}
            </Text>
            {showHints && item.hint ? <Text dimColor>{`  ${item.hint}`}</Text> : null}
          </Text>
        )
      })}
    </Box>
  )
}
