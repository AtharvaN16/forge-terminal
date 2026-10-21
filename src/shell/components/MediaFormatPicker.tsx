import { Box } from 'ink'
import { useRef, useState } from 'react'
import type { FormatId } from '../../core/types.js'
import { blank, type Run } from '../home-art.js'
import {
  mediaBoxes,
  mediaDetailRow,
  mediaHint,
  mediaPickerRows,
  placeOf,
} from '../media-picker-art.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { StepTitle } from './StepTitle.js'

/**
 * A video's Convert to: the boxes (media-picker-art.ts). ←→ moves between
 * boxes, ↑↓ within one, ↵ takes the chosen format. `missing`: ffmpeg is not
 * here yet, so the detail line says how to get it instead.
 */
export function MediaFormatPicker({
  mode,
  targets,
  initial,
  missing,
  onSubmit,
  onCancel,
  width,
}: {
  mode: ShellMode
  targets: readonly FormatId[]
  initial?: FormatId | undefined
  /** How to get ffmpeg, when it is not on this computer: "brew install ffmpeg". */
  missing?: string | undefined
  onSubmit: (id: FormatId) => void
  onCancel: () => void
  width: number
}) {
  const palette = useTheme()
  const boxes = mediaBoxes(targets)
  const first = boxes[0]?.ids[0]
  const start = initial && targets.includes(initial) ? initial : first
  const [chosen, setChosen] = useState<FormatId | undefined>(start)
  // A ref too: ↵ in the same burst as an arrow takes the format just reached.
  const ref = useRef(chosen)
  const go = (id: FormatId | undefined) => {
    if (!id) return
    ref.current = id
    setChosen(id)
  }

  useKeys((_input, key) => {
    const now = ref.current
    if (!now) return
    const at = placeOf(boxes, now)
    if (key.escape) onCancel()
    else if (key.return) onSubmit(now)
    else if (key.upArrow) go(boxes[at.box]?.ids[Math.max(0, at.row - 1)])
    else if (key.downArrow) {
      const ids = boxes[at.box]?.ids ?? []
      go(ids[Math.min(ids.length - 1, at.row + 1)])
    } else if (key.leftArrow || key.rightArrow) {
      const to = boxes[Math.max(0, Math.min(boxes.length - 1, at.box + (key.rightArrow ? 1 : -1)))]
      if (to) go(to.ids[Math.min(at.row, to.ids.length - 1)])
    }
  })

  if (!chosen) return null
  const detail: Run[] = missing
    ? [{ text: `needs ffmpeg · ${missing}`, fg: palette.dim }]
    : [{ text: mediaHint(chosen), fg: palette.dim }]
  const span = Math.max(30, width - 2)
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box marginBottom={1}>
        <StepTitle mode={mode} title="Convert to" width={width} />
      </Box>
      {mediaPickerRows({ palette, boxes, chosen, width: span }).map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
        <Runs key={i} row={[blank(1), ...row]} />
      ))}
      <Box marginTop={1}>
        <Runs row={[blank(1), ...mediaDetailRow(palette, chosen, detail)]} />
      </Box>
      <HintBar
        width={width}
        pairs={[
          ['↑↓←→', 'choose'],
          ['↵', 'confirm'],
          ['esc', 'remove file'],
        ]}
      />
    </Box>
  )
}
