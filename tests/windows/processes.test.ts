import { execFile, execFileSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expandTilde } from '../../src/config/preferences.js'
import { paste } from '../../src/shell/clipboard.js'
import { openPath, revealPath } from '../../src/shell/reveal.js'
import { reraise } from '../../src/shell/useMouse.js'
import { resetKnownFoldersForTests } from '../../src/utils/known-folders.js'

// A factory, not automock: automock keeps execFile's util.promisify.custom as a
// stub returning undefined, which would bypass the callback reveal drives.
vi.mock('node:child_process', () => ({ execFile: vi.fn(), execFileSync: vi.fn() }))
// The Windows paths below do not exist on the machine running the tests.
vi.mock('node:fs/promises', async (orig) => ({
  ...(await orig<typeof import('node:fs/promises')>()),
  access: vi.fn(),
}))

type Done = (err: Error | null, out?: unknown) => void

beforeEach(() => {
  vi.mocked(access).mockReset().mockResolvedValue(undefined)
  vi.mocked(execFile).mockReset()
  vi.mocked(execFileSync).mockReset()
})

describe('Show in Explorer and Open', () => {
  beforeEach(() => {
    // explorer.exe exits 1 even when it did what it was asked.
    vi.mocked(execFile).mockImplementation(((...a: unknown[]) => {
      ;(a[a.length - 1] as Done)(Object.assign(new Error('exit 1'), { code: 1 }))
    }) as never)
  })

  it('pass Explorer a backslashed path, and /select, as its own argument', async () => {
    const built = 'C:\\Users\\a\\OneDrive - Contoso\\Desktop/My Photo.png'
    await revealPath(built, 'win32')
    await openPath(built, 'win32')
    const want = 'C:\\Users\\a\\OneDrive - Contoso\\Desktop\\My Photo.png'
    expect(vi.mocked(execFile).mock.calls[0]?.slice(0, 2)).toEqual([
      'explorer.exe',
      ['/select,', want],
    ])
    expect(vi.mocked(execFile).mock.calls[1]?.slice(0, 2)).toEqual(['explorer.exe', [want]])
  })

  it('fail like macOS open when the file is gone, instead of exiting 1 in silence', async () => {
    const enoent = () => Object.assign(new Error('nope'), { code: 'ENOENT' })
    vi.mocked(access).mockRejectedValueOnce(enoent()).mockRejectedValueOnce(enoent())
    const gone = 'C:\\Users\\a\\gone.png'
    await expect(revealPath(gone, 'win32')).rejects.toThrow('does not exist')
    await expect(openPath(gone, 'win32')).rejects.toThrow('does not exist')
    expect(execFile).not.toHaveBeenCalled()
  })
})

describe('the default ~/Desktop on Windows', () => {
  beforeEach(resetKnownFoldersForTests)

  it('is the redirected Desktop, read once through PowerShell as UTF-8', () => {
    const desktop = 'C:\\Users\\a\\OneDrive - Société Générale\\Bureau'
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(`${desktop}\r\n`, 'utf8') as never)

    expect(expandTilde('~/Desktop', 'win32')).toBe(desktop)
    expect(expandTilde('~/Desktop', 'win32')).toBe(desktop)

    expect(execFileSync).toHaveBeenCalledTimes(1)
    const [cmd, args] = vi.mocked(execFileSync).mock.calls[0] as unknown as [string, string[]]
    expect(cmd).toBe('powershell.exe')
    expect(args.at(-1)).toContain('[Console]::OutputEncoding=[Text.Encoding]::UTF8')
    expect(args.at(-1)).toContain("GetFolderPath('Desktop')")
  })
})

describe('paste on Windows', () => {
  it('gives a cold PowerShell 5 s', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('x\r\n') as never)
    expect(paste('win32')).toBe('x')
    const opts = vi.mocked(execFileSync).mock.calls[0]?.[2] as { timeout?: number }
    expect(opts.timeout).toBe(5000)
  })
})

describe('re-raising a signal on quit', () => {
  it('on Windows exits with the signal status when the re-raise throws (SIGHUP: ENOSYS)', () => {
    const enosys = () => {
      throw Object.assign(new Error('kill ENOSYS'), { code: 'ENOSYS' })
    }
    const exit = vi.fn()
    reraise('SIGHUP', 'win32', enosys, exit)
    reraise('SIGINT', 'win32', enosys, exit)
    expect(exit.mock.calls).toEqual([[129], [130]])
  })

  it('on macOS re-raises the signal itself', () => {
    const kill = vi.fn()
    const exit = vi.fn()
    reraise('SIGHUP', 'darwin', kill, exit)
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGHUP')
    expect(exit).not.toHaveBeenCalled()
  })
})
