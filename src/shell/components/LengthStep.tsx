import { Box } from 'ink'
import { useEffect, useReducer, useRef, useState } from 'react'
import { clockOf, parseTime, stepsFor, timeOf } from '../../core/timecode.js'
import type { MediaInfo } from '../../core/types.js'
import { blank, type Row, width as widthOf } from '../home-art.js'
import { barRow, fieldsRow, handlesRow, type Moving, peaksRows, stepRow } from '../length-art.js'
import { useTheme } from '../ThemeContext.js'
import { useKeys } from '../useKeys.js'
import { HintBar } from './HintBar.js'
import { Runs } from './Home.js'

/** The shortest a cut may keep. */
const MIN_KEPT = 0.1
/** A GIF longer than this is too big to post almost anywhere (video spec §3.5). */
export const GIF_LONG = 15
/** What a time being typed may hold. */
const TYPED = /^[\d:.]$/

export interface Cut {
  start: number
  end: number
}

/**
 * Trim's screen (video spec §3.4): the sound as peaks, the bar of what is
 * kept, the I and O chips, the step at the title's end and the start and end
 * fields. Choose what moves — I the start, O the end, space the range, tab
 * cycles them — then ←→ moves it by the step, [ ] changes the step, and a
 * time typed (`41`, `0:41`, `1:02.5`) puts the chosen end there. Also GIF's
 * "which part", where past 15 s the bar turns orange and says so.
 */
export function LengthStep({
  source,
  title,
  initial,
  gif = false,
  onSubmit,
  onCancel,
  width,
}: {
  source: MediaInfo
  /** Trim, or GIF. */
  title: string
  initial?: Cut | undefined
  gif?: boolean
  onSubmit: (cut: Cut) => void
  onCancel: () => void
  width: number
}) {
  const palette = useTheme()
  const duration = source.facts?.duration ?? 0
  const steps = stepsFor(duration)
  const bar = Math.max(20, width - 2)
  const state = useRef({
    start: initial?.start ?? 0,
    end: initial?.end ?? duration,
    moving: 'start' as Moving,
    step: 0,
    typed: undefined as string | undefined,
  })
  const [, redraw] = useReducer((n: number) => n + 1, 0)
  const [levels, setLevels] = useState<number[] | null | undefined>(undefined)

  // The peaks, read once, in the background: the bar is there before they are.
  useEffect(() => {
    const stop = new AbortController()
    if (source.facts && !source.facts.audio) {
      setLevels(null)
      return
    }
    import('../../engines/ffmpeg.js')
      .then(({ soundLevels }) => soundLevels(source.path, duration, bar, { signal: stop.signal }))
      .then(setLevels, () => setLevels(null))
    return () => stop.abort()
  }, [source.path, source.facts, duration, bar])

  const set = (next: Partial<typeof state.current>) => {
    state.current = { ...state.current, ...next }
    redraw()
  }

  /** Moves the chosen end (or both) by `by` seconds, within the file and keeping 0.1 s. */
  const move = (by: number) => {
    const { start, end, moving } = state.current
    if (moving === 'range') {
      const length = end - start
      const s = Math.max(0, Math.min(duration - length, start + by))
      set({ start: s, end: s + length })
    } else if (moving === 'start') {
      set({ start: Math.max(0, Math.min(end - MIN_KEPT, start + by)) })
    } else {
      set({ end: Math.min(duration, Math.max(start + MIN_KEPT, end + by)) })
    }
  }

  /** A typed time, put at the chosen end when it is a time that fits there. */
  const place = (text: string): boolean => {
    const t = parseTime(text)
    const { start, end, moving } = state.current
    if (t === undefined || t > duration) return false
    if (moving === 'end') {
      if (t < start + MIN_KEPT) return false
      set({ end: t, typed: undefined })
    } else {
      if (t > end - MIN_KEPT) return false
      set({ start: t, typed: undefined })
    }
    return true
  }

  useKeys((input, key) => {
    const s = state.current
    if (key.escape) {
      if (s.typed !== undefined) set({ typed: undefined })
      else onCancel()
      return
    }
    if (key.return) {
      if (s.typed !== undefined) {
        place(s.typed)
        return
      }
      onSubmit({ start: s.start, end: s.end })
      return
    }
    if (key.tab) {
      const next: Moving = s.moving === 'start' ? 'end' : s.moving === 'end' ? 'range' : 'start'
      set({ moving: next, typed: undefined })
      return
    }
    if (key.leftArrow || key.rightArrow) {
      move((key.rightArrow ? 1 : -1) * (steps[s.step] ?? 1))
      return
    }
    if (key.backspace || key.delete) {
      if (s.typed !== undefined) set({ typed: s.typed.slice(0, -1) || undefined })
      return
    }
    const ch = input.toLowerCase()
    if (ch === 'i') set({ moving: 'start', typed: undefined })
    else if (ch === 'o') set({ moving: 'end', typed: undefined })
    else if (ch === ' ') set({ moving: 'range', typed: undefined })
    else if (ch === '[') set({ step: Math.max(0, s.step - 1) })
    else if (ch === ']') set({ step: Math.min(steps.length - 1, s.step + 1) })
    else if (TYPED.test(input) && s.moving !== 'range' && (s.typed ?? '').length < 10) {
      set({ typed: `${s.typed ?? ''}${input}` })
    }
  })

  const { start, end, moving, step, typed } = state.current
  const kept = end - start
  const long = gif && kept > GIF_LONG
  const head: Row = [{ text: title, fg: palette.accent, bold: true }]
  const pill = stepRow({
    palette,
    seconds: steps[step] ?? 1,
    canDown: step > 0,
    canUp: step < steps.length - 1,
  })
  const keeps = `keeps ${timeOf(kept)} of ${clockOf(duration)}`
  const note = 'GIF might be too large'
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Runs
        row={[blank(1), ...head, blank(Math.max(1, bar - widthOf(head) - widthOf(pill))), ...pill]}
      />
      <Box marginTop={1} flexDirection="column">
        {peaksRows({ palette, levels, start, end, duration, width: bar }).map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <Runs key={i} row={[blank(1), ...row]} />
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Runs
          row={[
            blank(1),
            ...barRow({
              palette,
              start,
              end,
              duration,
              width: bar,
              active: moving,
              ...(long ? { colour: palette.larger } : {}),
            }),
          ]}
        />
        <Runs
          row={[
            blank(1),
            ...handlesRow({ palette, start, end, duration, width: bar, active: moving }),
          ]}
        />
      </Box>
      <Box marginTop={1}>
        <Runs
          row={[
            blank(1),
            { text: keeps, fg: palette.dim },
            ...(long
              ? [
                  blank(Math.max(1, bar - keeps.length - note.length)),
                  { text: note, fg: palette.larger },
                ]
              : []),
          ]}
        />
      </Box>
      <Box flexGrow={1} />
      <Runs
        row={[blank(1), ...fieldsRow({ palette, start, end, width: bar, active: moving, typed })]}
      />
      <HintBar
        width={width}
        pairs={[
          ['I', 'start'],
          ['O', 'end'],
          ['space', 'range'],
          ['←→', 'move'],
          ['[ ]', 'step'],
          ['↵', 'confirm'],
        ]}
        foot={[['esc', 'back']]}
      />
    </Box>
  )
}
