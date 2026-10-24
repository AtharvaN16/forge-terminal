import { basename, dirname } from 'node:path'
import { Box } from 'ink'
import { useEffect, useRef, useState } from 'react'
import stringWidth from 'string-width'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { FORMATS } from '../../core/formats.js'
import { type Preset, passesFor } from '../../core/preset.js'
import { runPreset } from '../../core/preset-run.js'
import type { ImageInfo, Result } from '../../core/types.js'
import { displayPath } from '../../utils/display-path.js'
import { blank, HOME_MARGIN, type Row, type Run } from '../home-art.js'
import { motionEnabled, useTicker } from '../motion.js'
import { passLabels } from '../preset-runs.js'
import { useTheme } from '../ThemeContext.js'
import type { ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { clockFor } from '../working-art.js'
import { FileCard } from './FileCard.js'
import { HeaderBar } from './HeaderBar.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'

/** What the header's last chip says while a pass runs, by what it does. */
function verbOf(
  labels: readonly string[],
  pass: ReturnType<typeof passesFor>[number] | undefined,
): string {
  if (!pass) return 'Working'
  if (pass.kind === 'cutout') return 'Removing background'
  if (pass.kind === 'boost') return pass.scale === 1 ? 'Sharpening' : 'Boosting'
  if (pass.kind === 'cut')
    return labels.includes('Trim')
      ? 'Trimming'
      : labels.some((l) => l.includes(':'))
        ? 'Cropping'
        : 'Resizing'
  return 'Converting'
}

/**
 * A preset running on a staged file (R6, decided in
 * mockups/presets-ux-2026-10-round10.html): the header drifting, the file's
 * card, one line — the preset's name, which step of how many, the clock —
 * and under it the chain: steps done ticked, the step working now the one
 * chip, spinning, the rest still to come, quiet. A step is a pass of the run
 * (one encode can carry the convert and the resize), so the count is true.
 */
export function PresetRunScreen({
  mode,
  preset,
  source,
  output,
  onDone,
  onFail,
  onCancel,
  width,
  height,
}: {
  mode: ShellMode
  preset: Preset
  source: ImageInfo
  /** Where the file goes (`presetOutput`). */
  output: string
  onDone: (result: Result) => void
  onFail: (error: unknown) => void
  /** esc: stopped, nothing written. */
  onCancel: () => void
  width: number
  height: number
}) {
  const palette = useTheme()
  const passes = passesFor(preset.steps, source.format)
  const labels = passLabels(passes, source.format)
  const [at, setAt] = useState(0)
  const [startedAt] = useState(() => Date.now())
  const abort = useRef<AbortController | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on the preset and file it opened with
  useEffect(() => {
    const controller = new AbortController()
    abort.current = controller
    void runPreset(source, passes, output, {
      force: false,
      signal: controller.signal,
      onPass: setAt,
    }).then(
      (outcome) => {
        if (controller.signal.aborted) return
        if (outcome.kind === 'done') onDone(outcome.result)
        else if (outcome.kind === 'cancelled') onCancel()
        else onFail(outcome.kind === 'unreachable' ? outcome.entry.error : outcome.error)
      },
      (e: unknown) => {
        if (!controller.signal.aborted) onFail(e)
      },
    )
    return () => controller.abort()
  }, [])

  useKeys((_input, key) => {
    if (key.escape) {
      abort.current?.abort()
      onCancel()
    }
  })

  const on = motionEnabled(palette.name)
  const n = useTicker(true, 80)
  const spinner = on ? SPINNER_FRAMES[n % SPINNER_FRAMES.length] : undefined
  const clock = clockFor(Date.now() - startedAt)
  const verb = verbOf(labels[at] ?? [], passes[at])

  // The working line: the preset's name, which step of how many, the clock at the line's end.
  const head: Row = [
    blank(HOME_MARGIN + 2),
    { text: preset.name, fg: palette.fg, bold: true },
    { text: `  step ${at + 1} of ${passes.length}`, fg: palette.dim },
  ]
  const used = head.reduce((w, r) => w + stringWidth(r.text), 0)
  const withCount: Row = clock
    ? [
        ...head,
        blank(Math.max(1, width - HOME_MARGIN - used - stringWidth(clock))),
        { text: clock, fg: palette.border },
      ]
    : head

  const arrow: Run = { text: ' ─▸ ', fg: palette.border }
  const chain: Row = [
    blank(HOME_MARGIN + 2),
    { text: FORMATS[source.format]?.label ?? source.format, fg: palette.dim },
  ]
  labels.forEach((group, i) => {
    const text = group.join(' ─▸ ')
    chain.push(arrow)
    if (i < at)
      chain.push({ text: '✓ ', fg: palette.ok, bold: true }, { text, fg: palette.fg, bold: true })
    else if (i === at) {
      const chip = palette.panelBand ? { bg: palette.panelBand } : {}
      chain.push({
        text: ` ${spinner ? `${spinner} ` : ''}${text} `,
        fg: palette.accent,
        bold: true,
        ...chip,
      })
    } else chain.push({ text, fg: palette.faint })
  })

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Box marginBottom={1}>
        <HeaderBar
          mode={mode}
          trail={{
            answers: [preset.name, displayPath(dirname(output)), basename(output)],
            current: verb,
          }}
          width={width}
          drift
        />
      </Box>
      <Box marginBottom={1} marginLeft={2}>
        <FileCard source={source} width={width - 4} dim />
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Runs row={withCount} />
        <Box marginTop={1}>
          <Runs row={chain} />
        </Box>
        <HintBar width={width} pairs={[['esc', 'stop']]} foot={[['ctrl-c', 'quit']]} />
      </Box>
    </Box>
  )
}
