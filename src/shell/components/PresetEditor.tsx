import { basename } from 'node:path'
import { Box } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import type { PresetSteps } from '../../core/preset.js'
import type { FormatId, Result } from '../../core/types.js'
import { formatBytes } from '../../core/units.js'
import type { Trail } from '../bar-art.js'
import { windowOver } from '../colour/system-art.js'
import { changePhrase, doneBody, doneLayout } from '../done-art.js'
import { blank, type Row } from '../home-art.js'
import { useElapsed } from '../motion.js'
import {
  type Editor,
  type EditorKey,
  type OpId,
  openEditor,
  press,
  stepsOf,
  withMissing,
  withReasons,
} from '../preset-editor.js'
import { editorLines, OP_NAMES, subLines } from '../preset-editor-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, type ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { doneFacts } from './Done.js'
import { HeaderBar } from './HeaderBar.js'
import { KeyRow, Runs } from './Home.js'

/**
 * Done's rows between the header and the rule, as a window covers them: the
 * same body where Done puts it, so the window opens over the screen it came from.
 */
export function doneUnder(
  palette: ReturnType<typeof useTheme>,
  result: Result,
  mode: ShellMode,
  width: number,
  height: number,
): Row[] {
  const area = height - 3
  const body = doneBody({ palette, facts: doneFacts(result, mode), width })
  const { top } = doneLayout({ height, body: body.length, notes: 0 })
  const under: Row[] = [[], ...Array.from({ length: top }, (): Row => []), ...body]
  while (under.length < area) under.push([])
  return under.slice(0, area)
}

/** What a rerun from the original made, or why it did not. */
export type PresetPreview =
  | { kind: 'ready'; output: string; bytes: number }
  | { kind: 'failed'; op?: OpId | undefined; message: string }

/** Continue editing's window: as wide as the screen allows, colour's Tweak is 56. */
const WINDOW_WIDTH = 68
const SUB_WIDTH = 42
/** A rerun waits this long after the last change, so a typed number runs once. */
const SETTLE_MS = 200
/** W5: the spinner shows only once a rerun has taken this long, the clock after CLOCK_MS. */
const SHOW_MS = 300
const CLOCK_MS = 3000

/** What the window says while a rerun works, by the row last changed. */
const VERBS: Record<OpId, string> = {
  convert: 'Converting',
  quality: 'Converting',
  compress: 'Compressing',
  resize: 'Resizing',
  trim: 'Trimming',
  crop: 'Cropping',
  sharpen: 'Sharpening',
  boost: 'Boosting resolution',
  cutout: 'Removing background',
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Continue editing (W2, mockups/presets-2026-10.html): one window over Done,
 * every operation a row, the file as it is now at its foot. Each change
 * reruns the selected rows from the original (`run`), so the foot is always
 * the real file. ↵ hands the steps to the shell; esc puts everything back.
 */
export function PresetEditorScreen({
  mode,
  trail,
  result,
  width,
  height,
  targets,
  scales,
  cutout,
  initial,
  reasons,
  missing,
  onAdd,
  run,
  onDone,
  onCancel,
}: {
  mode: ShellMode
  trail: Trail
  /** The result Done is showing: the window opens on what made it. */
  result: Result
  width: number
  height: number
  /** What Convert to can become, from the source (invariant 2). */
  targets: FormatId[]
  scales: Array<2 | 3 | 4>
  /** Remove background is offered here (macOS). */
  cutout: boolean
  /** The window as it was left, when it is opened again. */
  initial?: Editor | undefined
  /** Why rows cannot apply to this file (E2); arrives once the image is read. */
  reasons?: Partial<Record<OpId, string>> | undefined
  /** Rows whose extension is not added, by its download's size (E3). */
  missing?: Partial<Record<OpId, number>> | undefined
  /** Adds a row's extension; `missing` drops it once it is in. */
  onAdd?: ((id: OpId) => void) | undefined
  run: (steps: PresetSteps, signal: AbortSignal) => Promise<PresetPreview>
  /** The steps, the newest rerun, and the window as left — it reopens that way. */
  onDone: (steps: PresetSteps, preview: PresetPreview | undefined, editor: Editor) => void
  onCancel: () => void
}) {
  const palette = useTheme()
  const job = result.job
  if (job.op !== 'convert') throw new Error('Continue editing needs a convert result')
  const source = job.sources[0]
  const [editor, setEditor] = useState<Editor>(() =>
    withReasons(
      initial ??
        openEditor({ target: job.target, quality: job.options.quality, targets, scales, cutout }),
      reasons ?? {},
    ),
  )
  const reasonsKey = JSON.stringify(reasons ?? {})
  useEffect(() => {
    setEditor((e) => withReasons(e, JSON.parse(reasonsKey) as Partial<Record<OpId, string>>))
  }, [reasonsKey])
  const missingKey = JSON.stringify(missing ?? {})
  useEffect(() => {
    setEditor((e) => withMissing(e, JSON.parse(missingKey) as Partial<Record<OpId, number>>))
  }, [missingKey])
  // ↵ on a missing extension's offer: the shell adds it, once.
  const adding = editor.sub?.adding ? editor.sub.id : undefined
  useEffect(() => {
    if (adding) onAdd?.(adding)
  }, [adding, onAdd])
  const [preview, setPreview] = useState<PresetPreview | undefined>()
  /** The row whose change is being rerun, while it is. */
  const [busy, setBusy] = useState<OpId | null>(null)
  const changed = useRef<OpId>('convert')
  const elapsed = useElapsed(busy !== null, 80)
  const steps = stepsOf(editor)
  const key = JSON.stringify(steps)
  const first = useRef(key)

  // Rerun from the original when the selected rows change; the newest change wins.
  useEffect(() => {
    if (key === first.current) {
      setPreview(undefined)
      return
    }
    const abort = new AbortController()
    const timer = setTimeout(() => {
      setBusy(changed.current)
      void run(JSON.parse(key) as PresetSteps, abort.signal).then((p) => {
        if (abort.signal.aborted) return
        setPreview(p)
        setBusy(null)
      })
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      abort.abort()
    }
  }, [key, run])

  useKeys((input, k) => {
    if (k.return && !editor.sub) {
      onDone(steps, preview, editor)
      return
    }
    if (k.escape) {
      if (editor.sub) setEditor((e) => press(e, 'left'))
      else onCancel()
      return
    }
    const mapped: EditorKey | undefined = k.upArrow
      ? 'up'
      : k.downArrow
        ? 'down'
        : k.leftArrow
          ? k.shift
            ? 'shiftLeft'
            : 'left'
          : k.rightArrow
            ? k.shift
              ? 'shiftRight'
              : 'right'
            : k.return
              ? 'enter'
              : k.tab
                ? 'tab'
                : k.backspace || k.delete
                  ? 'backspace'
                  : input === ' '
                    ? 'space'
                    : /^[0-9]$/.test(input)
                      ? { digit: input }
                      : undefined
    if (!mapped) return
    setEditor((e) => {
      const next = press(e, mapped)
      // The row this key changed: what the window says while it reruns.
      const row = next.rows.find((r, i) => JSON.stringify(r) !== JSON.stringify(e.rows[i]))
      if (row) changed.current = row.id
      return next
    })
  })

  // The file as it is now: the newest rerun's, or Done's own until one has run.
  const shown =
    preview?.kind === 'ready'
      ? { name: basename(preview.output), bytes: preview.bytes }
      : { name: basename(job.outputs[0]), bytes: result.outputBytes }
  const grew = shown.bytes > source.bytes
  const working = busy !== null && elapsed !== undefined && elapsed >= SHOW_MS
  const foot: Row = working
    ? [
        {
          text: `${SPINNER_FRAMES[Math.floor((elapsed ?? 0) / 80) % SPINNER_FRAMES.length]} `,
          fg: palette.accent,
          bold: true,
        },
        { text: VERBS[busy], fg: palette.fg, bold: true },
        ...((elapsed ?? 0) >= CLOCK_MS
          ? [{ text: `   ${clock(elapsed ?? 0)}`, fg: palette.dim }]
          : []),
      ]
    : preview?.kind === 'failed'
      ? [{ text: `✕ ${preview.message}`, fg: palette.fail }]
      : [
          { text: '✓ ', fg: palette.ok, bold: true },
          { text: shown.name, fg: palette.fg, bold: true },
          { text: '   now ', fg: palette.border },
          { text: formatBytes(shown.bytes), fg: palette.fg, bold: true },
          {
            text: `   ${changePhrase(source.bytes, shown.bytes)}`,
            fg: grew ? palette.larger : palette.ok,
            bold: true,
          },
        ]

  // Done under the window, faded by it.
  const area = height - 3
  const under = doneUnder(palette, result, mode, width, height)
  // As wide as Tweak's window allows, narrower in a narrow terminal.
  const W = Math.min(WINDOW_WIDTH, width - 4)
  const glyph = SPINNER_FRAMES[Math.floor((elapsed ?? 0) / 80) % SPINNER_FRAMES.length] ?? ''
  const lines = editorLines(
    palette,
    editor,
    foot,
    W - 2,
    working && busy ? { id: busy, glyph } : undefined,
  )
  const winTop = Math.max(0, Math.floor((area - lines.length - 2) / 2))
  let rows = windowOver(palette, under, {
    title: 'Continue editing',
    lines,
    width: W,
    columns: width,
    top: winTop,
  })
  const sub = editor.sub
  if (sub) {
    // Under the row it belongs to, from where its value starts; above it when
    // there is no room below. The first window dims behind it.
    const subW = Math.min(SUB_WIDTH, width - 2)
    const sl = subLines(
      palette,
      editor,
      subW - 2,
      source.kind === 'image' ? { width: source.width, height: source.height } : undefined,
    )
    const rowAt = winTop + 1 + 1 + editor.at
    const h = sl.length + 2
    const left = Math.floor((width - W) / 2) + 1 + 3 + 2 + 19 - 2
    rows = windowOver(palette, rows, {
      title: OP_NAMES[sub.id],
      lines: sl,
      width: subW,
      columns: width,
      top: rowAt + 1 + h <= area ? rowAt + 1 : Math.max(0, rowAt - h),
      left: Math.max(0, Math.min(width - subW - 1, left)),
    })
  }

  const lit = editor.rows[editor.at]
  const keys: Array<[string, string]> = sub
    ? sub.add
      ? sub.adding
        ? []
        : [['↵', 'add']]
      : sub.id === 'resize'
        ? [
            ['0–9', 'width'],
            ['tab', 'height'],
            ['↵', 'confirm'],
          ]
        : sub.id === 'compress'
          ? [
              ['0–9', 'size'],
              ['↵', 'confirm'],
            ]
          : [
              ['↑↓', 'choose'],
              ['↵', 'confirm'],
            ]
    : lit?.why
      ? [['↑↓', 'choose']]
      : lit?.id === 'quality'
        ? [
            ['↑↓', 'choose'],
            ['←→', '1'],
            ['⇧←→', '10'],
            ['↵', 'done'],
          ]
        : [
            ['↑↓', 'choose'],
            ['space', 'select'],
            ...(lit && ['convert', 'compress', 'resize', 'crop', 'boost'].includes(lit.id)
              ? ([['→', 'more']] as Array<[string, string]>)
              : []),
            ['↵', 'done'],
          ]

  return (
    <Box flexDirection="column" width={width} height={height}>
      <HeaderBar mode={mode} trail={trail} width={width} />
      {rows.map((row, i) =>
        row.length === 0 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the rows are positional
          <Runs key={i} row={[blank(1)]} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the rows are positional
          <Runs key={i} row={row} />
        ),
      )}
      <Text color={colourProp(palette.border)}>{'─'.repeat(width)}</Text>
      <KeyRow main={keys} foot={[['esc', sub ? 'back' : 'cancel']]} width={width} />
    </Box>
  )
}
