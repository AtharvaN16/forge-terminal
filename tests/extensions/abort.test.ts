import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boostAction } from '../../src/core/actions/extension.js'
import { runPlan } from '../../src/core/execute-jobs.js'
import { probe } from '../../src/engines/registry.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'

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
