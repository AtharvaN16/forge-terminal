import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { closeExtensionServers, runExtension } from '../../src/extensions/run.js'
import { TSX_CLI } from '../helpers/run-forge.js'

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

/**
 * A runner that serves (`--serve`): one JSON job a line, answered as a
 * one-file run would answer it. Each process it starts appends its pid to
 * --log's file, and each job's own `--mode` says what it does.
 */
const servingEntry = join(dir, 'serving.mjs')
writeFileSync(
  servingEntry,
  `import { appendFileSync } from 'node:fs'
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
if (process.argv[2] !== '--serve') { say({ ok: false, code: 'runtime-error', message: 'one-file run' }); process.exit(1) }
let started = false
let pending = ''
let queue = Promise.resolve()
process.stdin.on('end', () => process.exit(0))
process.stdin.setEncoding('utf8').on('data', (d) => {
  const lines = (pending + d).split('\\n')
  pending = lines.pop()
  for (const line of lines) queue = queue.then(() => job(JSON.parse(line).args))
})
async function job(a) {
  const get = (k) => a[a.indexOf(k) + 1]
  const mode = get('--mode')
  if (!started) { started = true; appendFileSync(get('--log'), process.pid + '\\n') }
  if (mode === 'ok') say({ ok: true, width: a.includes('--w') ? Number(get('--w')) : 3, height: 4, ms: 5 })
  else if (mode === 'counts') { for (let i = 0; i <= 2; i++) say({ progress: i, of: 2 }); say({ ok: true, width: 1, height: 1, ms: 1 }) }
  else if (mode === 'too-large') say({ ok: false, code: 'boost-too-large', message: 'big' })
  else if (mode === 'too-slow') say({ ok: false, code: 'boost-too-slow', message: 'slow', seconds: 420 })
  else if (mode === 'runtime') say({ ok: false, code: 'runtime-error', message: 'kaboom' })
  else if (mode === 'die') { process.stderr.write('fell over\\n'); process.exit(3) }
  else if (mode === 'hang') await new Promise(() => {})
}
`,
)

describe('runExtension with a runner that serves', () => {
  const serving = { id: 'serving-test', entry: servingEntry, kind: 'node' as const, serve: true }
  let n = 0
  const logFile = () => {
    const f = join(dir, `serve-log-${n++}.txt`)
    writeFileSync(f, '')
    return f
  }
  const pids = (f: string) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean)
  const job = (log: string, mode: string, extra: string[] = []) => [
    '--in',
    '/x/photo.png',
    '--out',
    '/x/o.png',
    '--scale',
    '2',
    '--mode',
    mode,
    '--log',
    log,
    ...extra,
  ]
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const until = async (cond: () => boolean) => {
    for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
  }
  afterEach(() => closeExtensionServers())

  it('sends a batch through one process, each job getting its own result and counts', async () => {
    const log = logFile()
    const counts: Array<[number, number]> = []
    const results = await Promise.all([
      runExtension(serving, job(log, 'ok', ['--w', '10'])),
      runExtension(serving, job(log, 'counts'), { onProgress: (d, o) => counts.push([d, o]) }),
      runExtension(serving, job(log, 'ok', ['--w', '30'])),
    ])
    expect(results).toEqual([
      { width: 10, height: 4, ms: 5 },
      { width: 1, height: 1, ms: 1 },
      { width: 30, height: 4, ms: 5 },
    ])
    expect(counts).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ])
    expect(pids(log)).toHaveLength(1)
  })

  it('maps each refusal as a one-file run does, and keeps the process for the next job', async () => {
    const log = logFile()
    expect(await codeOf(runExtension(serving, job(log, 'too-slow')))).toBe('boost-too-slow')
    expect(await codeOf(runExtension(serving, job(log, 'too-large')))).toBe('boost-too-large')
    expect(await codeOf(runExtension(serving, job(log, 'runtime')))).toBe('conversion-failed')
    expect(await runExtension(serving, job(log, 'ok'))).toEqual({ width: 3, height: 4, ms: 5 })
    expect(pids(log)).toHaveLength(1)
  })

  it('fails only the job a process died in, with what it said, and starts a new one for the next', async () => {
    const log = logFile()
    let failure: unknown
    await runExtension(serving, job(log, 'die')).catch((e) => {
      failure = e
    })
    expect(isForgeError(failure) && failure.code).toBe('conversion-failed')
    expect(String((failure as { cause?: unknown }).cause)).toMatch(
      /exit 3 without a result: fell over/,
    )
    expect(await runExtension(serving, job(log, 'ok'))).toEqual({ width: 3, height: 4, ms: 5 })
    expect(pids(log)).toHaveLength(2)
  })

  it('on abort kills the process, rejects once it has exited, and starts afresh after', async () => {
    const log = logFile()
    const controller = new AbortController()
    const reason = new Error('stopped by the user')
    const running = runExtension(serving, job(log, 'hang'), { signal: controller.signal })
    await until(() => pids(log).length === 1)
    const pid = Number(pids(log)[0])
    controller.abort(reason)
    await expect(running).rejects.toBe(reason)
    expect(alive(pid)).toBe(false)
    expect(await runExtension(serving, job(log, 'ok'))).toEqual({ width: 3, height: 4, ms: 5 })
    expect(pids(log)).toHaveLength(2)
  })

  it('starts nothing for a job aborted before its turn', async () => {
    const log = logFile()
    const controller = new AbortController()
    controller.abort()
    expect(
      await codeOf(runExtension(serving, job(log, 'ok'), { signal: controller.signal })),
    ).toMatch(/non-forge/)
    expect(pids(log)).toEqual([])
  })

  it('lets the process go once no job has come for a while: its input closes and it exits', async () => {
    const log = logFile()
    await runExtension(serving, job(log, 'ok'), { idleMs: 50 })
    const pid = Number(pids(log)[0])
    await until(() => !alive(pid))
    expect(alive(pid)).toBe(false)
    // The next job starts a new one.
    await runExtension(serving, job(log, 'ok'))
    expect(pids(log)).toHaveLength(2)
  })

  it('lets a waiting process go when asked (before the tool is removed or updated)', async () => {
    const log = logFile()
    await runExtension(serving, job(log, 'ok'))
    const pid = Number(pids(log)[0])
    expect(alive(pid)).toBe(true)
    await closeExtensionServers('serving-test')
    expect(alive(pid)).toBe(false)
  })

  it('uses a new process when the installed version (its entry) changes', async () => {
    const log = logFile()
    const other = join(dir, 'serving-copy.mjs')
    writeFileSync(other, readFileSync(servingEntry))
    await runExtension(serving, job(log, 'ok'))
    const first = Number(pids(log)[0])
    await runExtension({ ...serving, entry: other }, job(log, 'ok'))
    expect(pids(log)).toHaveLength(2)
    // The old version's process is let go, not left waiting.
    await until(() => !alive(first))
    expect(alive(first)).toBe(false)
  })

  it('does not keep a forge that is done running, and goes when that forge exits', async () => {
    const log = logFile()
    // A forge of its own: one job, then nothing left to do.
    const script = join(dir, 'one-job.mts')
    const runUrl = pathToFileURL(join(process.cwd(), 'src', 'extensions', 'run.ts')).href
    writeFileSync(
      script,
      `import { runExtension } from ${JSON.stringify(runUrl)}
await runExtension(${JSON.stringify(serving)}, ${JSON.stringify(job(log, 'ok'))})
process.stdout.write(String(Date.now()))
`,
    )
    const child = spawn(process.execPath, [TSX_CLI, script])
    let out = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d
    })
    const code = await new Promise<number | null>((r) => child.on('close', r))
    const exited = Date.now()
    expect(code).toBe(0)
    // Out as soon as the job was answered, not after the runner's idle wait (5 s).
    expect(exited - Number(out)).toBeLessThan(2500)
    const pid = Number(pids(log)[0])
    await until(() => !alive(pid))
    expect(alive(pid)).toBe(false)
  })

  it('still spawns one process a job for a runner that does not serve', async () => {
    const log = logFile()
    const plain = { ...serving, serve: false }
    expect(await codeOf(runExtension(plain, job(log, 'ok')))).toBe('conversion-failed')
  })
})
