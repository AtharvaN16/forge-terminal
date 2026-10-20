/**
 * Margin audit (2026-10-20): the home screen's band and drop zone set the
 * app's margins. Every frame the full App renders at 80 columns must leave
 * the two columns outside each margin bare — no ink, no fill other than the
 * canvas. Not a test — findings go to OUT; see vitest.config.ts here.
 *
 *   npx vitest run -c scripts/margin-audit/vitest.config.ts tests/shell
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { afterEach, expect, vi } from 'vitest'
import { DARK, LIGHT } from '../../src/shell/theme.js'
import { ansiRow } from '../../tests/shell/home-cells.js'

const OUT = process.env.MARGIN_AUDIT_OUT ?? '/tmp/forge-margin-audit'
mkdirSync(OUT, { recursive: true })
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m|${ESC}\\]8;[^${BEL}]*${BEL}`, 'g')
const CANVAS = new Set([null, DARK.canvas, LIGHT.canvas])
/** The painted inset either side (none before the canvas is painted), then the app's margin. */
const PAINTED_INSET = 2
const M = 2
const PAINT = new Set([DARK.canvas, LIGHT.canvas])

const live: Array<{ frames: string[] }> = []
vi.mock('ink-testing-library', async (orig) => {
  const real = await orig<typeof import('ink-testing-library')>()
  return {
    ...real,
    render: (...args: Parameters<typeof real.render>) => {
      const r = real.render(...args)
      const el = args[0] as { type?: { name?: string } }
      if (el?.type?.name === 'App') live.push(r)
      return r
    },
  }
})

afterEach(() => {
  const test = `${expect.getState().testPath?.split('/tests/')[1]} > ${expect.getState().currentTestName}`
  const seen = new Set<string>()
  for (const r of live)
    for (const frame of r.frames) {
      const lines = frame.split('\n')
      const plain = lines.map((l) => l.replace(SGR, ''))
      const width = Math.max(...plain.map((l) => [...l].length))
      if (width !== 80) continue
      // A painted frame fills its first column with the canvas; an unpainted
      // one (the first-run theme picker) has no inset.
      const INSET = lines.some((l) => PAINT.has(ansiRow(l, width)[0]?.bg ?? null))
        ? PAINTED_INSET
        : 0
      const where = plain
        .slice(0, 4)
        .join(' ')
        .replace(/[╱\s]+/g, ' ')
        .trim()
        .slice(0, 60)
      lines.forEach((line, i) => {
        const cells = ansiRow(line, width)
        const bad = (c: number) => {
          const cell = cells[c]
          return !!cell && (cell.ch !== ' ' || !CANVAS.has(cell.bg))
        }
        const left = (INSET ? [INSET, INSET + 1] : [0, 1]).filter(bad)
        const right = (
          INSET ? [width - INSET - M, width - INSET - M + 1] : [width - 2, width - 1]
        ).filter(bad)
        if (left.length === 0 && right.length === 0) return
        const row = plain[i] ?? ''
        const key = `${where}|${row.trim().slice(0, 30)}|${left}|${right}`
        if (seen.has(key)) return
        seen.add(key)
        appendFileSync(
          `${OUT}/${process.pid}.jsonl`,
          `${JSON.stringify({ test, where, left, right, row: row.slice(0, 80) })}\n`,
        )
      })
    }
  live.length = 0
})
