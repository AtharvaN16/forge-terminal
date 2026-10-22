/**
 * Transcribe from ↵ on home to Done (spec 2026-10-17-transcribe-design §4.4,
 * mockups/transcribe-2026-10-round2.html): Transcribe to (All, Notes
 * or Transcript; skipped when Apple Intelligence is off), Format (Markdown,
 * Word, PDF or text; mockups/transcribe-2026-10-round4.html, T1), Save as,
 * Working (the sound still downloading, then Transcribing with what has been
 * heard, then ✓ Transcribing above Writing notes and a square per part), and
 * Done. App draws the header bar from `onTrail`.
 */

import { dirname, join } from 'node:path'
import { Box } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { destinationAt } from '../../core/actions/destination.js'
import { writeAtomic } from '../../core/atomic.js'
import { type ForgeError, isForgeError, unexpectedError } from '../../core/errors.js'
import { uniqueOutputPath } from '../../core/output-path.js'
import { DEFAULT_DETAIL, DETAILS, type Detail, detailLabel } from '../../core/transcribe/detail.js'
import {
  clock,
  fileStem,
  type NotesPart,
  transcriptMarkdown,
} from '../../core/transcribe/markdown.js'
import {
  DEFAULT_OUTPUT,
  markdownText,
  OUTPUTS,
  type Output,
  outputExt,
  outputLabel,
} from '../../core/transcribe/output.js'
import { renderTranscript, runTranscribe, transcribeStatus } from '../../engines/transcribe.js'
import type { FetchedSound } from '../../engines/youtube.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import type { Trail } from '../bar-art.js'
import { copy } from '../clipboard.js'
import { DoneActions, doneKeys } from '../components/Done.js'
import { bytesOf } from '../components/EditPicker.js'
import { HintBar } from '../components/HintBar.js'
import { Runs } from '../components/Home.js'
import { SaveAs } from '../components/SaveAs.js'
import { Select } from '../components/Select.js'
import { pillWidth, StepPill } from '../components/StepPill.js'
import { StepTitle } from '../components/StepTitle.js'
import { Working } from '../components/Working.js'
import { NEW_FOLDER } from '../destinations.js'
import { type DoneAction, doneActionRows, doneNotes } from '../done-art.js'
import { blank, HOME_MARGIN, mix, type Row, width as widthOf } from '../home-art.js'
import { openPath, revealLabel, revealPath } from '../reveal.js'
import { useTheme } from '../ThemeContext.js'
import type { Palette } from '../theme.js'
import { type TranscribeSource, transcribeCard } from '../transcribe-stage.js'
import { useKeys } from '../useKeys.js'
import { CARD_WIDTH, middleEllipsis } from '../width.js'
import { elapsed } from '../working-art.js'

export interface TranscribeFlowProps {
  /** A file, or a link whose facts are in. */
  source: TranscribeSource
  /** A link's sound, still being fetched by the run home started. */
  sound?: Promise<FetchedSound> | undefined
  width: number
  prefs: Preferences
  onTrail: (trail: Trail) => void
  /** esc from the first question: home, the file or link still there. */
  onCancel: () => void
  /** ↵ on Done: home, nothing staged. */
  onNew: () => void
  /** The run failed: home, and why. */
  onFail: (error: ForgeError) => void
  onMakeDefault?: ((path: string) => void) | undefined
  /** tab on Format: this format is the one Format opens on from now on. */
  onMakeFormatDefault?: ((format: Output) => void) | undefined
  onSaved?: ((folder: string) => void) | undefined
}

type Want = 'all' | 'notes' | 'transcript'
// The format is its own step now, so the rows say what is in the file, not what kind it is.
const WANTS = [
  { value: 'all', label: 'All', hint: 'summary, notes and transcript' },
  { value: 'notes', label: 'Notes', hint: 'summary and notes' },
  { value: 'transcript', label: 'Transcript' },
]
const label = (want: Want) => WANTS.find((w) => w.value === want)?.label ?? ''

type Work =
  | { phase: 'download'; at: number }
  /** macOS fetching its speech model for this language, the first time: a real fraction. */
  | { phase: 'model'; at: number; fraction: number }
  | { phase: 'heard'; at: number; seconds: number; of: number }
  /** `at` is when the notes began; `took` is how long transcribing took, said as the clock says it. */
  | { phase: 'notes'; at: number; took: string; part: number; of: number }

/** The file or video, framed, with its kind in the top edge: as home's card, without the dots. */
export function transcribeCardRows(
  palette: Palette,
  columns: number,
  source: TranscribeSource,
): Row[] {
  const card = transcribeCard(source)
  const outer = Math.min(columns, CARD_WIDTH)
  const inner = outer - 2
  const text = inner - 2
  const line = (t: string, fg: string, bold = false): Row => [
    { text: '│', fg: palette.border },
    blank(1),
    { text: middleEllipsis(t, text).padEnd(text), fg, bold },
    blank(1),
    { text: '│', fg: palette.border },
  ]
  return [
    [
      { text: '╭─ ', fg: palette.border },
      { text: card.tag, fg: palette.accent, bold: true },
      { text: ` ${'─'.repeat(Math.max(0, inner - card.tag.length - 3))}╮`, fg: palette.border },
    ],
    line(card.name, palette.fg, true),
    line(card.facts, palette.dim),
    [{ text: `╰${'─'.repeat(inner)}╯`, fg: palette.border }],
  ]
}

export function TranscribeFlow({
  source,
  sound,
  width,
  prefs,
  onTrail,
  onCancel,
  onNew,
  onFail,
  onMakeDefault,
  onMakeFormatDefault,
  onSaved,
}: TranscribeFlowProps) {
  const palette = useTheme()
  const [step, setStep] = useState<'checking' | 'choose' | 'format' | 'save' | 'working' | 'done'>(
    'checking',
  )
  const [notesOn, setNotesOn] = useState(false)
  const [want, setWant] = useState<Want>('all')
  // Detail is the pill on All and Notes; the row under the cursor decides whether it shows.
  const [detail, setDetail] = useState<Detail>(DEFAULT_DETAIL)
  const [cursor, setCursor] = useState(0)
  // Format opens on the default; tab on a row makes that one the default.
  const defaultFormat = prefs.transcribeFormat ?? DEFAULT_OUTPUT
  const [format, setFormat] = useState<Output>(defaultFormat)
  const [formatCursor, setFormatCursor] = useState(() =>
    Math.max(
      0,
      OUTPUTS.findIndex((o) => o.id === defaultFormat),
    ),
  )
  const here = source.kind === 'file' ? dirname(source.path) : undefined
  const destination = useMemo(
    () => destinationAt(here, prefs, { subfolder: NEW_FOLDER.transcribe }),
    [here, prefs],
  )
  const [folder, setFolder] = useState(() => expandTilde(prefs.defaultOutput))
  const [name, setName] = useState('')
  const [work, setWork] = useState<Work>({ phase: 'download', at: Date.now() })
  /** `text` is what c copies: the Markdown for a .md, its words for any other format. */
  const [done, setDone] = useState<{ output: string; text: string; parts?: NotesPart[] }>()
  const stop = useRef<AbortController | undefined>(undefined)

  const origin =
    source.kind === 'file'
      ? { title: displayName(source.path).replace(/\.[^.]+$/, ''), from: displayName(source.path) }
      : source.phase === 'ready'
        ? { title: source.facts.title, from: source.url }
        : { title: 'transcript', from: source.kind === 'link' ? source.url : '' }
  const seconds =
    source.kind === 'file' ? source.seconds : source.phase === 'ready' ? source.facts.seconds : 0
  const stem = fileStem(origin.title)
  const place = (path: string) =>
    destination.presets.find((p) => p.path === path)?.label ?? displayName(displayPath(path))

  // Whether notes can be offered: Apple Intelligence on, or not. Once, on
  // arrival: App's callbacks are new each render, so they are read through a ref.
  const fail = useRef(onFail)
  fail.current = onFail
  useEffect(() => {
    let live = true
    transcribeStatus().then(
      (status) => {
        if (!live) return
        const on = status?.notes === 'available'
        setNotesOn(on)
        setWant(on ? 'all' : 'transcript')
        setStep(on ? 'choose' : 'format')
      },
      (e: unknown) => {
        if (live) fail.current(isForgeError(e) ? e : unexpectedError(e))
      },
    )
    return () => {
      live = false
    }
  }, [])

  // Stop a run still going when the flow goes.
  useEffect(() => () => stop.current?.abort(), [])

  const answered = (w: Want) => (notesOn ? [label(w)] : [])
  // The bar's trail, said when the question changes (not every render: it is App's state).
  const trail = useRef(onTrail)
  trail.current = onTrail
  useEffect(() => {
    if (step === 'choose') trail.current({ answers: [], current: 'Transcribe to' })
    // Transcribe to's answer, when there was a question to answer.
    const asked = notesOn ? [label(want)] : []
    if (step === 'format') trail.current({ answers: asked, current: 'Format' })
    if (step === 'save') {
      trail.current({ answers: [...asked, outputLabel(format)], current: 'Save as' })
    }
  }, [step, want, notesOn, format])

  const run = async (to: string, typed: string) => {
    const output = uniqueOutputPath(join(to, `${typed.trim() || stem}${outputExt(format)}`))
    const trail = [...answered(want), place(to), displayName(output)]
    const ctrl = new AbortController()
    stop.current = ctrl
    setStep('working')
    try {
      let path: string
      if (source.kind === 'file') path = source.path
      else {
        setWork({ phase: 'download', at: Date.now() })
        onTrail({ answers: trail, current: 'Downloading' })
        if (!sound) throw unexpectedError(new Error('no sound for this link'))
        path = (await sound).path
      }
      const at = Date.now()
      setWork({ phase: 'heard', at, seconds: 0, of: seconds })
      onTrail({ answers: trail, current: 'Transcribing' })
      const result = await runTranscribe(path, {
        notes: want !== 'transcript',
        detail,
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.kind === 'model') setWork({ phase: 'model', at, fraction: e.fraction })
          if (e.kind === 'heard') setWork({ phase: 'heard', at, seconds: e.seconds, of: e.of })
          if (e.kind === 'notes') {
            // The notes' own clock starts with their first part; transcribing's time stays.
            setWork((w) =>
              w.phase === 'notes'
                ? { ...w, part: e.part, of: e.of }
                : {
                    phase: 'notes',
                    at: Date.now(),
                    took: elapsed(Date.now() - at),
                    part: e.part,
                    of: e.of,
                  },
            )
            onTrail({ answers: trail, current: 'Writing notes' })
          }
        },
      })
      const md = transcriptMarkdown(result, origin, { transcript: want !== 'notes' })
      await writeAtomic(output, await renderTranscript(md, format, { signal: ctrl.signal }))
      onSaved?.(to)
      setDone({
        output,
        text: format === 'md' ? md : markdownText(md),
        ...(result.notes ? { parts: result.notes.parts } : {}),
      })
      onTrail({ answers: trail, current: 'Done' })
      setStep('done')
    } catch (e) {
      if (ctrl.signal.aborted) return
      fail.current(isForgeError(e) ? e : unexpectedError(e))
    }
  }

  // esc while it works: stop, nothing written, home with the file.
  useKeys(
    (_input, key) => {
      if (!key.escape) return
      stop.current?.abort()
      onCancel()
    },
    { isActive: step === 'working' },
  )

  // ←→ on All or Notes: how much the notes say.
  const pilled = WANTS[cursor]?.value !== 'transcript'
  useKeys(
    (_input, key) => {
      if (!pilled) return
      const i = DETAILS.indexOf(detail)
      const next = key.leftArrow ? i - 1 : key.rightArrow ? i + 1 : i
      const to = DETAILS[Math.max(0, Math.min(DETAILS.length - 1, next))]
      if (to) setDetail(to)
    },
    { isActive: step === 'choose' },
  )

  // tab on Format: the highlighted format becomes the default, tagged at once.
  useKeys(
    (_input, key) => {
      const row = OUTPUTS[formatCursor]
      if (key.tab && row) onMakeFormatDefault?.(row.id)
    },
    { isActive: step === 'format' },
  )

  /**
   * Done's way on, as every Done's (mockups/done-next-2026-10-round9.html):
   * Open, Finder and Copy, then Home, selected as Done opens. ←→ chooses,
   * ↵ confirms, each keeps its key (s still reveals), esc goes home.
   */
  const doneList: DoneAction[] = [
    { key: 'o', label: 'Open' },
    { key: 'f', label: revealLabel().replace(/^Show in /, '') },
    { key: 'c', label: 'Copy' },
  ]
  const [doneSel, setDoneSel] = useState<number | undefined>()
  useEffect(() => {
    if (step === 'done') setDoneSel(undefined)
  }, [step])
  useKeys(
    (input, key) => {
      if (!done) return
      const home = doneList.length
      if (key.leftArrow || key.rightArrow) {
        setDoneSel((at) => Math.max(0, Math.min(home, (at ?? home) + (key.rightArrow ? 1 : -1))))
        return
      }
      const chosen = key.return ? doneList[doneSel ?? home]?.key : input
      if (key.escape || (key.return && chosen === undefined)) onNew()
      else if (chosen === 'o') void openPath(done.output).catch(() => {})
      else if (chosen === 'f' || chosen === 's') void revealPath(done.output).catch(() => {})
      else if (chosen === 'c') copy(done.text)
    },
    { isActive: step === 'done' },
  )

  const cardBox = (
    <Box flexDirection="column" marginBottom={1}>
      {transcribeCardRows(palette, width - 4, source).map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows of art
        <Runs key={i} row={[blank(2), ...row]} />
      ))}
    </Box>
  )

  if (step === 'checking') return <Box flexGrow={1}>{cardBox}</Box>

  if (step === 'choose') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <StepTitle mode="transcribe" title="Transcribe to" width={width} />
        <Box flexGrow={1}>
          <Select
            key="want"
            items={WANTS}
            width={width - 2 * HOME_MARGIN}
            initialValue={want}
            onHighlight={setCursor}
            pill={(item) =>
              item.value === 'transcript'
                ? null
                : {
                    node: (
                      <StepPill labels={DETAILS.map(detailLabel)} at={DETAILS.indexOf(detail)} />
                    ),
                    width: pillWidth(detailLabel('standard')),
                  }
            }
            onSubmit={(v) => {
              setWant(v as Want)
              setStep('format')
            }}
            onCancel={onCancel}
          />
        </Box>
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ...(pilled ? ([['←→', 'detail']] as Array<[string, string]>) : []),
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

  if (step === 'format') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <StepTitle mode="transcribe" title="Format" width={width} />
        <Box flexGrow={1}>
          {/*
            Its own key: in the same place as Transcribe to's list, React would
            keep that one and its cursor, and Format must open on the default.
          */}
          <Select
            key="format"
            items={OUTPUTS.map((o) => ({
              value: o.id,
              label: o.label,
              hint: o.ext,
              ...(o.id === defaultFormat ? { badge: 'default' } : {}),
            }))}
            width={width - 2 * HOME_MARGIN}
            initialValue={format}
            onHighlight={setFormatCursor}
            onSubmit={(v) => {
              setFormat(v as Output)
              setStep('save')
            }}
            onCancel={() => (notesOn ? setStep('choose') : onCancel())}
          />
        </Box>
        <HintBar
          width={width}
          pairs={[
            ['↑↓', 'choose'],
            ['tab', 'make default'],
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

  if (step === 'save') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <SaveAs
          mode="transcribe"
          width={width}
          name={name}
          onNameChange={setName}
          proposed={stem}
          ext={outputExt(format)}
          folder={folder}
          onFolder={setFolder}
          presets={destination.presets}
          defaultPath={expandTilde(prefs.defaultOutput)}
          lastPath={destination.last}
          display={displayPath}
          onMakeDefault={(path) => onMakeDefault?.(path)}
          onSubmit={(to, typed) => {
            setFolder(to)
            void run(to, typed)
          }}
          onBack={() => setStep('format')}
        />
      </Box>
    )
  }

  if (step === 'working') {
    const fetched = source.kind === 'link' && source.phase === 'ready' ? source.fetched : undefined
    const progress =
      work.phase === 'download' && fetched
        ? (() => {
            const { got, of } = bytesOf(fetched.done, fetched.total)
            return { done: fetched.done, total: fetched.total, says: `${got} of ${of}` }
          })()
        : work.phase === 'model'
          ? { done: Math.round(work.fraction * 1000), total: 1000, says: '' }
          : work.phase === 'heard' && work.of > 0
            ? {
                done: work.seconds,
                total: work.of,
                says: `${clock(work.seconds)} of ${clock(work.of)}`,
              }
            : undefined
    return (
      <Box flexDirection="column" flexGrow={1}>
        {cardBox}
        <Working
          mode="transcribe"
          label={
            work.phase === 'download'
              ? 'Downloading the sound'
              : work.phase === 'model'
                ? 'Downloading the speech model'
                : work.phase === 'heard'
                  ? 'Transcribing'
                  : 'Writing notes'
          }
          startedAt={work.at}
          progress={progress}
          parts={work.phase === 'notes' ? { done: work.part - 1, of: work.of } : undefined}
          finished={work.phase === 'notes' ? { label: 'Transcribing', took: work.took } : undefined}
          next={work.phase === 'heard' && want !== 'transcript' ? 'Writing notes' : undefined}
          stoppable
          width={width}
        />
      </Box>
    )
  }

  // Done: a green "done" chip, the file, the parts it found; the way on above the keys.
  const parts = done?.parts ?? []
  const refused = parts.findIndex((p) => p.refused)
  const rows: Row[] = [
    [
      blank(4),
      {
        text: ' done ',
        fg: palette.ok,
        bg: mix(palette.ok, palette.canvas || '#000000', 0.8),
        bold: true,
      },
    ],
    [],
    [
      blank(4),
      { text: '✓ ', fg: palette.ok, bold: true },
      { text: displayName(done?.output ?? ''), fg: palette.fg, bold: true },
    ],
    [],
    ...parts.map(
      (p, i): Row => [
        blank(6),
        { text: clock(p.start).padStart(5), fg: palette.border },
        blank(3),
        p.refused
          ? { text: `Part ${i + 1}`, fg: palette.dim }
          : { text: middleEllipsis(p.heading, Math.max(8, width - 18)), fg: palette.fg },
      ],
    ),
  ]
  const warning =
    refused >= 0
      ? doneNotes({
          palette,
          width: width - 4,
          offers: [],
          warnings: [`Apple Intelligence would not write notes for part ${refused + 1}.`],
        })
      : []
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        {[
          ...rows,
          ...(warning.length ? [[] as Row, ...warning.map((r) => [blank(2), ...r])] : []),
        ].map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed rows of art
          <Runs key={i} row={widthOf(row) > 0 ? row : [blank(1)]} />
        ))}
      </Box>
      <HintBar
        width={width}
        above={
          <DoneActions mode="transcribe" actions={doneList} selected={doneSel} width={width} />
        }
        pairs={doneKeys({
          actions: doneList,
          framed:
            doneActionRows({
              palette,
              mode: 'transcribe',
              actions: doneList,
              selected: 0,
              width,
            }) !== undefined,
        })}
        foot={[['ctrl-c', 'quit']]}
      />
    </Box>
  )
}
