/**
 * The .md transcribe writes (spec 2026-10-17-transcribe-design §4.2): the
 * title and where it came from (a link is clickable), then — with notes — the
 * summary, the notes part by part and the transcript under the same headings,
 * and the disclaimer last; without notes, the transcript alone. With `transcript: false`
 * the notes stand alone and the transcript is left out. Pure: it formats what
 * the helper returned.
 */

export interface Segment {
  start: number
  end: number
  text: string
}

export interface NotesPart {
  start: number
  heading: string
  points: string[]
  /** Apple's safety filter refused it twice: it keeps its transcript and time, no notes. */
  refused: boolean
}

export interface Transcription {
  seconds: number
  segments: Segment[]
  notes?: { summary: string; parts: NotesPart[] }
}

export interface Origin {
  title: string
  /** The link, or the file's name. */
  from: string
}

export const DISCLAIMER = 'Summary and notes by Apple Intelligence. They may contain mistakes.'

/** 0:09, 14:14, 1:01:57. */
export function clock(seconds: number): string {
  const s = Math.floor(seconds)
  const two = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/** A paragraph ends at a pause once it has some body, at a long silence, or when it gets long. */
const BODY_WORDS = 60
const MAX_WORDS = 140
const PAUSE = 1
const SILENCE = 10

/** The recogniser's segments as paragraphs, each starting where its first segment does. */
export function paragraphs(segments: Segment[]): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = []
  let cur: { start: number; end: number; text: string; words: number } | undefined
  for (const s of segments) {
    if (cur) {
      const gap = s.start - cur.end
      const ends =
        gap > SILENCE || (gap > PAUSE && cur.words >= BODY_WORDS) || cur.words >= MAX_WORDS
      if (!ends) {
        cur.text += ` ${s.text}`
        cur.end = s.end
        cur.words += wordCount(s.text)
        continue
      }
      out.push({ start: cur.start, text: cur.text })
    }
    cur = { start: s.start, end: s.end, text: s.text, words: wordCount(s.text) }
  }
  if (cur) out.push({ start: cur.start, text: cur.text })
  return out
}

const paragraphLines = (segments: Segment[]) =>
  paragraphs(segments).flatMap((p) => [`**${clock(p.start)}** ${p.text}`, ''])

/** A link as an autolink, so it is clickable wherever the .md is read; a file's name stays text. */
const source = (from: string) => (/^https?:\/\/\S+$/.test(from) ? `<${from}>` : from)

export function transcriptMarkdown(
  result: Transcription,
  origin: Origin,
  { transcript = true }: { transcript?: boolean } = {},
): string {
  const lines = [`# ${origin.title}`, '', source(origin.from), '']
  const notes = result.notes
  if (!notes) return [...lines, ...paragraphLines(result.segments)].join('\n')

  const parts = notes.parts
  const heading = (i: number) => {
    const p = parts[i]
    if (!p) return ''
    return `### ${p.refused ? `Part ${i + 1}` : p.heading} · ${clock(p.start)}`
  }
  lines.push(notes.summary, '', '## Notes', '')
  parts.forEach((p, i) => {
    lines.push(heading(i), '')
    if (p.points.length > 0) lines.push(...p.points.map((point) => `- ${point}`), '')
  })
  const disclaimer = [`_${DISCLAIMER}_`, '']
  if (!transcript) return [...lines, ...disclaimer].join('\n')
  lines.push('## Transcript', '')
  parts.forEach((p, i) => {
    const end = parts[i + 1]?.start ?? Number.POSITIVE_INFINITY
    const own = result.segments.filter((s) => s.start >= p.start && s.start < end)
    lines.push(heading(i), '', ...paragraphLines(own))
  })
  return [...lines, ...disclaimer].join('\n')
}

/** A video's title as a file name: no slashes or colons, nothing a Finder or a shell trips on. */
export function fileStem(title: string): string {
  const stem = [...title]
    .map((c) => ((c.codePointAt(0) ?? 0) < 32 ? ' ' : c))
    .join('')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
    .replace(/^\.+/, '')
  return stem === '' ? 'transcript' : stem
}
