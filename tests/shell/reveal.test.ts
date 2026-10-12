import { execFile } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openPath, revealLabel, revealPath } from '../../src/shell/reveal.js'

// A factory, not automock: automock keeps execFile's util.promisify.custom as a
// stub returning undefined, which would bypass the callback this test drives.
vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

type Done = (err: Error | null, out?: unknown) => void
/** Makes the mocked execFile finish with `err` (or succeed when omitted). */
function finishWith(err?: Error & { code?: unknown }): void {
  vi.mocked(execFile).mockImplementation(((...a: unknown[]) => {
    ;(a[a.length - 1] as Done)(err ?? null, { stdout: '', stderr: '' })
  }) as never)
}
const calls = () => vi.mocked(execFile).mock.calls

beforeEach(() => {
  vi.mocked(execFile).mockReset()
  finishWith()
})

describe('open and reveal on macOS', () => {
  it('opens with open and reveals with open -R', async () => {
    await openPath('/a/b.png', 'darwin')
    await revealPath('/a/b.png', 'darwin')
    expect(calls()[0]?.slice(0, 2)).toEqual(['open', ['/a/b.png']])
    expect(calls()[1]?.slice(0, 2)).toEqual(['open', ['-R', '/a/b.png']])
  })
})

describe('open and reveal on Windows', () => {
  it('reveals with explorer.exe /select, and treats its exit code 1 as success', async () => {
    finishWith(Object.assign(new Error('exit 1'), { code: 1 }))
    await expect(revealPath('C:\\a\\b.png', 'win32')).resolves.toBeUndefined()
    expect(calls()[0]?.slice(0, 2)).toEqual(['explorer.exe', ['/select,C:\\a\\b.png']])
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

describe('revealLabel', () => {
  it('names the platform file manager', () => {
    expect(revealLabel('darwin')).toBe('Show in Finder')
    expect(revealLabel('win32')).toBe('Show in Explorer')
  })
})
