import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { access } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openPath, openUrl, revealLabel, revealPath } from '../../src/shell/reveal.js'

// A factory, not automock: automock keeps execFile's util.promisify.custom as a
// stub returning undefined, which would bypass the callback this test drives.
vi.mock('node:child_process', () => ({ execFile: vi.fn(), spawn: vi.fn() }))
// On Windows the file is looked for first; these paths exist on no machine.
vi.mock('node:fs/promises', async (orig) => ({
  ...(await orig<typeof import('node:fs/promises')>()),
  access: vi.fn(),
}))

type Done = (err: Error | null, out?: unknown) => void
/** Makes the mocked execFile finish with `err` (or succeed when omitted). */
function finishWith(err?: Error & { code?: unknown }): void {
  vi.mocked(execFile).mockImplementation(((...a: unknown[]) => {
    ;(a[a.length - 1] as Done)(err ?? null, { stdout: '', stderr: '' })
  }) as never)
}
const calls = () => vi.mocked(execFile).mock.calls

/** Makes the mocked spawn start the program, or fail to with `err`. */
function spawnWith(err?: Error) {
  vi.mocked(spawn).mockImplementation((() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    process.nextTick(() => (err ? child.emit('error', err) : child.emit('spawn')))
    return child
  }) as never)
}
const spawned = () => vi.mocked(spawn).mock.calls.map((c) => c.slice(0, 2))

beforeEach(() => {
  vi.mocked(access).mockReset().mockResolvedValue(undefined)
  vi.mocked(execFile).mockReset()
  vi.mocked(spawn).mockReset()
  finishWith()
  spawnWith()
})

describe('open and reveal on macOS', () => {
  it('opens with open and reveals with open -R', async () => {
    await openPath('/a/b.png', 'darwin')
    await revealPath('/a/b.png', 'darwin')
    expect(calls()[0]?.slice(0, 2)).toEqual(['open', ['/a/b.png']])
    expect(calls()[1]?.slice(0, 2)).toEqual(['open', ['-R', '/a/b.png']])
  })
})

describe('opening a web address', () => {
  it('hands it to open on macOS, and to explorer.exe on Windows without looking for a file', async () => {
    await openUrl('https://atharvanayak.design/', 'darwin')
    expect(calls()[0]?.slice(0, 2)).toEqual(['open', ['https://atharvanayak.design/']])
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
    finishWith(Object.assign(new Error('exit 1'), { code: 1 }))
    await expect(openUrl('https://atharvanayak.design/', 'win32')).resolves.toBeUndefined()
    expect(calls()[1]?.slice(0, 2)).toEqual(['explorer.exe', ['https://atharvanayak.design/']])
  })
})

describe('open and reveal on Windows', () => {
  it('reveals with explorer.exe /select, and treats its exit code 1 as success', async () => {
    finishWith(Object.assign(new Error('exit 1'), { code: 1 }))
    await expect(revealPath('C:\\a\\b.png', 'win32')).resolves.toBeUndefined()
    expect(calls()[0]?.slice(0, 2)).toEqual(['explorer.exe', ['/select,', 'C:\\a\\b.png']])
  })

  it('opens with explorer.exe, again ignoring a numeric exit code', async () => {
    finishWith(Object.assign(new Error('exit 1'), { code: 1 }))
    await expect(openPath('C:\\a\\b.png', 'win32')).resolves.toBeUndefined()
    expect(calls()[0]?.slice(0, 2)).toEqual(['explorer.exe', ['C:\\a\\b.png']])
  })

  it('rejects when explorer.exe cannot be run at all', async () => {
    finishWith(Object.assign(new Error('spawn'), { code: 'ENOENT' }))
    await expect(revealPath('C:\\a', 'win32')).rejects.toThrow('spawn')
  })
})

describe('open and reveal on Linux', () => {
  it('opens with xdg-open, let go rather than waited on, once the file is found', async () => {
    await openPath('/a/b.png', 'linux')
    expect(spawned()).toEqual([['xdg-open', ['/a/b.png']]])
    expect(vi.mocked(spawn).mock.calls[0]?.[2]).toMatchObject({ detached: true, stdio: 'ignore' })
    expect(access).toHaveBeenCalledWith('/a/b.png')
  })

  it('fails the way open does for a file that is not there', async () => {
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'))
    await expect(openPath('/gone.png', 'linux')).rejects.toThrow(
      'The file /gone.png does not exist.',
    )
    expect(spawned()).toEqual([])
  })

  it('opens a web address with xdg-open, and fails when xdg-open is missing', async () => {
    await openUrl('https://atharvanayak.design/', 'linux')
    expect(spawned()).toEqual([['xdg-open', ['https://atharvanayak.design/']]])
    spawnWith(Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' }))
    await expect(openUrl('https://x.y/', 'linux')).rejects.toThrow('ENOENT')
  })

  it('asks the file manager over D-Bus to show the file selected', async () => {
    await revealPath('/a b/c,d.png', 'linux')
    const [cmd, args] = calls()[0] ?? []
    expect(cmd).toBe('gdbus')
    expect(args).toContain('org.freedesktop.FileManager1.ShowItems')
    expect(args).toContain("['file:///a%20b/c%2Cd.png']")
    expect(spawned()).toEqual([])
  })

  it('uses dbus-send where gdbus is not installed', async () => {
    let n = 0
    vi.mocked(execFile).mockImplementation(((...a: unknown[]) => {
      const err =
        n++ === 0 ? Object.assign(new Error('spawn gdbus ENOENT'), { code: 'ENOENT' }) : null
      ;(a[a.length - 1] as Done)(err, { stdout: '', stderr: '' })
    }) as never)
    await revealPath('/a/b.png', 'linux')
    expect(calls()[1]?.[0]).toBe('dbus-send')
    expect(calls()[1]?.[1]).toContain('array:string:file:///a/b.png')
    expect(spawned()).toEqual([])
  })

  it('opens the folder instead when no file manager answers', async () => {
    finishWith(Object.assign(new Error('ServiceUnknown'), { code: 1 }))
    await revealPath('/a/b.png', 'linux')
    expect(spawned()).toEqual([['xdg-open', ['/a']]])
  })
})

describe('revealLabel', () => {
  it('names the platform file manager', () => {
    expect(revealLabel('darwin')).toBe('Show in Finder')
    expect(revealLabel('win32')).toBe('Show in Explorer')
    expect(revealLabel('linux')).toBe('Show in file manager')
  })
})
