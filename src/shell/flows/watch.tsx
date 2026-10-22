import { Box } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { SPINNER_FRAMES } from '../../cli/spinner.js'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { convertAction } from '../../core/actions/convert.js'
import { destinationOption } from '../../core/actions/destination.js'
import type { OptionSpec } from '../../core/actions/index.js'
import type { PlanEvent } from '../../core/execute-jobs.js'
import {
  answerFor,
  defaultAnswer,
  type FolderKind,
  type FolderScan,
  type KindAnswer,
  type KindId,
  kindTargets,
} from '../../core/folder.js'
import { FORMATS } from '../../core/formats.js'
import type { FormatId, Job } from '../../core/types.js'
import {
  convertFolder,
  type KindAnswers,
  planFolder,
  startWatch,
  type WatchSession,
} from '../../core/watch-session.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import type { Trail } from '../bar-art.js'
import { windowOver } from '../colour/system-art.js'
import { HintBar } from '../components/HintBar.js'
import { Runs } from '../components/Home.js'
import { QualityStep } from '../components/QualityStep.js'
import { SaveAs } from '../components/SaveAs.js'
import { Select } from '../components/Select.js'
import { StepTitle } from '../components/StepTitle.js'
import { Working } from '../components/Working.js'
import { NEW_FOLDER } from '../destinations.js'
import { doneBody } from '../done-art.js'
import { blank, HOME_MARGIN, type Row } from '../home-art.js'
import { motionEnabled, useTicker } from '../motion.js'
import { titleRow } from '../quality-art.js'
import { openPath } from '../reveal.js'
import { useTheme } from '../ThemeContext.js'
import { modeColours } from '../theme.js'
import { useKeys } from '../useKeys.js'
import {
  countOf,
  folderCardLines,
  folderFacts,
  hairlineRow,
  kindRow,
  kindTitle,
  kindWindowLines,
  sweepAt,
  type WatchedFile,
  type WindowSetting,
  watchedRow,
  watchListRows,
} from '../watch-art.js'
import { phaseLabel } from '../working-art.js'

/*
 * forge watch in the shell (mockups/watch-2026-10.html, decided round 9):
 * a folder dropped on home in convert mode, then ↵. One kind of file asks
 * as a file does — Convert to, then Quality or Resolution — and a folder of
 * several kinds asks once per kind on Each kind, each kind's answer changed
 * in its own window. Then today's Save as, the folder converted with a real
 * count, and the watching screen: Done's bar for everything so far, the
 * hairline with its light, and each file that lands, newest at the bottom.
 */

type Step = 'kinds' | 'target' | 'setting' | 'save-as' | 'converting' | 'watching'

export interface WatchFlowProps {
  scan: FolderScan
  width: number
  height: number
  prefs: Preferences
  onTrail: (trail: Trail) => void
  /** esc from the first question: back home, the folder still there. */
  onCancel: () => void
  /** ↵ while watching: stop, and home with nothing staged. */
  onClose: () => void
  onMakeDefault?: (path: string) => void
  /** Where the outputs went, as Save as remembers a save. */
  onSaved?: (folder: string) => void
  /** Test seams: how long a landed file must sit still, and how often the folder is looked at. */
  settleMs?: number
  pollMs?: number
}

/** The kinds Forge converts, in the scan's order. */
const convertible = (scan: FolderScan) => scan.kinds.filter((k) => k.why === undefined)

/** A kind's answer as its row says it, as the bar's trail would: "WebP · 80", "PNG · 150 dpi". */
export function answerText(answer: KindAnswer | undefined): string {
  if (!answer) return ''
  return [
    FORMATS[answer.target].label,
    ...(answer.quality === undefined ? [] : [String(answer.quality)]),
    ...(answer.dpi === undefined ? [] : [`${answer.dpi} dpi`]),
  ].join(' · ')
}

/** The setting a target asks for after the format, from the action's own options (invariant 2). */
function settingFor(
  kind: FolderKind,
  target: FormatId,
  prefs: Preferences,
): Extract<OptionSpec, { kind: 'select' | 'slider' }> | undefined {
  const source = kind.sources[0]
  if (!source) return undefined
  const specs = convertAction.options([source], { target }, prefs)
  const spec = specs.find((s) => s.id === 'dpi' || s.id === 'quality')
  return spec?.kind === 'select' || spec?.kind === 'slider' ? spec : undefined
}

const clock = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

/**
 * Rows drawn with the home margin in front (the folder's card, the kinds'
 * rows) give it back here: on the steps, a card and a picker's rows start
 * at the content's edge, as `FileCard` and `Select` do.
 */
function inset(row: Row, n = HOME_MARGIN): Row {
  const out = [...row]
  let left = n
  while (left > 0 && out.length > 0) {
    const first = out[0] as Row[number]
    const lead = first.text.length - first.text.trimStart().length
    if (lead === 0 || first.bg !== undefined) break
    const take = Math.min(lead, left)
    left -= take
    const rest = first.text.slice(take)
    if (rest === '') out.shift()
    else out[0] = { ...first, text: rest }
  }
  return out
}

/** Rows, each on its own line; an empty row keeps its line. */
function Lines({ rows, shift = true }: { rows: Row[]; shift?: boolean }) {
  return (
    <>
      {rows.map((row, i) => {
        const r = shift ? inset(row) : row
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positions on the screen.
        return <Runs key={i} row={r.length > 0 ? r : [blank(1)]} />
      })}
    </>
  )
}

/** The light's pace: one sweep there and back, frames of `FRAME_MS`. */
const SWEEP = 32
const FRAME_MS = 70
/** How long a finished row keeps its band, fading. */
const FLASH_MS = 1700

export function WatchFlow({
  scan,
  width,
  height,
  prefs,
  onTrail,
  onCancel,
  onClose,
  onMakeDefault,
  onSaved,
  settleMs,
  pollMs,
}: WatchFlowProps) {
  const palette = useTheme()
  const mode = 'convert' as const
  const kinds = convertible(scan)
  const mixed = scan.kinds.length > 1
  const only = kinds[0]
  const name = displayName(scan.dir)

  const [answers, setAnswers] = useState<KindAnswers>(() => {
    const out: KindAnswers = {}
    for (const k of kinds) {
      const a = defaultAnswer(k.sources, prefs.quality)
      if (a) out[k.id] = a
    }
    return out
  })
  const [step, setStep] = useState<Step>(mixed ? 'kinds' : 'target')
  const [kindAt, setKindAt] = useState(0)
  const [win, setWin] = useState<{ kind: KindId; focus: number; draft: KindAnswer } | undefined>()

  // Save as, as today: the configured default first, the folder's own place as Same location.
  const first = scan.sources[0]
  const destination = useMemo(
    () => (first ? destinationOption(first, prefs, { subfolder: NEW_FOLDER.convert }) : undefined),
    [first, prefs],
  )
  const [folder, setFolder] = useState(() => expandTilde(prefs.defaultOutput))
  const placeName = (path: string) =>
    destination?.presets.find((p) => p.path === path)?.label ?? displayName(displayPath(path))

  // Converting what is there: a real count, the phase the engine reports.
  const [work, setWork] = useState<{ done: number; total: number; label: string; at: number }>({
    done: 0,
    total: 0,
    label: 'Reading',
    at: Date.now(),
  })
  // Watching: everything converted so far, and each file that has landed.
  const [totals, setTotals] = useState({
    n: 0,
    before: 0,
    after: 0,
    from: new Set<string>(),
    to: new Set<string>(),
  })
  const [files, setFiles] = useState<(WatchedFile & { startedAt: number; doneAt?: number })[]>([])
  const [back, setBack] = useState(0)
  const [fresh, setFresh] = useState(0)
  const backRef = useRef(0)
  backRef.current = back
  const session = useRef<WatchSession | undefined>(undefined)

  // Stopped however the flow goes: ↵, ctrl-n, quitting.
  useEffect(
    () => () => {
      void session.current?.stop()
    },
    [],
  )

  /** The answers the bar's trail says: one kind's format and setting, or how many kinds. */
  const answered = (): string[] => {
    if (mixed) return [`${Object.keys(answers).length} kinds`]
    const a = only ? answers[only.id] : undefined
    if (!a) return []
    return answerText(a).split(' · ')
  }
  const trail: Trail = (() => {
    switch (step) {
      case 'kinds':
        return { answers: [], current: 'Each kind' }
      case 'target':
        return { answers: [], current: 'Format' }
      case 'setting': {
        const a = only ? answers[only.id] : undefined
        return {
          answers: a ? [FORMATS[a.target].label] : [],
          current: a?.dpi !== undefined ? 'Resolution' : 'Quality',
        }
      }
      case 'save-as':
        return { answers: answered(), current: 'Save as' }
      case 'converting':
        return { answers: [...answered(), placeName(folder)], current: 'Converting' }
      case 'watching':
        return { answers: [...answered(), placeName(folder)], current: 'Watching' }
    }
  })()
  const trailKey = JSON.stringify(trail)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the trail is compared by value.
  useEffect(() => {
    onTrail(trail)
  }, [trailKey])

  /** Converts what the folder holds, then watches it. */
  const run = async (to: string) => {
    onSaved?.(to)
    setStep('converting')
    setWork({ done: 0, total: 0, label: 'Reading', at: Date.now() })
    const onEvent = (event: PlanEvent) => {
      if (event.type === 'job:start') {
        setWork((w) => ({ ...w, total: event.total }))
      } else if (
        event.type === 'job:phase' &&
        'phase' in event.progress &&
        event.progress.phase !== 'page' &&
        event.progress.phase !== 'time'
      ) {
        const label = `${phaseLabel(event.job, event.progress.phase)} · ${displayName(event.job.sources[0].path)}`
        setWork((w) => ({ ...w, label }))
      } else if (event.type === 'job:done' || event.type === 'job:error') {
        setWork((w) => ({ ...w, done: event.completed, total: event.total }))
      }
    }
    const done = await convertFolder(scan, answers, { destination: to, onEvent })
    const results = done.outcome.results
    setTotals({
      n: results.length,
      before: results.reduce((t, r) => t + r.job.sources[0].bytes, 0),
      after: results.reduce((t, r) => t + r.outputBytes, 0),
      from: new Set(results.map((r) => FORMATS[r.job.sources[0].format].label)),
      to: new Set(results.map((r) => (r.job.op === 'convert' ? FORMATS[r.job.target].label : ''))),
    })
    setStep('watching')
    session.current = startWatch({
      dir: scan.dir,
      answers,
      known: scan.paths,
      claimed: done.claimed,
      destination: to,
      ...(settleMs === undefined ? {} : { settleMs }),
      ...(pollMs === undefined ? {} : { pollMs }),
      onEvent: (event) => {
        if (event.type === 'arrived') {
          setFiles((f) => [
            ...f,
            {
              path: event.path,
              at: clock(new Date()),
              state: 'running',
              phase: 'Reading',
              startedAt: Date.now(),
            },
          ])
          // Scrolled up, the view stays put and counts what landed below it.
          if (backRef.current > 0) {
            setBack((b) => b + 1)
            setFresh((n) => n + 1)
          }
          return
        }
        const update = (f: WatchedFile & { startedAt: number; doneAt?: number }) => {
          if (event.type === 'phase') {
            return { ...f, phase: event.job ? phaseLabel(event.job, event.phase) : 'Reading' }
          }
          if (event.type === 'converted') {
            const job: Job = event.result.job
            return {
              ...f,
              state: 'done' as const,
              from: FORMATS[job.sources[0].format].label,
              to: job.op === 'convert' ? FORMATS[job.target].label : '',
              bytes: event.result.outputBytes,
              doneAt: Date.now(),
            }
          }
          if (event.type === 'failed') {
            return { ...f, state: 'failed' as const, reason: event.error.title.toLowerCase() }
          }
          return { ...f, state: 'left' as const, reason: event.reason }
        }
        setFiles((list) => {
          const i = list.findLastIndex((f) => f.path === event.path && f.state === 'running')
          if (i < 0) return list
          return list.map((f, k) => (k === i ? update(f) : f))
        })
        if (event.type === 'converted') {
          const r = event.result
          setTotals((t) => ({
            n: t.n + 1,
            before: t.before + r.job.sources[0].bytes,
            after: t.after + r.outputBytes,
            from: new Set([...t.from, FORMATS[r.job.sources[0].format].label]),
            to: new Set([...t.to, r.job.op === 'convert' ? FORMATS[r.job.target].label : '']),
          }))
        }
      },
    })
  }

  /** What Save as says the files will be called: the first, and how many. */
  const fixedName = (to: string) => {
    const { jobs } = planFolder(scan.sources, answers, new Set(), to)
    const outputs = jobs.flatMap((j) => j.outputs)
    const [one] = outputs
    if (!one) return `${scan.sources.length} files`
    return outputs.length > 1 ? `${displayName(one)} … ${outputs.length} files` : displayName(one)
  }

  // The rows the screen has under the bar (a blank row, the bar, a blank
  // row), above the keys (the rule, the keys).
  const avail = Math.max(8, height - 5)
  const card = folderCardLines({
    palette,
    mode,
    name,
    lines: folderFacts({ kinds: scan.kinds, bytes: scan.bytes, files: scan.paths.length }),
    width,
  }).map((r): Row => [blank(HOME_MARGIN), ...r])

  // ---------------------------------------------------------------- Each kind

  useKeys(
    (input, key) => {
      if (step !== 'kinds' || win) return
      const n = scan.kinds.length
      if (key.upArrow) setKindAt((i) => (i - 1 + n) % n)
      else if (key.downArrow) setKindAt((i) => (i + 1) % n)
      else if (key.escape) onCancel()
      else if (input === 's') setStep('save-as')
      else if (key.return) {
        const k = scan.kinds[kindAt]
        const a = k ? answers[k.id] : undefined
        if (k && a) setWin({ kind: k.id, focus: 0, draft: a })
      }
    },
    { isActive: step === 'kinds' && !win },
  )

  const winKind = win ? scan.kinds.find((k) => k.id === win.kind) : undefined
  const winTargets = winKind ? kindTargets(winKind.sources) : []
  const winSetting = win && winKind ? settingFor(winKind, win.draft.target, prefs) : undefined
  useKeys(
    (_input, key) => {
      if (!win || !winKind) return
      const rows = winSetting ? 2 : 1
      if (key.escape) setWin(undefined)
      else if (key.return) {
        setAnswers((a) => ({ ...a, [win.kind]: win.draft }))
        setWin(undefined)
      } else if (key.upArrow || key.downArrow) {
        setWin({ ...win, focus: (win.focus + 1) % rows })
      } else if (key.leftArrow || key.rightArrow) {
        const d = key.rightArrow ? 1 : -1
        if (win.focus === 0) {
          const i = winTargets.indexOf(win.draft.target)
          const target = winTargets[Math.max(0, Math.min(winTargets.length - 1, i + d))]
          if (!target) return
          // A new format keeps the quality it had, where it takes one.
          const next = answerFor(winKind.sources, target, win.draft.quality ?? prefs.quality)
          setWin({ ...win, draft: next })
        } else if (winSetting?.kind === 'slider') {
          const q = win.draft.quality ?? winSetting.default
          const value = Math.max(winSetting.min, Math.min(winSetting.max, q + d * winSetting.step))
          setWin({ ...win, draft: { ...win.draft, quality: value } })
        } else if (winSetting?.kind === 'select') {
          const values = winSetting.choices.map((c) => c.value)
          const i = values.indexOf(String(win.draft.dpi ?? winSetting.default))
          const v = values[Math.max(0, Math.min(values.length - 1, i + d))]
          if (v !== undefined) setWin({ ...win, draft: { ...win.draft, dpi: Number(v) } })
        }
      }
    },
    { isActive: step === 'kinds' && win !== undefined },
  )

  if (step === 'kinds') {
    const body: Row[] = [
      ...card,
      [],
      [blank(HOME_MARGIN), ...titleRow({ palette, mode, title: 'Each kind', width })],
      [],
      ...scan.kinds.map((k, i) =>
        kindRow({
          palette,
          mode,
          kind: k,
          answer: answerText(answers[k.id]),
          selected: i === kindAt,
        }),
      ),
    ]
    const placed = body.map((r) => inset(r))
    while (placed.length < avail) placed.push([])
    let shown = placed
    if (win && winKind) {
      const settings: WindowSetting[] = [
        {
          label: 'Format',
          kind: 'pill',
          value: FORMATS[win.draft.target].label,
          at: winTargets.indexOf(win.draft.target),
          of: winTargets.length,
        },
      ]
      if (winSetting?.kind === 'slider') {
        settings.push({
          label: 'Quality',
          kind: 'slider',
          value: win.draft.quality ?? winSetting.default,
          min: winSetting.min,
          max: winSetting.max,
        })
      } else if (winSetting?.kind === 'select') {
        const values = winSetting.choices.map((c) => c.value)
        const v = String(win.draft.dpi ?? winSetting.default)
        settings.push({
          label: winSetting.label,
          kind: 'pill',
          value: winSetting.choices.find((c) => c.value === v)?.label ?? v,
          at: values.indexOf(v),
          of: values.length,
        })
      }
      const W = 56
      const lines = kindWindowLines({ palette, mode, inner: W - 2, focus: win.focus, settings })
      shown = windowOver(palette, placed, {
        title: kindTitle(winKind.id, winKind.count),
        lines,
        width: W,
        columns: width,
        // In the middle of the screen, above the key row.
        top: Math.max(0, Math.floor((avail - lines.length - 2) / 2)),
      })
    }
    return (
      <Box flexDirection="column" flexGrow={1}>
        <Lines rows={shown} shift={false} />
        {win ? (
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'choose'],
              ['←→', 'change'],
              ['↵', 'done'],
            ]}
            foot={[
              ['esc', 'cancel'],
              ['ctrl-c', 'quit'],
            ]}
          />
        ) : (
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'kind'],
              ['↵', 'change'],
              ['s', 'start'],
            ]}
            foot={[
              ['esc', 'back'],
              ['ctrl-c', 'quit'],
            ]}
          />
        )}
      </Box>
    )
  }

  const cardBox = (
    <Box flexDirection="column" marginBottom={1}>
      <Lines rows={card} />
    </Box>
  )

  // ------------------------------------------------- one kind: Convert to, then its setting

  if (step === 'target' && only) {
    const targets = kindTargets(only.sources)
    const a = answers[only.id]
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <Box marginBottom={1}>
          <StepTitle
            mode={mode}
            title="Convert to"
            aside={countOf(only.id, only.count)}
            width={width}
          />
        </Box>
        <Select
          width={Math.min(width - 4, 60)}
          items={targets.map((t) => ({ value: t, label: FORMATS[t].label, hint: FORMATS[t].hint }))}
          {...(a ? { initialValue: a.target } : {})}
          onSubmit={(value) => {
            const target = value as FormatId
            const next = answerFor(only.sources, target, a?.quality ?? prefs.quality)
            setAnswers((all) => ({ ...all, [only.id]: next }))
            setStep(settingFor(only, target, prefs) ? 'setting' : 'save-as')
          }}
          onCancel={onCancel}
          showHints={width >= 60}
        />
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['↵', 'confirm'],
          ]}
          foot={[
            ['esc', 'back'],
            ['ctrl-c', 'quit'],
          ]}
        />
      </Box>
    )
  }

  if (step === 'setting' && only) {
    const a = answers[only.id]
    const spec = a ? settingFor(only, a.target, prefs) : undefined
    if (a && spec?.kind === 'slider') {
      return (
        <Box flexDirection="column" flexGrow={1}>
          {cardBox}
          <QualityStep
            mode={mode}
            aside={FORMATS[a.target].label}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            value={a.quality ?? spec.default}
            onChange={(quality) => setAnswers((all) => ({ ...all, [only.id]: { ...a, quality } }))}
            onSubmit={(quality) => {
              setAnswers((all) => ({ ...all, [only.id]: { ...a, quality } }))
              setStep('save-as')
            }}
            onCancel={() => setStep('target')}
            size={{ status: 'idle' }}
            sourceBytes={only.bytes}
            width={width}
          />
        </Box>
      )
    }
    if (a && spec?.kind === 'select') {
      return (
        <Box flexDirection="column" flexGrow={1}>
          {cardBox}
          <Box marginBottom={1}>
            <StepTitle
              mode={mode}
              title={spec.label}
              aside={countOf(only.id, only.count)}
              width={width}
            />
          </Box>
          <Select
            width={Math.min(width - 4, 60)}
            items={spec.choices}
            initialValue={String(a.dpi ?? spec.default)}
            onSubmit={(dpi) => {
              setAnswers((all) => ({ ...all, [only.id]: { ...a, dpi: Number(dpi) } }))
              setStep('save-as')
            }}
            onCancel={() => setStep('target')}
            showHints={width >= 60}
          />
          <HintBar
            width={width}
            pairs={[
              ['↑↓', 'choose'],
              ['↵', 'confirm'],
            ]}
            foot={[
              ['esc', 'back'],
              ['ctrl-c', 'quit'],
            ]}
          />
        </Box>
      )
    }
  }

  // ---------------------------------------------------------------- Save as

  if (step === 'save-as' && destination) {
    const back = () => {
      if (mixed) setStep('kinds')
      else if (
        only &&
        answers[only.id] &&
        settingFor(only, (answers[only.id] as KindAnswer).target, prefs)
      ) {
        setStep('setting')
      } else setStep('target')
    }
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <SaveAs
          mode={mode}
          width={width}
          name=""
          onNameChange={() => {}}
          proposed=""
          ext=""
          fixedName={fixedName(folder)}
          folder={folder}
          onFolder={setFolder}
          presets={destination.presets}
          defaultPath={expandTilde(prefs.defaultOutput)}
          lastPath={destination.last}
          display={displayPath}
          onMakeDefault={(path) => onMakeDefault?.(path)}
          onSubmit={(to) => {
            setFolder(to)
            void run(to)
          }}
          onBack={back}
        />
      </Box>
    )
  }

  // ---------------------------------------------------------------- converting

  if (step === 'converting') {
    const unit = mixed ? 'files' : only ? countOf(only.id, 2).split(' ')[1] : 'files'
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <Working
          mode={mode}
          label={work.label}
          startedAt={work.at}
          pages={work.total > 0 ? { done: work.done, total: work.total } : undefined}
          unit={unit}
          savedAsItGoes
          width={width}
        />
      </Box>
    )
  }

  return (
    <Watching
      name={name}
      folder={folder}
      totals={totals}
      files={files}
      back={back}
      fresh={fresh}
      avail={avail}
      width={width}
      onScroll={(d) => {
        const room = Math.max(3, avail - 12)
        const most = Math.max(0, files.length - (room - 1))
        setBack((b) => {
          const next = Math.max(0, Math.min(most, b + d))
          if (next === 0) setFresh(0)
          return next
        })
      }}
      onClose={() => {
        void session.current?.stop()
        session.current = undefined
        onClose()
      }}
      kind={mixed ? undefined : only?.id}
    />
  )
}

/** The watching screen (T1, R1): Done's bar, the words, the hairline, the list. */
function Watching({
  name,
  folder,
  totals,
  files,
  back,
  fresh,
  avail,
  width,
  onScroll,
  onClose,
  kind,
}: {
  name: string
  folder: string
  totals: { n: number; before: number; after: number; from: Set<string>; to: Set<string> }
  files: (WatchedFile & { startedAt: number; doneAt?: number })[]
  back: number
  fresh: number
  avail: number
  width: number
  onScroll: (by: number) => void
  onClose: () => void
  /** The one kind a folder holds, to count it by its own name; a mixed folder counts files. */
  kind?: KindId | undefined
}) {
  const palette = useTheme()
  const mode = 'convert' as const
  const moving = motionEnabled(palette.name)
  const running = files.some((f) => f.state === 'running')
  const flashing = files.some((f) => f.doneAt !== undefined && Date.now() - f.doneAt < FLASH_MS)
  const tick = useTicker(moving || running || flashing, FRAME_MS)
  const room = Math.max(3, avail - 12)
  const scrolls = files.length > room

  useKeys((input, key) => {
    if (key.return) onClose()
    else if (input === 'o') void openPath(folder).catch(() => {})
    else if (key.upArrow && scrolls) onScroll(1)
    else if (key.downArrow && scrolls) onScroll(-1)
  })

  const noun = kind ? countOf(kind, totals.n) : `${totals.n} ${totals.n === 1 ? 'file' : 'files'}`
  const formats = (s: Set<string>) => [...s].filter(Boolean).join(' · ') || '—'
  const bar =
    totals.n > 0
      ? doneBody({
          palette,
          width,
          // The compact picture: six rows, which the list's room below counts on.
          compact: true,
          facts: {
            mode,
            before: {
              format: formats(totals.from),
              name: noun,
              bytes: totals.before,
            },
            after: {
              format: formats(totals.to),
              name: noun,
              bytes: totals.after,
            },
          },
        })
      : []
  const now = Date.now()
  const end = scrolls ? width - HOME_MARGIN - 3 : width - 2
  const spinner = moving ? SPINNER_FRAMES[tick % SPINNER_FRAMES.length] : undefined
  const rows = files.map((f) =>
    watchedRow({
      palette,
      mode,
      width,
      end,
      spinner,
      file: {
        ...f,
        ...(f.state === 'running' ? { clock: `${((now - f.startedAt) / 1000).toFixed(1)}s` } : {}),
        ...(f.doneAt !== undefined ? { flash: Math.max(0, 1 - (now - f.doneAt) / FLASH_MS) } : {}),
      },
    }),
  )
  const failedAt = files.flatMap((f, i) => (f.state === 'failed' ? [i] : []))
  const light = moving ? sweepAt(tick % SWEEP, SWEEP, Math.max(1, width - 6)) : undefined
  const accent = modeColours(palette, mode).fg

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Lines rows={bar} shift={false} />
      <Box marginTop={bar.length > 0 ? 1 : 0} flexDirection="column">
        <Lines
          rows={[
            [
              blank(3),
              { text: 'Watching ', fg: palette.fg },
              { text: name, fg: accent, bold: true },
            ],
            [blank(3), { text: 'Any new files you add will be converted.', fg: palette.dim }],
          ]}
          shift={false}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Lines
          rows={[
            hairlineRow({ palette, mode, width, at: light }),
            ...watchListRows({ palette, rows, room, width, failedAt, back, fresh }),
          ]}
          shift={false}
        />
      </Box>
      <HintBar
        width={width}
        pairs={[
          ['↵', 'stop and go home'],
          ['o', 'open folder'],
          ...(scrolls ? ([['↑↓', 'scroll']] as Array<[string, string]>) : []),
        ]}
        foot={[['ctrl-c', 'quit']]}
      />
    </Box>
  )
}
