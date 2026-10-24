import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
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
        { what: name, onWait: () => log.push(`${name} waits`) },
      )
    const first = job('a')
    // Until a holds it, not a fixed 20 ms: a slow Windows runner missed that,
    // and its retry ran while the first try's job a was still taking the lock
    // — under the restored config home, with no .locks to write in.
    while ((await extensionInUse('boost')) === undefined) await sleep(5)
    expect(await extensionInUse('boost')).toEqual({ pid: process.pid, what: 'a' })
    await Promise.all([first, job('b')])
    // b says it is waiting (Working's "Waiting for another window") before a ends.
    expect(log).toEqual(['a start', 'b waits', 'a end', 'b start', 'b end'])
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
      // An OS boost is offered on, whatever runs the tests.
      code = await removeExtension('boost', 'darwin').then(
        () => 'removed',
        (e) => (isForgeError(e) ? e.code : String(e)),
      )
    })
    expect(code).toBe('extension-in-use')
  })

  const locks = () => join(extensionsRoot(), '.locks')
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000)

  it('reclaims a lock older than the age cap even when its pid is alive (a reused pid)', async () => {
    await mkdir(locks(), { recursive: true })
    const path = join(locks(), 'boost.lock')
    await writeFile(path, JSON.stringify({ pid: process.pid, token: 'old', at: 0 }))
    await utimes(path, hoursAgo(13), hoursAgo(13))
    expect(await withExtensionLock('boost', async () => 'ran', { waitMs: 0 })).toBe('ran')
  })

  it('on release, leaves a lock that is no longer its own', async () => {
    const path = join(locks(), 'boost.lock')
    await withExtensionLock('boost', async () => {
      // Reclaimed and taken by another forge while this one ran.
      await writeFile(path, JSON.stringify({ pid: process.pid, token: 'theirs', at: Date.now() }))
    })
    expect(JSON.parse(await readFile(path, 'utf8')).token).toBe('theirs')
  })

  it('sweeps temp and moved-aside lock files a dead forge left, but not fresh ones', async () => {
    await mkdir(locks(), { recursive: true })
    const old = ['boost.lock.0123abcd', 'boost.lock.stale-9f9f']
    for (const name of [...old, 'boost.lock.fedc']) await writeFile(join(locks(), name), '{}')
    for (const name of old) await utimes(join(locks(), name), hoursAgo(1), hoursAgo(1))
    await withExtensionLock('boost', async () => {})
    expect(await readdir(locks())).toEqual(['boost.lock.fedc'])
  })
})
