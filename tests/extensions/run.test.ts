import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { runExtension } from '../../src/extensions/run.js'

const dir = mkdtempSync(join(tmpdir(), 'forge-run-'))
const entry = join(dir, 'fake.mjs')
// Behaviour is picked by the first positional-ish arg: --mode <m> [--log <file>]
writeFileSync(
  entry,
  `import { appendFileSync } from 'node:fs'
const a = process.argv.slice(2)
const get = (k) => a[a.indexOf(k) + 1]
const mode = get('--mode'), log = get('--log')
const say = (o) => console.log(JSON.stringify(o))
if (mode === 'ok') say({ ok: true, width: 3, height: 4, ms: 5 })
else if (mode === 'no-subject') { say({ ok: false, code: 'no-subject', message: 'none' }); process.exit(2) }
else if (mode === 'too-large') { say({ ok: false, code: 'boost-too-large', message: 'big' }); process.exit(1) }
else if (mode === 'runtime') { say({ ok: false, code: 'runtime-error', message: 'kaboom' }); process.exit(1) }
else if (mode === 'garbage') { console.log('not json at all') }
else if (mode === 'noisy') { say({ loading: 'model' }); say({ ok: true, width: 7, height: 8, ms: 9 }) }
else if (mode === 'counts') {
  const total = 3
  for (let i = 0; i <= total; i++) say({ progress: i, of: total })
  say({ ok: true, width: 1, height: 1, ms: 1 })
}
else if (mode === 'bad-counts') {
  say({ progress: 'two', of: 3 }); say({ progress: 1, of: 0 }); say({ loading: 'model' })
  say({ ok: true, width: 1, height: 1, ms: 1 })
}
else if (mode === 'slow') {
  appendFileSync(log, 'start\\n')
  setTimeout(() => { appendFileSync(log, 'end\\n'); say({ ok: true, width: 1, height: 1, ms: 1 }) }, 150)
}
`,
)
const ext = { entry, kind: 'node' as const }
const run = (mode: string, extra: string[] = []) =>
  runExtension(ext, [
    '--in',
    '/x/photo.png',
    '--out',
    '/x/o.png',
    '--scale',
    '4',
    '--mode',
    mode,
    ...extra,
  ])

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return isForgeError(e) ? e.code : `non-forge: ${e}`
  }
  return 'resolved'
}

describe('runExtension', () => {
  it('returns the single JSON result of a successful child', async () => {
    expect(await run('ok')).toEqual({ width: 3, height: 4, ms: 5 })
  })

  it('reports a child’s tile counts as they arrive, and still returns its result', async () => {
    const counts: Array<[number, number]> = []
    const r = await runExtension(
      ext,
      ['--in', '/x/photo.png', '--out', '/x/o.png', '--mode', 'counts'],
      { onProgress: (done, of) => counts.push([done, of]) },
    )
    expect(r).toEqual({ width: 1, height: 1, ms: 1 })
    expect(counts).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('ignores a line that only looks like a count, and a child that counts nothing', async () => {
    const counts: Array<[number, number]> = []
    const opts = { onProgress: (done: number, of: number) => counts.push([done, of]) }
    const args = (mode: string) => ['--in', '/x/photo.png', '--out', '/x/o.png', '--mode', mode]
    await runExtension(ext, args('bad-counts'), opts)
    await runExtension(ext, args('ok'), opts)
    expect(counts).toEqual([])
  })

  it('maps the child error codes to ForgeErrors', async () => {
    expect(await codeOf(run('no-subject'))).toBe('no-subject')
    expect(await codeOf(run('too-large'))).toBe('boost-too-large')
    expect(await codeOf(run('runtime'))).toBe('conversion-failed')
  })

  it('reads the result from the last JSON line, past earlier noise', async () => {
    expect(await run('noisy')).toEqual({ width: 7, height: 8, ms: 9 })
  })

  it('names the factor Forge worked out, never the refused one, when the child says too large', async () => {
    const detail = async (opts: { maxScale?: number }) => {
      try {
        await runExtension(ext, ['--in', '/x/in.png', '--scale', '4', '--mode', 'too-large'], {
          subject: '/photos/banner.png',
          ...opts,
        })
      } catch (e) {
        return isForgeError(e) ? e.detail : String(e)
      }
      return 'resolved'
    }
    expect(await detail({ maxScale: 2 })).toBe(
      'banner.png is too large to boost that far; 2x is the most it can take.',
    )
    expect(await detail({})).toBe('banner.png is already too large to boost.')
  })

  it('treats output that is not the JSON contract as a failure', async () => {
    expect(await codeOf(run('garbage'))).toBe('conversion-failed')
  })

  it('runs two concurrent jobs one after the other', async () => {
    const log = join(dir, 'log.txt')
    writeFileSync(log, '')
    await Promise.all([run('slow', ['--log', log]), run('slow', ['--log', log])])
    expect(readFileSync(log, 'utf8')).toBe('start\nend\nstart\nend\n')
  })
})
