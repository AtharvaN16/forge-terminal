/**
 * A rendered frame as cells: each printed character with the colours and
 * attributes the terminal would draw it in. Only what the audit needs —
 * SGR colours, bold, dim, inverse; every other escape is skipped.
 */
export interface Cell {
  ch: string
  fg?: string
  bg?: string
  bold: boolean
  dim: boolean
  inverse: boolean
  line: number
  col: number
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

const ANSI16 = [
  '#000000',
  '#cd0000',
  '#00cd00',
  '#cdcd00',
  '#0000ee',
  '#cd00cd',
  '#00cdcd',
  '#e5e5e5',
  '#7f7f7f',
  '#ff0000',
  '#00ff00',
  '#ffff00',
  '#5c5cff',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
]
function x256(n: number): string {
  if (n < 16) return `ansi:${n}`
  if (n >= 232) {
    const v = 8 + (n - 232) * 10
    return hex(v, v, v)
  }
  const i = n - 16
  const c = [Math.floor(i / 36), Math.floor(i / 6) % 6, i % 6].map((v) => (v ? 55 + v * 40 : 0))
  return hex(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0)
}
export const ansiHex = (name: string) =>
  name.startsWith('ansi:') ? (ANSI16[Number(name.slice(5))] ?? '#000000') : name

export function cells(frame: string): Cell[] {
  const out: Cell[] = []
  let fg: string | undefined
  let bg: string | undefined
  let bold = false
  let dim = false
  let inverse = false
  let line = 0
  let col = 0
  let i = 0
  while (i < frame.length) {
    const c = frame[i] as string
    if (c === '\u001b') {
      const next = frame[i + 1]
      if (next === '[') {
        let j = i + 2
        while (j < frame.length && !/[A-Za-z]/.test(frame[j] as string)) j++
        const final = frame[j]
        if (final === 'm') {
          const ps = frame
            .slice(i + 2, j)
            .split(';')
            .map((p) => (p === '' ? 0 : Number(p)))
          for (let k = 0; k < ps.length; k++) {
            const p = ps[k] as number
            if (p === 0) {
              fg = bg = undefined
              bold = dim = inverse = false
            } else if (p === 1) bold = true
            else if (p === 2) dim = true
            else if (p === 22) bold = dim = false
            else if (p === 7) inverse = true
            else if (p === 27) inverse = false
            else if (p === 39) fg = undefined
            else if (p === 49) bg = undefined
            else if (p >= 30 && p <= 37) fg = `ansi:${p - 30}`
            else if (p >= 90 && p <= 97) fg = `ansi:${p - 82}`
            else if (p >= 40 && p <= 47) bg = `ansi:${p - 40}`
            else if (p >= 100 && p <= 107) bg = `ansi:${p - 92}`
            else if (p === 38 || p === 48) {
              const mode = ps[k + 1]
              let v: string | undefined
              if (mode === 2) {
                v = hex(ps[k + 2] ?? 0, ps[k + 3] ?? 0, ps[k + 4] ?? 0)
                k += 4
              } else if (mode === 5) {
                v = x256(ps[k + 2] ?? 0)
                k += 2
              }
              if (p === 38) fg = v
              else bg = v
            }
          }
        }
        i = j + 1
        continue
      }
      if (next === ']') {
        // OSC (hyperlinks): to BEL or ST.
        let j = i + 2
        while (
          j < frame.length &&
          frame[j] !== '\u0007' &&
          !(frame[j] === '\u001b' && frame[j + 1] === '\\')
        )
          j++
        i = frame[j] === '\u0007' ? j + 1 : j + 2
        continue
      }
      i += 2
      continue
    }
    if (c === '\n') {
      line++
      col = 0
      i++
      continue
    }
    const cp = frame.codePointAt(i) ?? 0
    const ch = String.fromCodePoint(cp)
    out.push({ ch, fg, bg, bold, dim, inverse, line, col })
    col++
    i += ch.length
  }
  return out
}

/* ---- colour maths ---- */

const lin = (v: number) => {
  const s = v / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export const rgbOf = (h: string): [number, number, number] => {
  const x = ansiHex(h)
  return [1, 3, 5].map((i) => Number.parseInt(x.slice(i, i + 2), 16)) as [number, number, number]
}
export function luminance(h: string): number {
  const [r, g, b] = rgbOf(h).map(lin) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
export function oklch(h: string): { L: number; C: number; h: number } {
  const [r, g, b] = rgbOf(h).map(lin) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }
}
/** What a terminal draws for SGR 2: about half way to the background. */
export function dimmed(fg: string, bg: string): string {
  const a = rgbOf(fg)
  const b = rgbOf(bg)
  return `#${a
    .map((v, i) =>
      Math.round((v + (b[i] ?? 0)) / 2)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}
