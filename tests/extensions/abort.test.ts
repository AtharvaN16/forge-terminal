import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { afterEach, describe, expect, it } from 'vitest'
import { boostAction } from '../../src/core/actions/extension.js'
import { conversionFailed } from '../../src/core/errors.js'
import { runPlan } from '../../src/core/execute-jobs.js'
import { extensionEngine } from '../../src/engines/extension.js'
import { probe } from '../../src/engines/registry.js'
import { createForgeServer } from '../../src/mcp/server.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'
import { pinPlatform } from '../helpers/platform.js'

// The catalogue offers these extensions on macOS; see pinPlatform.
pinPlatform('darwin')
const fake = fakeExtensions()
afterEach(() => fake.restore())
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 25))
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('aborting an extension job', () => {
  it('kills the child and writes nothing', async () => {
    const home = await fake.home()
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    const pidFile = join(dir, 'pid')
    // A runner that reports its pid, then sleeps far longer than the test.
    writeFileSync(
      join(home, 'forge', 'extensions', 'boost', '1.0.0', 'runner.mjs'),
      `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
setTimeout(() => {}, 60000)`,
    )
    const source = await probe(await makeTransparentPng(dir, 'photo.png'))
    const [job] = boostAction.plan([source], { scale: '2', output: dir })
    if (!job) throw new Error('no job planned')

    const controller = new AbortController()
    const running = runPlan([job], { force: false, signal: controller.signal })
    await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '')
    const pid = Number(readFileSync(pidFile, 'utf8'))
    expect(alive(pid)).toBe(true)

    controller.abort()
    const outcome = await running
    expect(outcome.cancelled).toBe(true)
    expect(outcome.results).toEqual([])
    expect(existsSync(job.outputs[0] as string)).toBe(false)
    await until(() => !alive(pid))
    expect(alive(pid)).toBe(false)
  })
})

describe('cancelling a batch of extension jobs', () => {
  it('starts no decode or child after the cancel and leaves no temp dirs', async () => {
    const home = await fake.home()
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    const log = join(dir, 'spawned')
    writeFileSync(log, '')
    writeFileSync(
      join(home, 'forge', 'extensions', 'boost', '1.0.0', 'runner.mjs'),
      `import { appendFileSync } from 'node:fs'
appendFileSync(${JSON.stringify(log)}, 'x')
setTimeout(() => {}, 60000)`,
    )
    const sources = await Promise.all(
      ['a', 'b', 'c'].map(async (n) => probe(await makeTransparentPng(dir, `${n}.png`))),
    )
    const jobs = boostAction.plan(sources, { scale: '2', output: dir })
    // The engine's temp dirs go under os.tmpdir(); give it one of our own to inspect.
    const tmp = await makeTempDir()
    const savedTmp = process.env.TMPDIR
    process.env.TMPDIR = tmp
    try {
      const controller = new AbortController()
      let decodes = 0
      const running = runPlan(jobs, {
        force: false,
        concurrency: 1,
        signal: controller.signal,
        onEvent: (e) => {
          if (e.type === 'job:phase' && e.progress.phase === 'decoding') decodes++
        },
      })
      await until(() => readFileSync(log, 'utf8').length > 0)
      controller.abort()
      const outcome = await running

      expect(outcome.cancelled).toBe(true)
      expect(readFileSync(log, 'utf8')).toBe('x')
      expect(decodes).toBe(1)
      expect(jobs.filter((j) => existsSync(j.outputs[0] as string))).toEqual([])
      expect(readdirSync(tmp).filter((f) => f.startsWith('forge-ext-'))).toEqual([])
    } finally {
      if (savedTmp === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = savedTmp
    }
  })

  it('still reports a failure that happened before the cancel', async () => {
    const dir = await makeTempDir()
    const sources = await Promise.all(
      ['bad', 'slow'].map(async (n) => probe(await makeTransparentPng(dir, `${n}.png`))),
    )
    const jobs = boostAction.plan(sources, { scale: '2', output: dir })
    const controller = new AbortController()
    const stub = {
      ...extensionEngine,
      run: (job: (typeof jobs)[number], _: unknown, signal?: AbortSignal) => {
        const path = job.sources[0].path
        if (path.endsWith('bad.png'))
          return Promise.reject(conversionFailed(path, new Error('broken')))
        controller.abort()
        return Promise.reject(signal?.reason)
      },
    }
    const outcome = await runPlan(jobs, {
      force: false,
      concurrency: 1,
      signal: controller.signal,
      engineFor: () => stub,
    })
    expect(outcome.cancelled).toBe(true)
    expect(outcome.failures.map((f) => f.path)).toEqual([sources[0]?.path])
  })
})

describe('cancelling an MCP tool call', () => {
  it('kills the extension child and writes nothing', async () => {
    const home = await fake.home()
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    const pidFile = join(dir, 'pid')
    writeFileSync(
      join(home, 'forge', 'extensions', 'boost', '1.0.0', 'runner.mjs'),
      `import { writeFileSync } from 'node:fs'
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))
setTimeout(() => {}, 60000)`,
    )
    const src = await makeTransparentPng(dir, 'photo.png')
    const [c, s] = InMemoryTransport.createLinkedPair()
    await createForgeServer().connect(s)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(c)
    try {
      const controller = new AbortController()
      const call = client.callTool(
        { name: 'forge_convert', arguments: { paths: [src], to: 'png', boost: 2 } },
        { signal: controller.signal },
      )
      call.catch(() => {})
      await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '')
      const pid = Number(readFileSync(pidFile, 'utf8'))
      controller.abort()
      await until(() => !alive(pid))
      expect(alive(pid)).toBe(false)
      expect(existsSync(join(dir, 'photo-2x.png'))).toBe(false)
    } finally {
      await client.close()
    }
  })
})
