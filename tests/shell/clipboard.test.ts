import { execFile, execFileSync, spawn } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copy, linuxText, paste } from '../../src/shell/clipboard.js'

vi.mock('node:child_process')

const end = vi.fn()
beforeEach(() => {
  vi.mocked(execFile).mockReset()
  vi.mocked(execFileSync).mockReset()
  vi.mocked(spawn).mockReset()
  end.mockReset()
  vi.mocked(execFile).mockReturnValue({ on: vi.fn(), stdin: { end } } as never)
})

describe('clipboard on macOS', () => {
  it('copies through pbcopy', () => {
    copy('x', 'darwin')
    expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe('pbcopy')
    expect(end).toHaveBeenCalledWith(Buffer.from('x', 'utf8'))
  })

  it('pastes through pbpaste', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('hi'))
    expect(paste('darwin')).toBe('hi')
    expect(vi.mocked(execFileSync).mock.calls[0]?.[0]).toBe('pbpaste')
  })
})

describe('clipboard on Windows', () => {
  it('copies as UTF-16LE with a BOM through clip.exe', () => {
    copy('héllo', 'win32')
    expect(vi.mocked(execFile).mock.calls[0]?.[0]).toBe('clip.exe')
    expect(end).toHaveBeenCalledWith(
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('héllo', 'utf16le')]),
    )
  })

  it('pastes through PowerShell and drops the one trailing line break it adds', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('a\r\nb\r\n'))
    expect(paste('win32')).toBe('a\r\nb')
    const [file, args] = vi.mocked(execFileSync).mock.calls[0] ?? []
    expect(file).toBe('powershell.exe')
    expect(args).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw',
    ])
  })
})

describe('clipboard on Linux', () => {
  const enoent = () => Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })

  /** A spawned child that fails to start when `missing`, as a command not installed does. */
  function children(missing: string[]) {
    const ends: Record<string, unknown> = {}
    vi.mocked(spawn).mockImplementation(((cmd: string) => {
      const handlers: Record<string, (e: unknown) => void> = {}
      if (missing.includes(cmd)) setImmediate(() => handlers.error?.(enoent()))
      return {
        on: (ev: string, f: (e: unknown) => void) => {
          handlers[ev] = f
        },
        unref: vi.fn(),
        stdin: { on: vi.fn(), end: (b: unknown) => (ends[cmd] = b) },
      }
    }) as never)
    return ends
  }

  it('copies through wl-copy on Wayland, as UTF-8, with nothing piped back', () => {
    const ends = children([])
    copy('héllo', 'linux', { WAYLAND_DISPLAY: 'wayland-0' })
    const [cmd, args, opts] = vi.mocked(spawn).mock.calls[0] ?? []
    expect([cmd, args]).toEqual(['wl-copy', ['--type', 'text/plain;charset=utf-8']])
    expect(opts).toMatchObject({ stdio: ['pipe', 'ignore', 'ignore'], detached: true })
    expect(ends['wl-copy']).toEqual(Buffer.from('héllo', 'utf8'))
  })

  it('copies through xclip on X11, then xsel when xclip is not installed', async () => {
    const ends = children(['xclip'])
    copy('x', 'linux', { DISPLAY: ':0' })
    expect(vi.mocked(spawn).mock.calls[0]?.slice(0, 2)).toEqual([
      'xclip',
      ['-selection', 'clipboard', '-i'],
    ])
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(vi.mocked(spawn).mock.calls[1]?.slice(0, 2)).toEqual([
      'xsel',
      ['--clipboard', '--input'],
    ])
    expect(ends.xsel).toEqual(Buffer.from('x'))
  })

  it('copies nothing, and does not throw, without a desktop', () => {
    copy('x', 'linux', {})
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
  })

  it('pastes text by name through wl-paste, never a copied picture', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('hi'))
    expect(paste('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBe('hi')
    const [file, args] = vi.mocked(execFileSync).mock.calls[0] ?? []
    expect([file, args]).toEqual(['wl-paste', ['--no-newline', '--type', 'text']])
  })

  it('pastes through xclip, then xsel when xclip is not installed', () => {
    vi.mocked(execFileSync).mockImplementation(((cmd: string) => {
      if (cmd === 'xclip') throw enoent()
      return Buffer.from('from xsel')
    }) as never)
    expect(paste('linux', { DISPLAY: ':0' })).toBe('from xsel')
    expect(vi.mocked(execFileSync).mock.calls.map((c) => c[0])).toEqual(['xclip', 'xsel'])
    expect(vi.mocked(execFileSync).mock.calls[1]?.[1]).toEqual(['--clipboard', '--output'])
  })

  it('pastes nothing when the clipboard holds no text, without trying the next command', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw Object.assign(new Error('Error: target UTF8_STRING not available'), { status: 1 })
    })
    expect(paste('linux', { DISPLAY: ':0' })).toBe('')
    expect(vi.mocked(execFileSync)).toHaveBeenCalledTimes(1)
  })

  it('pastes nothing without a desktop', () => {
    expect(paste('linux', {})).toBe('')
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled()
  })

  it('prefers Wayland’s commands, then X11’s through XWayland', () => {
    expect(linuxText({ WAYLAND_DISPLAY: 'w', DISPLAY: ':0' }, 'paste').map((c) => c[0])).toEqual([
      'wl-paste',
      'xclip',
      'xsel',
    ])
  })
})
