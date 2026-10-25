import { basename } from 'node:path'
import { Box } from 'ink'
import { useEffect, useRef, useState } from 'react'
import { CROP_SHAPES, shapesFor } from '../../core/crop.js'
import type { PlanEvent } from '../../core/execute-jobs.js'
import { FORMATS } from '../../core/formats.js'
import type { PresetSteps } from '../../core/preset.js'
import { resizedSize } from '../../core/size.js'
import type { FormatId, ImageInfo, Result, SourceInfo } from '../../core/types.js'
import { formatBytes, parseSize } from '../../core/units.js'
import type { Trail } from '../bar-art.js'
import { chainLabels, OPS, type Op, type Step, stepLabel, withStep } from '../continue-editing.js'
import { blank, HOME_MARGIN, type Row, type Run, width as widthOf } from '../home-art.js'
import { Text } from '../Text.js'
import { useTheme } from '../ThemeContext.js'
import { colourProp, modeColours, type ShellMode } from '../theme.js'
import { useKeys } from '../useKeys.js'
import { ExactSizeStep } from './ExactSizeStep.js'
import { FileCard } from './FileCard.js'
import { HeaderBar } from './HeaderBar.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'
import { QualityStep } from './QualityStep.js'
import { ResizeStep } from './ResizeStep.js'
import { Select } from './Select.js'
import { SizeField } from './SizeField.js'
import { StepTitle } from './StepTitle.js'
import { Working } from './Working.js'

/** What a rerun from the original made, or why it did not. */
export type Rerun =
  | { kind: 'ready'; output: string; bytes: number; file?: string | undefined }
  | { kind: 'failed'; message: string; error?: unknown }

/** How the steps changed: one added, or the last one undone. */
export type Change = { kind: 'add'; step: Step } | { kind: 'undo' }

type Stage =
  | { at: 'list' }
  | { at: 'compress' }
  | { at: 'quality'; for: 'compress' | FormatId }
  | { at: 'size' }
  | { at: 'resize' }
  | { at: 'exact' }
  | { at: 'crop' }
  | { at: 'format' }
  | { at: 'boost' }
  | { at: 'adding'; op: Op }
  | { at: 'working'; steps: PresetSteps; change: Change; label: string; startedAt: number }

/** What the working line says while a step runs. */
const VERB: Record<Op | 'undo', string> = {
  compress: 'Compressing',
  resize: 'Resizing',
  crop: 'Cropping',
  trim: 'Trimming',
  format: 'Converting',
  sharpen: 'Sharpening',
  boost: 'Boosting resolution',
  cutout: 'Removing background',
  undo: 'Undoing',
}
/** The header's last chip on each step's own screen. */
const TITLE: Record<Op, string> = {
  compress: 'Compress',
  resize: 'Resize',
  crop: 'Crop to shape',
  trim: 'Trim edges',
  format: 'Format',
  sharpen: 'Sharpen',
  boost: 'Boost resolution',
  cutout: 'Remove background',
}
const UNDO = 'undo'
const RULE = '—'

/**
 * Continue editing (decided, mockups/presets-ux-2026-10-round10.html): Done
 * is the hub, and this is one more thing done to the file. One list of every
 * operation, in plain words — Undo for the last step on top once there is
 * one — then the step's own screen where it asks something, then the
 * working screen every job shows. The step is redone from the original with
 * all the steps before it (`run`), and `onFinish` takes the file back to
 * Done, the chain one link longer.
 */
export function ContinueEditingScreen({
  mode,
  trail,
  result,
  original,
  steps,
  undo,
  targets,
  scales,
  cutout,
  reasons,
  missing,
  onAdd,
  run,
  onFinish,
  onFail,
  onCancel,
  width,
  height,
}: {
  mode: ShellMode
  /** Done's trail: the answers so far. */
  trail: Trail
  /** The file as it is now, what Done shows. */
  result: Result
  /** The file every step is redone from. */
  original: ImageInfo
  /** The steps that made the file as it is now. */
  steps: PresetSteps
  /** The last step added, and the steps without it, for Undo. */
  undo?: { label: string; steps: PresetSteps } | undefined
  /** What the file can be converted to (invariant 2). */
  targets: readonly FormatId[]
  scales: ReadonlyArray<2 | 3 | 4>
  /** Remove background is offered here (macOS). */
  cutout: boolean
  /** Why an operation cannot apply to this file: said where its answer would be. */
  reasons: Partial<Record<Op, string>>
  /** An operation whose on-device model is not added, by its download's size. */
  missing: Partial<Record<Op, number>>
  /** Adds an operation's model; resolves once it is in, false if it could not be. */
  onAdd: (op: Op) => Promise<boolean>
  /** Redoes the steps; `onEvent` hears what the run reports, for Working's count. */
  run: (
    steps: PresetSteps,
    signal: AbortSignal,
    onEvent: (event: PlanEvent) => void,
  ) => Promise<Rerun>
  onFinish: (steps: PresetSteps, rerun: Extract<Rerun, { kind: 'ready' }>, change: Change) => void
  /** A step that failed: the error, or what was said of it. */
  onFail: (error: unknown) => void
  onCancel: () => void
  width: number
  height: number
}) {
  const palette = useTheme()
  const [stage, setStage] = useState<Stage>({ at: 'list' })
  const [percent, setPercent] = useState(100)
  const [sizeText, setSizeText] = useState('')
  const [sizeUnit, setSizeUnit] = useState<'kb' | 'mb'>('kb')
  const [unitFocused, setUnitFocused] = useState(false)
  const [quality, setQuality] = useState(steps.quality ?? 80)
  const [count, setCount] = useState<{
    tiles?: { done: number; total: number; since: number }
    search?: { n: number; of: number }
  }>({})
  const job = result.job
  const output = job.outputs[0] ?? ''
  const target = job.op === 'convert' ? job.target : original.format

  // The card: the file as it is now — its format and size; its shape is the
  // original's, as resized.
  const shape = steps.resize ? resizedSize(original, steps.resize) : original
  const current: SourceInfo = {
    ...original,
    path: output,
    format: target,
    bytes: result.outputBytes,
    width: shape.width,
    height: shape.height,
  }

  // The step runs once its answer is in: the rerun from the original, and
  // back to Done; esc stops it and comes back to the list.
  const abort = useRef<AbortController | null>(null)
  const go = (change: Change, next: PresetSteps) => {
    const label = change.kind === 'add' ? VERB[change.step.op] : VERB.undo
    setStage({ at: 'working', steps: next, change, label, startedAt: Date.now() })
  }
  const working = stage.at === 'working' ? stage : undefined
  useEffect(() => {
    if (!working) return
    const controller = new AbortController()
    abort.current = controller
    setCount({})
    // What the run really counts, and nothing it does not: tiles of a picture a
    // model has done, or the tries of a target-size search (invariant 7).
    const onEvent = (event: PlanEvent) => {
      if (controller.signal.aborted) return
      // Each pass of the steps starts uncounted: the last one's bar is not this one's.
      if (event.type === 'job:start') setCount({})
      else if (event.type === 'search:attempt')
        setCount({ search: { n: event.attempt, of: event.of } })
      else if (event.type === 'job:phase' && event.progress.phase === 'tiles') {
        const { done, total } = event.progress
        setCount((c) => ({ tiles: { done, total, since: c.tiles?.since ?? Date.now() } }))
      }
    }
    void run(working.steps, controller.signal, onEvent).then(
      (rerun) => {
        if (controller.signal.aborted) return
        if (rerun.kind === 'ready') onFinish(working.steps, rerun, working.change)
        else onFail(rerun.error ?? rerun.message)
      },
      (e: unknown) => {
        if (!controller.signal.aborted) onFail(e)
      },
    )
    return () => controller.abort()
  }, [working, run, onFinish, onFail])

  const add = (step: Step) => go({ kind: 'add', step }, withStep(steps, step))

  // An operation whose model is not added: ↵ adds it, then it carries on.
  const adding = stage.at === 'adding' ? stage.op : undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per offer taken
  useEffect(() => {
    if (!adding) return
    let live = true
    void onAdd(adding).then((ok) => {
      if (!live) return
      if (ok) choose(adding)
      else setStage({ at: 'list' })
    })
    return () => {
      live = false
    }
  }, [adding])

  const choose = (op: Op) => {
    if (op === 'compress') setStage({ at: 'compress' })
    else if (op === 'resize') setStage({ at: 'resize' })
    else if (op === 'crop') setStage({ at: 'crop' })
    else if (op === 'format') setStage({ at: 'format' })
    else if (op === 'boost') {
      if (scales.length === 1 && scales[0]) add({ op: 'boost', scale: scales[0] })
      else setStage({ at: 'boost' })
    } else add({ op } as Step)
  }

  useKeys(
    (_input, key) => {
      if (key.escape) {
        abort.current?.abort()
        setStage({ at: 'list' })
      }
    },
    { isActive: stage.at === 'working' },
  )
  // The size field's unit, as compress's: tab moves to it, ←→ change it.
  useKeys(
    (_input, key) => {
      if (key.escape && sizeText === '') setStage({ at: 'compress' })
      if (key.tab) setUnitFocused((f) => !f)
      if (unitFocused && (key.leftArrow || key.rightArrow))
        setSizeUnit((u) => (u === 'kb' ? 'mb' : 'kb'))
      if (unitFocused && key.return) submitSize(sizeText)
    },
    { isActive: stage.at === 'size' },
  )
  const submitSize = (typed: string) => {
    const raw = /[a-z]/i.test(typed) ? typed.trim() : `${typed.trim()}${sizeUnit}`
    const bytes = parseSize(raw)
    if (bytes === undefined || bytes <= 0) return
    add({ op: 'compress', bytes })
  }

  // The header: Done's answers, then where this is.
  const here =
    stage.at === 'list'
      ? 'Continue editing'
      : stage.at === 'working'
        ? stage.label
        : stage.at === 'quality'
          ? 'Quality'
          : stage.at === 'size'
            ? 'Target size'
            : stage.at === 'exact'
              ? 'Resize'
              : stage.at === 'adding'
                ? TITLE[stage.op]
                : TITLE[stage.at as Op]
  const answers = trail.answers
  const head = (
    <Box marginBottom={1}>
      <HeaderBar
        mode={mode}
        trail={{ answers, current: here }}
        width={width}
        drift={stage.at === 'working'}
      />
    </Box>
  )
  const card = (
    <Box marginBottom={1} marginLeft={2}>
      <FileCard source={current} width={width - 4} dim={stage.at === 'working'} />
    </Box>
  )
  const aside = `${basename(output)} · ${formatBytes(result.outputBytes)}`
  const back = () => setStage({ at: 'list' })

  let body: React.ReactNode = null
  if (stage.at === 'list') {
    // The chain so far on the title's right, and ? where the next step goes.
    const chain = [
      FORMATS[original.format]?.label ?? original.format,
      ...chainLabels(original.format, steps),
    ]
    const offered = OPS.filter((o) => o.op !== 'cutout' || cutout)
    const items = [
      ...(undo
        ? [
            { value: UNDO, label: `Undo ${undo.label}` },
            { value: RULE, label: '──────────────────', disabled: true },
          ]
        : []),
      ...offered.map((o) => {
        const why = reasons[o.op]
        const away = missing[o.op]
        return why
          ? { value: o.op, label: o.label, hint: why, disabled: true }
          : away !== undefined
            ? { value: o.op, label: o.label, hint: `not added · ${formatBytes(away)}` }
            : { value: o.op, label: o.label }
      }),
    ]
    body = (
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1}>
          <Runs row={chainTitle(palette, mode, chain, width)} />
        </Box>
        <Select
          width={width}
          items={items}
          hints="every"
          pill={() => ({
            node: (
              <Text color={colourProp(palette.dim)} backgroundColor={colourProp(palette.keycapBg)}>
                {' ↵ select '}
              </Text>
            ),
            width: 10,
          })}
          onSubmit={(value) => {
            if (value === UNDO && undo) return go({ kind: 'undo' }, undo.steps)
            const op = value as Op
            if (missing[op] !== undefined) setStage({ at: 'adding', op })
            else choose(op)
          }}
          onCancel={onCancel}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'select'],
            ['esc', 'back to Done'],
          ]}
        />
      </Box>
    )
  } else if (stage.at === 'compress') {
    body = (
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1}>
          <StepTitle mode={mode} title="Method" aside={aside} width={width} />
        </Box>
        <Select
          width={width}
          items={[
            { value: 'quality', label: 'By quality' },
            { value: 'size', label: 'To a target size' },
          ]}
          onSubmit={(v) =>
            setStage(v === 'size' ? { at: 'size' } : { at: 'quality', for: 'compress' })
          }
          onCancel={back}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
            ['esc', 'back'],
          ]}
        />
      </Box>
    )
  } else if (stage.at === 'quality') {
    const forFormat = stage.for !== 'compress' ? stage.for : undefined
    body = (
      <QualityStep
        mode={mode}
        aside={forFormat ? (FORMATS[forFormat]?.label ?? forFormat) : basename(output)}
        min={1}
        max={100}
        step={1}
        value={quality}
        onChange={setQuality}
        onSubmit={(q) =>
          add(
            forFormat
              ? { op: 'format', to: forFormat, quality: q }
              : { op: 'compress', quality: q },
          )
        }
        onCancel={() => setStage(forFormat ? { at: 'format' } : { at: 'compress' })}
        size={{ status: 'idle' }}
        sourceBytes={original.bytes}
        width={width}
        noBigger={!forFormat}
      />
    )
  } else if (stage.at === 'size') {
    body = (
      <Box flexDirection="column" flexGrow={1}>
        <StepTitle mode={mode} title="Target size" aside={aside} width={width} />
        <SizeField
          value={sizeText}
          onChange={setSizeText}
          onSubmit={submitSize}
          placeholder="500"
          unit={sizeUnit}
          units={['kb', 'mb']}
          unitFocused={unitFocused}
          width={width}
        />
        <HintBar
          width={width}
          pairs={[
            ['↵', 'confirm'],
            ['tab', unitFocused ? 'amount' : 'unit'],
            ['esc', 'back'],
          ]}
        />
      </Box>
    )
  } else if (stage.at === 'resize') {
    body = (
      <ResizeStep
        mode={mode}
        aside={`${basename(output)} · ${original.width} × ${original.height}`}
        from={{ width: original.width, height: original.height }}
        percent={percent}
        max={200}
        onChange={setPercent}
        onSubmit={(p) => add({ op: 'resize', spec: { percent: p } })}
        onExact={() => setStage({ at: 'exact' })}
        onCancel={back}
        width={width}
      />
    )
  } else if (stage.at === 'exact') {
    body = (
      <ExactSizeStep
        mode={mode}
        aside={`${basename(output)} · ${original.width} × ${original.height}`}
        from={{ width: original.width, height: original.height }}
        percent={percent}
        onSubmit={(spec) => add({ op: 'resize', spec })}
        onCancel={() => setStage({ at: 'resize' })}
        width={width}
      />
    )
  } else if (stage.at === 'crop') {
    const fits = new Set(shapesFor(original).map((s) => s.label))
    body = (
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1}>
          <StepTitle mode={mode} title="Crop to shape" aside={aside} width={width} />
        </Box>
        <Select
          width={width}
          items={CROP_SHAPES.map((s) => ({
            value: s.label,
            label: s.label,
            disabled: !fits.has(s.label),
          }))}
          onSubmit={(v) => {
            const s = CROP_SHAPES.find((c) => c.label === v)
            if (s) add({ op: 'crop', aspect: { w: s.w, h: s.h } })
          }}
          onCancel={back}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
            ['esc', 'back'],
          ]}
        />
      </Box>
    )
  } else if (stage.at === 'format') {
    body = (
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1}>
          <StepTitle mode={mode} title="Convert to" aside={aside} width={width} />
        </Box>
        <Select
          width={width}
          items={targets
            .filter((t) => t !== target)
            .map((t) => ({ value: t, label: FORMATS[t]?.label ?? t }))}
          onSubmit={(v) => {
            const to = v as FormatId
            if (FORMATS[to]?.lossy) setStage({ at: 'quality', for: to })
            else add({ op: 'format', to })
          }}
          onCancel={back}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
            ['esc', 'back'],
          ]}
        />
      </Box>
    )
  } else if (stage.at === 'boost') {
    body = (
      <Box flexDirection="column" flexGrow={1}>
        <Box marginBottom={1}>
          <StepTitle mode={mode} title="Boost resolution" aside={aside} width={width} />
        </Box>
        <Select
          width={width}
          items={scales.map((s) => ({ value: String(s), label: `${s}×` }))}
          onSubmit={(v) => add({ op: 'boost', scale: Number(v) as 2 | 3 | 4 })}
          onCancel={back}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
            ['esc', 'back'],
          ]}
        />
      </Box>
    )
  } else if (stage.at === 'adding') {
    body = (
      <Working
        mode={mode}
        label={`Adding ${TITLE[stage.op]}`}
        startedAt={Date.now()}
        width={width}
      />
    )
  } else {
    body = (
      <Working
        mode={mode}
        label={
          stage.change.kind === 'add'
            ? `${stage.label} · ${stepLabel(stage.change.step)}`
            : stage.label
        }
        startedAt={stage.startedAt}
        search={count.search}
        tiles={count.tiles}
        stoppable
        width={width}
      />
    )
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {head}
      {card}
      {body}
    </Box>
  )
}

/**
 * The list's title row: "Continue editing" in the mode's colour, and at its
 * right the chain so far — the source quiet, the steps bold, joined by ─▸ —
 * then ?, the one chip, where the next step goes.
 */
export function chainTitle(
  palette: ReturnType<typeof useTheme>,
  mode: ShellMode,
  chain: string[],
  width: number,
): Row {
  const title: Run = { text: 'Continue editing', fg: modeColours(palette, mode).fg, bold: true }
  const arrow: Run = { text: ' ─▸ ', fg: palette.border }
  const links: Run[] = chain.flatMap((t, i): Run[] => [
    ...(i > 0 ? [arrow] : []),
    { text: t, fg: i === 0 ? palette.dim : palette.fg, bold: i > 0 },
  ])
  const slot: Run[] = [
    arrow,
    {
      text: ' ? ',
      fg: palette.accent,
      bold: true,
      ...(palette.keycapBg ? { bg: palette.keycapBg } : {}),
    },
  ]
  const gap = width - 2 * HOME_MARGIN - widthOf([title]) - widthOf([...links, ...slot])
  if (gap < 2) return [blank(HOME_MARGIN), title]
  return [blank(HOME_MARGIN), title, blank(gap), ...links, ...slot]
}
