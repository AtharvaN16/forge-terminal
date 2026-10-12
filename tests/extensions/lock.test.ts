import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isForgeError } from '../../src/core/errors.js'
import { extensionInUse, withExtensionLock } from '../../src/extensions/lock.js'
import { removeExtension } from '../../src/extensions/manager.js'
import { extensionsRoot } from '../../src/extensions/paths.js'

const savedXdg = process.env.XDG_CONFIG_HOME
let config = ''
beforeEach(async () => {
  config = await mkdtemp(join(tmpdir(), 'forge-lock-'))
  process.env.XDG_CONFIG_HOME = config
})
afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = savedXdg
  await rm(config, { recursive: true, force: true })
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('extension lock', () => {
  it('lets only one holder run at a time; the second waits for the first', async () => {
    const log: string[] = []
    const job = (name: string) =>
      withExtensionLock(
        'boost',
        async () => {
          log.push(`${name} start`)
          await sleep(120)
          log.push(`${name} end`)
        },
        { what: name },
      )
    const first = job('a')
    await sleep(20)
    expect(await extensionInUse('boost')).toEqual({ pid: process.pid, what: 'a' })
    await Promise.all([first, job('b')])
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end'])
    expect(await extensionInUse('boost')).toBeUndefined()
  })

  it('reclaims a lock left by a process that has exited', async () => {
    // A real pid that is certainly dead: a child that has already exited.
    const dead = spawnSync(process.execPath, ['-e', '0']).pid
    await mkdir(join(extensionsRoot(), '.locks'), { recursive: true })
    await writeFile(
      join(extensionsRoot(), '.locks', 'boost.lock'),
      JSON.stringify({ pid: dead, token: 'old', at: 0, what: 'crashed' }),
    )
    expect(await extensionInUse('boost')).toBeUndefined()
    expect(await withExtensionLock('boost', async () => 'ran', { waitMs: 0 })).toBe('ran')
  })

  it('refuses to remove a tool while a job holds it', async () => {
    let code = ''
    await withExtensionLock('boost', async () => {
      code = await removeExtension('boost').then(
        () => 'removed',
        (e) => (isForgeError(e) ? e.code : String(e)),
      )
    })
    expect(code).toBe('extension-in-use')
  })
})
