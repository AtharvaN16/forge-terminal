import { execFile, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { linuxTools, powershell } from '../../src/utils/pasteboard.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

vi.mock('node:child_process')

/** How the real commands are started; what they do is pinned in pasteboard.test.ts. */

beforeEach(() => {
  vi.mocked(execFile).mockReset()
  vi.mocked(spawn).mockReset()
})

/** execFile answering through its callback, with output as bytes. */
function answers(stdout: string | Buffer) {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const done = args.at(-1) as (e: Error | null, out: Buffer, err: Buffer) => void
    done(null, Buffer.from(stdout), Buffer.alloc(0))
  }) as never)
}

describe('powershell', () => {
  it('runs the script encoded, single-threaded, with paths in the environment', async () => {
    answers('{"ok":true}\r\n')
    const out = await powershell('Get-Clipboard', { FORGE_CLIP_PATH: "C:\\it's here.png" })
    expect(out).toBe('{"ok":true}')
    const [file, args, opts] = vi.mocked(execFile).mock.calls[0] as unknown as [
      string,
      string[],
      { env: Record<string, string>; windowsHide: boolean },
    ]
    expect(file).toBe('powershell.exe')
    expect(args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand'])
    expect(Buffer.from(args[4] as string, 'base64').toString('utf16le')).toBe('Get-Clipboard')
    expect(opts.env.FORGE_CLIP_PATH).toBe("C:\\it's here.png")
    expect(opts.windowsHide).toBe(true)
  })
})

describe('linuxTools', () => {
  it('run reads the whole output as bytes', async () => {
    answers(Buffer.from([0x89, 0x50]))
    expect(await linuxTools.run('xclip', ['-o'])).toEqual(Buffer.from([0x89, 0x50]))
    const opts = vi.mocked(execFile).mock.calls[0]?.[2] as unknown as {
      encoding: string
      maxBuffer: number
    }
    expect(opts.encoding).toBe('buffer')
    expect(opts.maxBuffer).toBeGreaterThan(64 * 1024 * 1024)
  })

  it('copy feeds the file in and keeps no pipe to the child left holding the copy', async () => {
    const child = new EventEmitter()
    vi.mocked(spawn).mockImplementation((() => {
      setImmediate(() => child.emit('exit', 0))
      return child
    }) as never)
    const path = await makePng(await makeTempDir(), 'a.png')
    await linuxTools.copy('wl-copy', ['--type', 'image/png'], path)
    const [cmd, args, opts] = vi.mocked(spawn).mock.calls[0] as unknown as [
      string,
      string[],
      { stdio: unknown[]; detached: boolean },
    ]
    expect([cmd, args]).toEqual(['wl-copy', ['--type', 'image/png']])
    expect(typeof opts.stdio[0]).toBe('number')
    expect(opts.stdio.slice(1)).toEqual(['ignore', 'ignore'])
    expect(opts.detached).toBe(true)
  })

  it('copy fails with ENOENT when the command is not installed', async () => {
    const child = new EventEmitter()
    vi.mocked(spawn).mockImplementation((() => {
      setImmediate(() => child.emit('error', Object.assign(new Error('nope'), { code: 'ENOENT' })))
      return child
    }) as never)
    const path = await makePng(await makeTempDir(), 'a.png')
    await expect(linuxTools.copy('xclip', [], path)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('copy fails when the command does', async () => {
    const child = new EventEmitter()
    vi.mocked(spawn).mockImplementation((() => {
      setImmediate(() => child.emit('exit', 1))
      return child
    }) as never)
    await expect(
      linuxTools.copy('xclip', [], await makePng(await makeTempDir(), 'a.png')),
    ).rejects.toThrow(/exited with 1/)
    await expect(linuxTools.copy('xclip', [], join(await makeTempDir(), 'none'))).rejects.toThrow()
  })
})
