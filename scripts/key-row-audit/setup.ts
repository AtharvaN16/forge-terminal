/**
 * Key-row audit: every frame the full App renders that shows a key row
 * (each one ends "ctrl-c quit") must show it on the window's last row.
 * Not a test — findings go to OUT; see vitest.config.ts here.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { afterEach, expect, vi } from 'vitest'

const OUT = process.env.KEY_ROW_AUDIT_OUT ?? '/tmp/forge-key-row-audit'
mkdirSync(OUT, { recursive: true })

const ROWS = 24
const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m|${ESC}\\]8;[^${BEL}]*${BEL}`, 'g')
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
      const lines = frame.replace(SGR, '').split('\n')
      const at = lines.findLastIndex((l) => l.includes('ctrl-c quit'))
      if (at === -1) continue
      // On the window's last row: the frame's last line, and the frame at
      // least the window's height (the tests' 24 rows). A frame can also
      // carry history above the live part, so this is a floor, not exact.
      const ok = at === lines.length - 1 && lines.length >= ROWS
      // Which screen: the line above the rule's block, roughly — the first words.
      const where = lines.slice(0, 6).join(' ').replace(/\s+/g, ' ').trim().slice(0, 90)
      const key = `${ok}|${where}`
      if (seen.has(key)) continue
      seen.add(key)
      if (!ok)
        appendFileSync(
          `${OUT}/${process.pid}.jsonl`,
          `${JSON.stringify({ test, below: lines.length - 1 - at, total: lines.length, keys: lines[at]?.trim().slice(0, 80), where })}\n`,
        )
    }
  live.length = 0
})
