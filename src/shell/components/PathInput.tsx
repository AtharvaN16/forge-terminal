import { Box, Text } from 'ink'
import { useMemo, useRef, useState } from 'react'
import stringWidth from 'string-width'
import type { PathPreset } from '../../core/actions/index.js'
import { destinationRows, isPathQuery, NO_MATCH } from '../destinations.js'
import { easeOut, mix, motionEnabled, useTween } from '../motion.js'
import { isStrayEscapeSequence } from '../mouse.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { middleEllipsis } from '../width.js'
import { Select } from './Select.js'

/** The frame stops growing here; a wider terminal just has more room around it. */
const FRAME_MAX = 72
/** How long a dropped path's flash takes to fade. */
const DROP_FLASH_MS = 450
const PLACEHOLDER = 'type to filter, or drop a file'

interface PathInputProps {
  label: string
  presets: PathPreset[]
  /** Renders the resolved output filename for a candidate destination. */
  preview: (path: string) => string
  onSubmit: (path: string) => void
  onCancel?: () => void
  /**
   * The live terminal width. Every line — frame, input and rows — fits
   * inside it; long paths are cut with a middle ellipsis (spec §13).
   */
  width: number
  /** False in the compact band (<60 columns): the places show names only. */
  showHints: boolean
  /** The folder currently saved as the default, so its row can be tagged. */
  defaultPath: string
  /** Called when tab is pressed on a highlighted place. */
  onMakeDefault?: (path: string) => void
}

/**
 * Save to: a framed search box over the places. `/pdf` asks where its page
 * operations go with this; convert and compress ask with Save as
 * (`SaveAs.tsx`), which lists the same `destinationRows`.
 *
 * ```
 * ╭─ Save to ──────────────────────────────╮
 * │ ›  type to filter, or drop a file  4/4 │
 * ├────────────────────────────────────────┤
 * │ ▌ Desktop    ~/Desktop/photo.jpg  ★ default │
 * ╰────────────────────────────────────────╯
 * ```
 *
 * Two input handlers share the keyboard, deliberately split by key: the
 * list (`Select`) owns ↑↓, ↵ and esc; this component owns text, backspace
 * and tab. Ink delivers every key to every mounted handler, so each one
 * ignores the other's keys rather than both acting on one press.
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
}: PathInputProps) {
  const palette = useTheme()
  const [text, setText] = useState('')

  /**
   * `useInput` handlers are synchronous but `useState` updates are not, so a
   * whole dropped path — and, close behind it, the Enter that submits — can
   * arrive before React re-renders. `textRef` is the source of truth those
   * handlers read; `text` exists to trigger a render.
   */
  const textRef = useRef('')
  const setBoth = (next: string) => {
    textRef.current = next
    setText(next)
  }

  // Memoised on the text: in path mode each call stats the disk, and a redraw
  // (the drop flash runs ~14 of them) must not stat it again each time.
  const rows = useMemo(
    () => destinationRows(text, presets, defaultPath, preview),
    [text, presets, defaultPath, preview],
  )
  /** The text the list on screen was built from. */
  const drawnText = useRef(text)
  drawnText.current = text
  const listKey = rows.map((r) => r.value).join('\n')
  const [highlight, setHighlight] = useState({ listKey, index: 0 })
  const isPath = isPathQuery(text)

  // A paste is one multi-character chunk; that is what a drop looks like.
  const [droppedAt, setDroppedAt] = useState(0)
  const flash = easeOut(
    useTween(droppedAt, DROP_FLASH_MS, { enabled: droppedAt > 0 && motionEnabled(palette.name) }),
  )

  useKeys((input, key) => {
    /**
     * Enter normally belongs to the list. But a dropped path and the Enter
     * after it can both arrive before React redraws, and then the list on
     * screen is still built from the old text — it would save to whichever
     * place happened to be highlighted. So when the text has moved on since
     * the last draw, Enter is resolved here from the text itself, and the
     * list's own submit stands down (see `onSubmit` below).
     */
    if (key.return) {
      if (textRef.current === drawnText.current) return
      const row = destinationRows(textRef.current, presets, defaultPath, preview)[0]
      if (row && !row.disabled) onSubmit(row.value)
      return
    }
    // The list's keys: Select acts on these.
    if (key.escape || key.upArrow || key.downArrow) return
    if (key.tab) {
      const row = rows[highlight.listKey === listKey ? highlight.index : 0]
      if (!isPath && row && !row.disabled && row.value !== defaultPath) onMakeDefault?.(row.value)
      return
    }
    if (key.backspace || key.delete) {
      setBoth(textRef.current.slice(0, -1))
      return
    }
    // An unhandled Ctrl chord (e.g. Ctrl+N) is not text — without this an
    // unclaimed one would fall through and type its bare letter.
    if (key.ctrl || key.meta || !input) return
    /**
     * A DSR reply or a mouse report Ink could not resolve reaches here looking
     * like ordinary text starting with `[` — its leading ESC is already gone.
     * See `isStrayEscapeSequence` in mouse.ts for why the match is this
     * narrow: brackets are legal in filenames, and `shot[1].png` must type.
     */
    if (isStrayEscapeSequence(input)) return

    /**
     * Ink does not split a chunk that holds both text and a line ending: a
     * dropped path with a trailing newline and the terminal's own Enter land
     * as one event whose `input` is `"path\r"` and whose `key.return` is
     * false. Everything before the break is the final text, and it submits
     * through the row that text resolves to.
     */
    const breakAt = input.search(/[\r\n]/)
    if (breakAt !== -1) {
      const final = textRef.current + input.slice(0, breakAt)
      setBoth(final)
      const row = destinationRows(final, presets, defaultPath, preview)[0]
      if (row && !row.disabled) onSubmit(row.value)
      return
    }
    if (input.length > 1) setDroppedAt(Date.now())
    setBoth(textRef.current + input)
  })

  const frameW = Math.max(20, Math.min(width, FRAME_MAX))
  const inner = frameW - 4
  const edge = colourProp(palette.border)

  const title = middleEllipsis(label, inner - 2)
  const rule = '─'.repeat(Math.max(0, frameW - 5 - stringWidth(title)))

  const matches = rows.filter((r) => !r.disabled).length
  const count = isPath ? '' : `${matches}/${presets.length}`
  const room = Math.max(4, inner - 2 - 1 - (count ? stringWidth(count) + 2 : 0))
  const shown = middleEllipsis(text, room)
  const inputBg =
    droppedAt > 0 && flash < 1 && palette.band !== ''
      ? mix(palette.band, palette.canvas, flash)
      : undefined

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={edge}>{'╭─ '}</Text>
        <Text bold color={colourProp(palette.accent)}>
          {title}
        </Text>
        <Text color={edge}>{` ${rule}╮`}</Text>
      </Text>
      <Box width={frameW}>
        <Text color={edge}>{'│ '}</Text>
        <Box width={inner} {...(inputBg ? { backgroundColor: inputBg } : {})}>
          <Text color={colourProp(palette.accent)}>{'› '}</Text>
          {text === '' ? (
            <Text>
              <Text inverse> </Text>
              <Text color={colourProp(palette.dim)}>
                {` ${middleEllipsis(PLACEHOLDER, Math.max(0, room - 1))}`}
              </Text>
            </Text>
          ) : (
            <Text>
              <Text color={colourProp(palette.fg)}>{shown}</Text>
              <Text inverse> </Text>
            </Text>
          )}
          <Box flexGrow={1} />
          {count ? <Text color={colourProp(palette.dim)}>{count}</Text> : null}
        </Box>
        <Text color={edge}>{' │'}</Text>
      </Box>
      <Text color={edge}>{`├${'─'.repeat(frameW - 2)}┤`}</Text>
      <Box
        width={frameW}
        borderStyle="round"
        borderTop={false}
        borderColor={edge}
        paddingX={1}
        flexDirection="column"
      >
        <Select
          key={listKey}
          width={inner}
          items={rows}
          onHighlight={(index) => setHighlight({ listKey, index })}
          onSubmit={(value) => {
            // A stale list: the text changed since it was drawn, and the
            // handler above has already submitted what the text says.
            if (textRef.current !== drawnText.current) return
            if (value !== NO_MATCH) onSubmit(value)
          }}
          onCancel={() => {
            // Clears first, same as `Prompt`: only once the text is already
            // empty does escape back out of the step.
            if (textRef.current !== '') setBoth('')
            else onCancel?.()
          }}
          showHints={showHints}
        />
      </Box>
    </Box>
  )
}
