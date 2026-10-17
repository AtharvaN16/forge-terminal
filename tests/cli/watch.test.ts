import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { runWatch } from '../../src/cli/watch-command.js'
import { isForgeError } from '../../src/core/errors.js'
import { makeCorruptFile, makeJpeg, makePng, makeTempDir } from '../helpers/fixtures.js'

function parseError(argv: string[]) {
  try {
    parseArgs(argv)
  } catch (e) {
    if (isForgeError(e)) return e
    throw e
  }
  throw new Error(`parsed: ${argv.join(' ')}`)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const FAST = { settleMs: 100, pollMs: 25 }

describe('parseArgs watch', () => {
  it('takes a folder and a target', () => {
    expect(parseArgs(['watch', './images', '--to', 'webp'])).toEqual({
      kind: 'watch',
      folder: './images',
      target: 'webp',
      newOnly: false,
      debug: false,
    })
  })

  it('takes quality, resolution, an output folder and --new-only', () => {
    expect(
      parseArgs([
        'watch',
        'in',
        '-t',
        'jpg',
        '-q',
        '70',
        '--dpi',
        '300',
        '-o',
        'out',
        '--new-only',
      ]),
    ).toEqual({
      kind: 'watch',
      folder: 'in',
      target: 'jpeg',
      quality: 70,
      dpi: 300,
      output: 'out',
      newOnly: true,
      debug: false,
    })
  })

  it('needs a folder', () => {
    expect(parseError(['watch', '--to', 'webp']).code).toBe('invalid-arguments')
  })

  it('needs a target', () => {
    expect(parseError(['watch', './images']).code).toBe('invalid-arguments')
  })

  it('watches one folder at a time', () => {
    expect(parseError(['watch', 'a', 'b', '--to', 'webp']).code).toBe('invalid-arguments')
  })

  it('refuses a flag it does not take', () => {
    expect(parseError(['watch', 'a', '--to', 'webp', '--recursive']).code).toBe('invalid-arguments')
  })
})

/** Runs `forge watch` until `act` is done and the folder has settled, then stops it as ctrl-c would. */
async function watchWhile(
  args: string[],
  act: () => Promise<void>,
  opts: { json?: boolean } = {},
): Promise<{ code: number; lines: string[] }> {
  const intent = parseArgs(['watch', ...args])
  if (intent.kind !== 'watch') throw new Error('not a watch')
  const lines: string[] = []
  const stop = new AbortController()
  const running = runWatch(intent, {
    out: (l) => lines.push(l),
    json: opts.json ?? false,
    signal: stop.signal,
    ...FAST,
  })
  const end = Date.now() + 5000
  while (!lines.some((l) => l.includes('Watching') || l.includes('"watching"'))) {
    if (Date.now() > end) throw new Error(`never watched: ${lines.join('\n')}`)
    await wait(10)
  }
  await act()
  await wait(900)
  stop.abort()
  return { code: await running, lines }
}

describe('runWatch', () => {
  it('converts what is there, then each new file, then the totals', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    await makeJpeg(dir, 'b.jpg')
    const { code, lines } = await watchWhile([dir, '--to', 'webp'], async () => {
      await makePng(dir, 'hero-v2.png')
    })
    expect(code).toBe(0)
    expect(lines[0]).toBe('✓ 2 converted to WebP')
    expect(lines[1]).toMatch(
      /^Watching .+ · any new files you add will be converted · ctrl-c to stop$/,
    )
    expect(lines.find((l) => l.startsWith('✓ hero-v2.png'))).toMatch(
      /^✓ hero-v2\.png → hero-v2\.webp {3}\d+ B$/,
    )
    expect(lines.at(-1)).toBe('✓ 3 converted')
    expect(existsSync(join(dir, 'hero-v2.webp'))).toBe(true)
  })

  it('says what failed and what it left alone, and exits 1 for a failure', async () => {
    const dir = await makeTempDir()
    const { code, lines } = await watchWhile([dir, '--to', 'webp'], async () => {
      await makeCorruptFile(dir, 'scan-03.png')
      await writeFile(join(dir, 'notes.txt'), 'hello\n')
    })
    expect(lines).toContain('✕ scan-03.png   damaged file')
    expect(lines).toContain('– notes.txt   a text file')
    expect(lines.at(-1)).toBe('✓ 0 converted · 1 failed · 1 left alone')
    expect(code).toBe(1)
  })

  it('leaves what is there alone with --new-only', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    const { lines } = await watchWhile([dir, '--to', 'webp', '--new-only'], async () => {})
    expect(existsSync(join(dir, 'a.webp'))).toBe(false)
    expect(lines[0]).toMatch(/^Watching /)
  })

  it('writes into the output folder', async () => {
    const dir = await makeTempDir()
    const out = join(dir, 'out')
    await makePng(dir, 'a.png')
    await watchWhile([dir, '--to', 'jpeg', '-o', out], async () => {})
    expect(existsSync(join(out, 'a.jpg'))).toBe(true)
  })

  it('prints one JSON document per line with --json', async () => {
    const dir = await makeTempDir()
    await makePng(dir, 'a.png')
    const { lines } = await watchWhile(
      [dir, '--to', 'webp'],
      async () => {
        await makePng(dir, 'b.png')
      },
      { json: true },
    )
    const events = lines.map((l) => JSON.parse(l) as { event: string })
    expect(events.map((e) => e.event)).toEqual([
      'converted-existing',
      'watching',
      'converted',
      'stopped',
    ])
    expect(events.at(-1)).toMatchObject({ converted: 2, failed: 0, leftAlone: 0 })
  })

  it('refuses a path that is not a folder', async () => {
    const dir = await makeTempDir()
    const file = await makePng(dir, 'a.png')
    const intent = parseArgs(['watch', file, '--to', 'webp'])
    if (intent.kind !== 'watch') throw new Error('not a watch')
    const lines: string[] = []
    const code = await runWatch(intent, {
      out: (l) => lines.push(l),
      json: false,
      signal: new AbortController().signal,
    })
    expect(code).toBe(2)
    expect(lines.join('\n')).toMatch(/not a folder/i)
  })
})
