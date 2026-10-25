import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { scanFolder } from '../../src/core/folder.js'
import type { Trail } from '../../src/shell/bar-art.js'
import { WatchFlow } from '../../src/shell/flows/watch.js'
import { makeJpeg, makePdf, makePng, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`

/** The frame on screen now, for a wait that times out to show. */
let shown = () => ''
async function until(cond: () => boolean, ms = 6000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out on:\n${shown()}`)
    await new Promise((r) => setTimeout(r, 15))
  }
}
const tick = () => new Promise((r) => setTimeout(r, 60))

let unmount: (() => void) | undefined
afterEach(() => {
  unmount?.()
  unmount = undefined
})

async function open(dir: string, over: { onClose?: () => void } = {}) {
  const scan = await scanFolder(dir)
  const trails: Trail[] = []
  const r = render(
    <WatchFlow
      scan={scan}
      width={80}
      height={24}
      prefs={{ ...DEFAULT_PREFERENCES, defaultOutput: dir }}
      onTrail={(t) => trails.push(t)}
      onCancel={vi.fn()}
      onClose={over.onClose ?? vi.fn()}
      settleMs={100}
      pollMs={25}
    />,
  )
  unmount = r.unmount
  const frame = () => r.lastFrame() ?? ''
  shown = () => `${frame()}\n${r.stderr.lastFrame() ?? ''}`
  return { ...r, frame, trails }
}

describe('WatchFlow, one kind', () => {
  it('opens Resolution on its own default, not on the row Convert to left the cursor at', async () => {
    const dir = await makeTempDir()
    await makePdf(dir, 'a.pdf', 1)
    const f = await open(dir)
    await until(() => f.frame().includes('Convert to'))
    f.stdin.write(`${ESC}[A`) // JPEG, above PNG
    await tick()
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Resolution'))
    expect(f.frame()).toMatch(/❯ 150 dpi/)
  })

  it('asks as a file does: the folder’s card, Convert to, WebP first', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makeJpeg(dir, 'b.jpg')
    const f = await open(dir)
    await until(() => f.frame().includes('Convert to'))
    expect(f.frame()).toContain(`FOLDER – ${basename(dir)}`)
    expect(f.frame()).toMatch(/2 images · \d/)
    expect(f.frame()).toMatch(/Convert to\s+2 images/)
    expect(f.frame()).toMatch(/❯ WebP/)
    expect(f.trails.at(-1)).toEqual({ answers: [], current: 'Format' })
  })

  it('walks Quality and Save as, converts the folder, then watches it', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makeJpeg(dir, 'b.jpg')
    const f = await open(dir)
    await until(() => f.frame().includes('Convert to'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Quality'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Save as'))
    expect(f.frame()).toMatch(/files\s+a\.webp … 2 files/)
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Watching'))
    expect(existsSync(join(dir, 'a.webp'))).toBe(true)
    expect(existsSync(join(dir, 'b.webp'))).toBe(true)
    expect(f.frame()).toContain(`Watching ${basename(dir)}`)
    expect(f.frame()).toContain('Any new files you add will be converted.')
    expect(f.frame()).toMatch(/✓ 2 images/)
    await until(() => f.trails.at(-1)?.current === 'Watching')
    expect(f.trails.at(-1)?.answers).toEqual(['WebP', '80', 'Same location'])
  })

  it('a file that lands gets its row: what it became, how big, when', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    const f = await open(dir)
    await until(() => f.frame().includes('Convert to'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Quality'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Save as'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Watching'))
    await makePng(dir, 'hero-v2.png')
    await until(() => /✓ hero-v2\.png\s+PNG → WebP\s+\d+ B\s+\d\d:\d\d/.test(f.frame()))
    expect(existsSync(join(dir, 'hero-v2.webp'))).toBe(true)
    // Its own output is never picked up as a file that landed.
    await tick()
    await tick()
    expect(f.frame()).not.toMatch(/hero-v2\.webp/)
  })

  it('↵ while watching stops and goes home', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    const onClose = vi.fn()
    const f = await open(dir, { onClose })
    await until(() => f.frame().includes('Convert to'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Quality'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Save as'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Watching'))
    await tick()
    f.stdin.write(ENTER)
    await until(() => onClose.mock.calls.length > 0)
    await writeFile(join(dir, 'late.png'), 'x')
    await new Promise((r) => setTimeout(r, 400))
    expect(existsSync(join(dir, 'late.webp'))).toBe(false)
  })
})

describe('WatchFlow, several kinds', () => {
  async function mixed() {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makePdf(dir, 'deck.pdf', 1)
    await writeFile(join(dir, 'notes.txt'), 'hello\n')
    return dir
  }

  it('asks once per kind: the count, the kind, its answer', async () => {
    const f = await open(await mixed())
    await until(() => f.frame().includes('Each kind'))
    expect(f.frame()).toMatch(/▌ +1 {2}Images {4}WebP · 80/)
    expect(f.frame()).toMatch(/1 {2}PDFs {6}PNG · 150 dpi/)
    expect(f.frame()).toMatch(/1 {2}Other {5}– {2}a text file/)
    expect(f.frame()).toMatch(/3 files · /)
    expect(f.trails.at(-1)).toEqual({ answers: [], current: 'Each kind' })
  })

  it('↵ on a kind opens its window; ←→ change, ↵ keeps it', async () => {
    const f = await open(await mixed())
    await until(() => f.frame().includes('Each kind'))
    f.stdin.write(DOWN)
    await tick()
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Resolution'))
    expect(f.frame()).toMatch(/1 PDF ─/)
    expect(f.frame()).toMatch(/› Format +‹ PNG ›/)
    f.stdin.write(DOWN)
    await tick()
    f.stdin.write(RIGHT)
    await until(() => f.frame().includes('‹ 300 dpi ›'))
    f.stdin.write(ENTER)
    await until(() => !f.frame().includes('Resolution'))
    expect(f.frame()).toMatch(/PDFs {6}PNG · 300 dpi/)
  })

  it('esc in the window puts the answer back', async () => {
    const f = await open(await mixed())
    await until(() => f.frame().includes('Each kind'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Quality'))
    f.stdin.write(RIGHT)
    await tick()
    f.stdin.write(ESC)
    await until(() => !f.frame().includes('Quality'))
    expect(f.frame()).toMatch(/Images {4}WebP · 80/)
  })

  it('s starts: Save as, then each kind converted with its own answer', async () => {
    const dir = await mixed()
    const f = await open(dir)
    await until(() => f.frame().includes('Each kind'))
    f.stdin.write('s')
    await until(() => f.frame().includes('Save as'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Watching'), 10_000)
    expect(existsSync(join(dir, 'a.webp'))).toBe(true)
    expect(existsSync(join(dir, 'deck-1.png'))).toBe(true)
  })
})

describe('WatchFlow, a long list', () => {
  it('follows the newest; scrolled up, it stays put and counts what lands below', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    const f = await open(dir)
    await until(() => f.frame().includes('Convert to'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Quality'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Save as'))
    f.stdin.write(ENTER)
    await until(() => f.frame().includes('Watching'))
    for (let i = 10; i < 20; i++) await makePng(dir, `IMG_${i}.png`)
    await until(() => /✓ IMG_19\.png/.test(f.frame()), 10_000)
    // The newest is in view, the oldest has scrolled off, and the keys can scroll.
    expect(f.frame()).not.toMatch(/IMG_10\.png/)
    expect(f.frame()).toMatch(/↑↓\]?\s+scroll/)
    f.stdin.write(`${ESC}[A`)
    await tick()
    await makePng(dir, 'IMG_20.png')
    await until(() => f.frame().includes('↓ 1 new'), 10_000)
    expect(f.frame()).not.toMatch(/IMG_20\.png/)
  }, 30_000)
})
