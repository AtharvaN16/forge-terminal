import { Box, Text, useInput } from 'ink'
import { useState } from 'react'
import type { Choice } from '../../core/actions.js'
import { SYMBOLS } from '../theme.js'

interface SelectProps {
  items: Choice[]
  onSubmit: (value: string) => void
  onCancel?: () => void
  showHints?: boolean
  /** Fires whenever the cursor moves, so a parent can preview the highlighted item. */
  onHighlight?: (index: number) => void
}

export function Select({ items, onSubmit, onCancel, showHints = true, onHighlight }: SelectProps) {
  const [index, setIndex] = useState(0)

  /**
   * Reads and writes via the functional updater, not the closured `index`.
   * Ink delivers each keypress through the same registered handler, and
   * several presses can arrive before React re-renders (e.g. a caller that
   * writes multiple escape sequences in one burst) — a closure read would
   * clamp every one of them against the same stale starting index instead
   * of walking forward one step at a time.
   */
  const move = (delta: number) => {
    setIndex((current) => {
      const next = Math.max(0, Math.min(items.length - 1, current + delta))
      if (next !== current && onHighlight) onHighlight(next)
      return next
    })
  }

  useInput((_input, key) => {
    if (items.length === 0) return
    if (key.downArrow) move(1)
    if (key.upArrow) move(-1)
    if (key.return) {
      const item = items[index]
      if (item) onSubmit(item.value)
    }
    if (key.escape && onCancel) onCancel()
  })

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
