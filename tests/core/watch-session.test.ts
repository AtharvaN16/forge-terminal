import { existsSync } from 'node:fs'
import { copyFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanFolder } from '../../src/core/folder.js'
import {
  convertFolder,
  startWatch,
  type WatchEvent,
  type WatchSession,
} from '../../src/core/watch-session.js'
import {
  makeCorruptFile,
  makeJpeg,
  makeNoiseImage,
  makePdf,
  makePng,
  makeTempDir,
} from '../helpers/fixtures.js'

const FAST = { settleMs: 100, pollMs: 25 }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])

/** The events that finish a file, as `type name detail`. */
const ends = (events: WatchEvent[]) =>
  events
    .filter((e) => e.type === 'converted' || e.type === 'left' || e.type === 'failed')
    .map((e) =>
      e.type === 'converted'
        ? `converted ${basename(e.path)} ${e.result.job.outputs.map((o) => basename(o)).join(',')}`
        : e.type === 'left'
          ? `left ${basename(e.path)} ${e.reason}`
          : `failed ${basename(e.path)}`,
    )

async function until(events: WatchEvent[], n: number, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (ends(events).length < n) {
    if (Date.now() > end) throw new Error(`ended ${ends(events).length} of ${n}`)
    await wait(10)
  }
}

let session: WatchSession | undefined
afterEach(async () => {
  await session?.stop()
  session = undefined
})

describe('convertFolder', () => {
  it('converts each kind with its own answer, and says what it left alone', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makeJpeg(dir, 'b.jpg')
    await makePdf(dir, 'c.pdf', 1)
    await copyFile(join(dir, 'a.png'), join(dir, 'already.webp')).catch(() => {})
    const scan = await scanFolder(dir)
    const run = await convertFolder(scan, {
      images: { target: 'png' },
      pdfs: { target: 'png', dpi: 72 },
    })
    expect(run.outcome.results.map((r) => basename(r.job.outputs[0] ?? '')).sort()).toEqual([
      'b.png',
      'c-1.png',
    ])
    expect(run.left.map((l) => `${basename(l.path)} ${l.reason}`)).toContain('a.png already PNG')
    expect(existsSync(join(dir, 'b.png'))).toBe(true)
    expect(run.claimed.has(join(dir, 'b.png'))).toBe(true)
  })

  it('converts nothing of a kind it has no answer for', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makePdf(dir, 'c.pdf', 1)
    const run = await convertFolder(await scanFolder(dir), { images: { target: 'jpeg' } })
    expect(run.outcome.results.map((r) => basename(r.job.outputs[0] ?? ''))).toEqual(['a.jpg'])
  })
})

describe('startWatch', () => {
  it('converts a file that lands, and never picks up what it wrote', async () => {
    const dir = await makeTempDir()
    const events: WatchEvent[] = []
    session = startWatch({
      dir,
      answers: { images: { target: 'webp', quality: 80 } },
      known: [],
      claimed: new Set(),
      onEvent: (e) => events.push(e),
      ...FAST,
    })
    await makePng(dir, 'hero.png')
    await until(events, 1)
    await wait(400)
    expect(ends(events)).toEqual(['converted hero.png hero.webp'])
    expect(events[0]).toEqual({ type: 'arrived', path: join(dir, 'hero.png') })
    expect(existsSync(join(dir, 'hero.webp'))).toBe(true)
  })

  it('compresses a file that lands, and never picks up its own -small file', async () => {
    const dir = await makeTempDir()
    const events: WatchEvent[] = []
    const claimed = new Set<string>()
    session = startWatch({
      dir,
      answers: { op: 'compress', quality: 40 },
      known: [],
      claimed,
      onEvent: (e) => events.push(e),
      ...FAST,
    })
    await makeNoiseImage(dir, 'hero.jpg', 200, 'jpeg')
    await until(events, 1)
    await wait(400)
    // What was claimed beside what arrived, so a miss says why (it has, on Windows).
    const arrived = events.flatMap((e) => (e.type === 'arrived' ? [e.path] : []))
    expect(ends(events), JSON.stringify({ claimed: [...claimed], arrived })).toEqual([
      'converted hero.jpg hero-small.jpg',
    ])
    expect(existsSync(join(dir, 'hero-small.jpg'))).toBe(true)
  })

  it('leaves a kind with no answer alone, and says it is not that kind', async () => {
    const dir = await makeTempDir()
    const events: WatchEvent[] = []
    session = startWatch({
      dir,
      answers: { images: { target: 'webp' } },
      known: [],
      claimed: new Set(),
      onEvent: (e) => events.push(e),
      ...FAST,
    })
    await makePdf(dir, 'deck.pdf', 1)
    await writeFile(join(dir, 'intro.mp4'), MP4)
    await until(events, 2)
    expect(ends(events).sort()).toEqual([
      'left deck.pdf not an image',
      'left intro.mp4 not yet supported',
    ])
  })

  it('reports a damaged file as failed and carries on', async () => {
    const dir = await makeTempDir()
    const events: WatchEvent[] = []
    session = startWatch({
      dir,
      answers: { images: { target: 'webp' } },
      known: [],
      claimed: new Set(),
      onEvent: (e) => events.push(e),
      ...FAST,
    })
    await makeCorruptFile(dir, 'scan-03.png')
    await until(events, 1)
    await makePng(dir, 'next.png')
    await until(events, 2)
    expect(ends(events)).toEqual(['failed scan-03.png', 'converted next.png next.webp'])
  })

  it('finishes the file it is converting before it stops', async () => {
    const dir = await makeTempDir()
    const events: WatchEvent[] = []
    session = startWatch({
      dir,
      answers: { images: { target: 'avif', quality: 50 } },
      known: [],
      claimed: new Set(),
      onEvent: (e) => events.push(e),
      ...FAST,
    })
    await makeJpeg(dir, 'a.jpg')
    const end = Date.now() + 3000
    while (!events.some((e) => e.type === 'arrived') && Date.now() < end) await wait(5)
    const stopping = session.stop()
    session = undefined
    await stopping
    expect(ends(events)).toEqual(['converted a.jpg a.avif'])
  })
})
