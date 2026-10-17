/**
 * Transcribe from ↵ on home to Done (spec 2026-10-17-transcribe-design §4.4,
 * mockups/transcribe-2026-10-round2.html): Transcribe to (Notes or Only
 * transcript; skipped when Apple Intelligence is off), Save as, Working
 * (the sound still downloading, then what has been heard, then a dot per
 * part), and Done. App draws the header bar from `onTrail`.
 */

import { dirname, join } from 'node:path'
import { Box } from 'ink'
import { useEffect, useMemo, useRef, useState } from 'react'
import { expandTilde, type Preferences } from '../../config/preferences.js'
import { destinationAt } from '../../core/actions/destination.js'
import { writeAtomic } from '../../core/atomic.js'
import { type ForgeError, isForgeError, unexpectedError } from '../../core/errors.js'
import { uniqueOutputPath } from '../../core/output-path.js'
import {
  clock,
  fileStem,
  type NotesPart,
  transcriptMarkdown,
} from '../../core/transcribe/markdown.js'
import { runTranscribe, transcribeStatus } from '../../engines/transcribe.js'
import type { FetchedSound } from '../../engines/youtube.js'
import { displayName, displayPath } from '../../utils/display-path.js'
import type { Trail } from '../bar-art.js'
import { copy } from '../clipboard.js'
import { bytesOf } from '../components/EditPicker.js'
import { HintBar } from '../components/HintBar.js'
import { Runs } from '../components/Home.js'
import { SaveAs } from '../components/SaveAs.js'
import { Select } from '../components/Select.js'
import { StepTitle } from '../components/StepTitle.js'
import { Working } from '../components/Working.js'
import { doneNotes } from '../done-art.js'
import { blank, mix, type Row, width as widthOf } from '../home-art.js'
import { openPath, revealPath } from '../reveal.js'
import { useTheme } from '../ThemeContext.js'
import type { Palette } from '../theme.js'
import { type TranscribeSource, transcribeCard } from '../transcribe-stage.js'
import { useKeys } from '../useKeys.js'
import { CARD_WIDTH, middleEllipsis } from '../width.js'

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
  onSaved?: ((folder: string) => void) | undefined
}

type Want = 'notes' | 'transcript'
const WANTS = [
  { value: 'notes', label: 'Notes', hint: 'summary, notes and transcript · .md' },
  { value: 'transcript', label: 'Only transcript', hint: '.md' },
]
const label = (want: Want) => (want === 'notes' ? 'Notes' : 'Only transcript')

type Work =
  | { phase: 'download'; at: number }
  /** macOS fetching its speech model for this language, the first time: a real fraction. */
  | { phase: 'model'; at: number; fraction: number }
  | { phase: 'heard'; at: number; seconds: number; of: number }
  | { phase: 'notes'; at: number; part: number; of: number }

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
  onSaved,
}: TranscribeFlowProps) {
  const palette = useTheme()
  const [step, setStep] = useState<'checking' | 'choose' | 'save' | 'working' | 'done'>('checking')
  const [notesOn, setNotesOn] = useState(false)
  const [want, setWant] = useState<Want>('notes')
  const here = source.kind === 'file' ? dirname(source.path) : undefined
  const destination = useMemo(() => destinationAt(here, prefs), [here, prefs])
  const [folder, setFolder] = useState(() => expandTilde(prefs.defaultOutput))
  const [name, setName] = useState('')
  const [work, setWork] = useState<Work>({ phase: 'download', at: Date.now() })
  const [done, setDone] = useState<{ output: string; md: string; parts?: NotesPart[] }>()
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
        setWant(on ? 'notes' : 'transcript')
        setStep(on ? 'choose' : 'save')
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
    if (step === 'save') {
      trail.current({ answers: notesOn ? [label(want)] : [], current: 'Save as' })
    }
  }, [step, want, notesOn])

  const run = async (to: string, typed: string) => {
    const output = uniqueOutputPath(join(to, `${typed.trim() || stem}.md`))
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
        notes: want === 'notes',
        signal: ctrl.signal,
        onEvent: (e) => {
          if (e.kind === 'model') setWork({ phase: 'model', at, fraction: e.fraction })
          if (e.kind === 'heard') setWork({ phase: 'heard', at, seconds: e.seconds, of: e.of })
          if (e.kind === 'notes') {
            setWork({ phase: 'notes', at, part: e.part, of: e.of })
            onTrail({ answers: trail, current: 'Writing notes' })
          }
        },
      })
      const md = transcriptMarkdown(result, origin)
      await writeAtomic(output, Buffer.from(md, 'utf8'))
      onSaved?.(to)
      setDone({ output, md, ...(result.notes ? { parts: result.notes.parts } : {}) })
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

  // Done's keys: ↵ new, o open, s finder, c copy.
  useKeys(
    (input, key) => {
      if (!done) return
      if (key.return) onNew()
      else if (input === 'o') void openPath(done.output).catch(() => {})
      else if (input === 's') void revealPath(done.output).catch(() => {})
      else if (input === 'c') copy(done.md)
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
            items={WANTS}
            width={width}
            initialValue={want}
            onSubmit={(v) => {
              setWant(v as Want)
              setStep('save')
            }}
            onCancel={onCancel}
          />
        </Box>
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
          ext=".md"
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
          onBack={() => (notesOn ? setStep('choose') : onCancel())}
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
          search={work.phase === 'notes' ? { n: work.part - 1, of: work.of } : undefined}
          stoppable
          width={width}
        />
      </Box>
    )
  }

  // Done: a green "done" chip, the file, the parts it found; the keys on the key row.
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
        pairs={[
          ['↵', 'new'],
          ['o', 'open'],
          ['s', 'finder'],
          ['c', 'copy'],
        ]}
        foot={[['ctrl-c', 'quit']]}
      />
    </Box>
  )
}
