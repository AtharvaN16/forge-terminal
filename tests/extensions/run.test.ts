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
else if (mode === 'too-slow') { say({ ok: false, code: 'boost-too-slow', message: 'slow', seconds: 420 }); process.exit(1) }
else if (mode === 'runtime') { say({ ok: false, code: 'runtime-error', message: 'kaboom' }); process.exit(1) }
else if (mode === 'garbage') { console.log('not json at all') }
else if (mode === 'noisy') { say({ loading: 'model' }); say({ ok: true, width: 7, height: 8, ms: 9 }) }
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

  it('maps the child error codes to ForgeErrors', async () => {
    expect(await codeOf(run('no-subject'))).toBe('no-subject')
    expect(await codeOf(run('too-large'))).toBe('boost-too-large')
    expect(await codeOf(run('runtime'))).toBe('conversion-failed')
  })

  it('maps a run that would take minutes to its own error, saying how long', async () => {
    expect(await codeOf(run('too-slow'))).toBe('boost-too-slow')
    const detail = async (scale: string) => {
      try {
        await runExtension(ext, ['--in', '/x/in.png', '--scale', scale, '--mode', 'too-slow'], {
          subject: '/photos/banner.png',
        })
      } catch (e) {
        return isForgeError(e) ? [e.title, e.detail, e.hint] : [String(e)]
      }
      return ['resolved']
    }
    const mac = process.platform === 'darwin'
    const where = mac ? 'Mac' : process.platform === 'win32' ? 'PC' : 'computer'
    expect(await detail('2')).toEqual([
      'Too slow to boost',
      `banner.png would take about 7 minutes to boost on this ${where}.`,
      'Try a smaller photo.',
    ])
    // Sharpen is the same job at 1x, and says so.
    expect(await detail('1')).toEqual([
      'Too slow to sharpen',
      `banner.png would take about 7 minutes to sharpen on this ${where}.`,
      'Try a smaller photo.',
    ])
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
