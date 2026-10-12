import { execFile, execFileSync } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { copy, paste } from '../../src/shell/clipboard.js'

vi.mock('node:child_process')

const end = vi.fn()
beforeEach(() => {
  vi.mocked(execFile).mockReset()
  vi.mocked(execFileSync).mockReset()
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
