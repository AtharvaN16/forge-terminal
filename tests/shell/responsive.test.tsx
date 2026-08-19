import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { render } from 'ink-testing-library'
import stringWidth from 'string-width'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ESC = String.fromCharCode(27)
const ENTER = String.fromCharCode(13)
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms))

const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`)
const ANSI_ALL = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')

/**
 * Terminal *columns*, not UTF-16 code units — the measure `width.ts` budgets
 * against. `.length` splits surrogate pairs and counts a CJK ideograph or an
 * emoji as one column when it occupies two, so an overflowing line can pass a
 * `.length` check. Style codes occupy no columns and come off first.
 */
function visibleWidth(line: string): number {
  return stringWidth(line.replace(ANSI_ALL, ''))
}

function widestLine(frame: string): number {
  return Math.max(0, ...frame.split('\n').map(visibleWidth))
}

/**
 * The idle stage is one bordered box and a hint line; every interesting
 * overflow lives further in. The destination step in particular renders a
 * preset's full absolute path as a hint, and a temp dir is long enough to
 * push past 80 columns on its own.
 */
async function frameAtDestination(width: number): Promise<string> {
  const dir = await makeTempDir()
  const jpg = await makeJpeg(dir, 'photo.jpg')
  const { stdin, lastFrame } = render(<App initialWidth={width} />)
  stdin.write(jpg)
  await settle()
  stdin.write(ENTER)
  await settle(300)
  // png is now the default highlighted target (jpeg is excluded as a
  // same-format no-op), and it's lossless, so the quality step is skipped.
  stdin.write(ENTER)
  await settle(200)
  return lastFrame() ?? ''
}

describe('responsiveness', () => {
  it('drops the prompt border in a compact terminal', () => {
    const narrow = render(<App initialWidth={40} />).lastFrame() ?? ''
    const normal = render(<App initialWidth={80} />).lastFrame() ?? ''
    expect(normal).toContain('╭')
    expect(narrow).not.toContain('╭')
  })

  it('never emits a line wider than the terminal at the idle stage', () => {
    for (const w of [40, 60, 80, 120]) {
      const frame = render(<App initialWidth={w} />).lastFrame() ?? ''
      expect(widestLine(frame)).toBeLessThanOrEqual(w)
    }
  })

  it('never emits a line wider than the terminal at the destination stage', async () => {
    for (const w of [40, 55, 80, 120]) {
      const frame = await frameAtDestination(w)
      expect(frame).toContain('Save to')
      expect(widestLine(frame)).toBeLessThanOrEqual(w)
    }
  })

  it('drops the destination preset hints in the compact band, as the target picker does', async () => {
    const compact = await frameAtDestination(40)
    const normal = await frameAtDestination(80)
    expect(compact).toContain('Same folder')
    expect(compact).not.toContain('/forge-test-')
    expect(normal).toContain('forge-test-')
  })
})

/**
 * Asserted on the rendered frame, not on `colourEnabled()`. The helper was
 * always correct — it just had no caller, so `NO_COLOR=1 forge` still emitted
 * `\u001b[2m`. Only the frame can tell those two states apart.
 *
 * Spawned, because chalk resolves its colour level once at import and vitest
 * externalises node_modules, so nothing in-process can put it back. FORCE_COLOR
 * stands in for the colour-capable TTY a pipe is not.
 */
describe('colour', () => {
  const run = promisify(execFile)
  const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx')
  const child = join(process.cwd(), 'tests', 'helpers', 'colour-frame-child.ts')

  async function frameWith(env: Record<string, string>): Promise<string> {
    const { stdout } = await run(tsx, [child], {
      env: { ...process.env, NO_COLOR: '', FORCE_COLOR: '3', ...env },
    })
    return JSON.parse(stdout) as string
  }

  it('emits no ANSI at all when NO_COLOR is set', async () => {
    const frame = await frameWith({ NO_COLOR: '1' })
    expect(frame).toContain('drop a file')
    expect(frame).not.toMatch(ANSI)
  })

  it('still emits colour when NO_COLOR is not set', async () => {
    const frame = await frameWith({})
    expect(frame).toContain('drop a file')
    expect(frame).toMatch(ANSI)
  })
})
