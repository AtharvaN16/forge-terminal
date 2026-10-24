import { formatBytes } from '../core/units.js'
import { mix, type Row } from './home-art.js'
import type { Palette } from './theme.js'

/**
 * The space taken, at the foot of /extensions' list frame
 * (mockups/extensions-space-2026-10-round10.html): one box split by size,
 * Forge's part then the extensions', each a tint of its colour with its name
 * over its size. Forge in grey, the extensions in convert's cyan (round 9).
 */

/** Megabytes whole from 1 MB on — "35 MB", not "34.5 MB" — and the exact unit below. */
export function sizeOf(bytes: number): string {
  return bytes >= 1e6 ? `${Math.round(bytes / 1e6)} MB` : formatBytes(bytes)
}

/** `text` padded or cut to exactly `n` cells. */
const pad = (text: string, n: number) => (text.length > n ? text.slice(0, n) : text.padEnd(n))

/** The two rows: names, then sizes. `width` is the frame's; each part as wide as its share, and never narrower than its words. */
export function spaceRows(p: Palette, forgeBytes: number, extBytes: number, width: number): Row[] {
  const parts = [
    { name: 'Forge', size: sizeOf(forgeBytes), bytes: forgeBytes, colour: p.dim },
    { name: 'Extensions', size: sizeOf(extBytes), bytes: extBytes, colour: p.modeConvert },
  ] as const
  const least = parts.map((t) => Math.max(t.name.length, t.size.length) + 2)
  const [leastF, leastE] = least as [number, number]
  const total = forgeBytes + extBytes
  const share = total > 0 ? Math.round((forgeBytes / total) * width) : Math.round(width / 2)
  const nF = Math.max(leastF, Math.min(width - leastE, share))
  const widths = [nF, width - nF]
  const ground = p.shelf || p.selectionBg
  const tint = (c: string) => (ground === '' ? '' : mix(ground, c, 0.26))
  return [
    parts.map((t, i) => ({
      text: pad(` ${t.name}`, widths[i] ?? 0),
      fg: t.colour,
      bg: tint(t.colour),
      bold: true,
    })),
    parts.map((t, i) => ({
      text: pad(` ${t.size}`, widths[i] ?? 0),
      fg: p.fg,
      bg: tint(t.colour),
    })),
  ]
}
