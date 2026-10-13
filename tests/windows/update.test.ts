import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { spawnRefresh } from '../../src/cli/update-note.js'
import { installedGlobally, installUpdate, type RunResult } from '../../src/update/install.js'

const PREFIX = 'C:\\Users\\a\\AppData\\Roaming\\npm'
const GLOBAL = `${PREFIX}\\node_modules\\forge-terminal\\dist\\index.js`
/** A global install's shim, and npm's own entry point beside node.exe. */
const exists = (p: string) => p === `${PREFIX}\\forge.cmd` || p.endsWith('\\npm-cli.js')

function fakeRun(result: RunResult) {
  const calls: { cmd: string; args: string[] }[] = []
  const run = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    return result
  }
  return { run, calls }
}

describe('forge update on Windows', () => {
  it('knows npm i -g by the forge.cmd shim in the prefix, not by a lib folder', () => {
    expect(installedGlobally(GLOBAL, 'win32', exists)).toBe(true)
    // A project's copy has the same node_modules\forge-terminal, and no shim beside it.
    const project = 'C:\\Users\\a\\code\\site\\node_modules\\forge-terminal\\dist\\index.js'
    expect(installedGlobally(project, 'win32', exists)).toBe(false)
  })

  it('runs npm-cli.js through this node, since npm.cmd will not spawn without a shell', async () => {
    const { run, calls } = fakeRun({ code: 0, output: '' })
    await installUpdate('0.2.2', { run, script: GLOBAL, platform: 'win32', exists })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.cmd).toBe(process.execPath)
    expect(calls[0]?.args[0]).toMatch(/\\node_modules\\npm\\bin\\npm-cli\.js$/)
    expect(calls[0]?.args.slice(1)).toEqual(['install', '--global', 'forge-terminal@0.2.2'])
  })

  it('says a running Forge holds its files when npm gets EPERM, with no sudo', async () => {
    const { run } = fakeRun({
      code: 4294963238,
      output:
        "npm error code EPERM\nnpm error Error: EPERM: operation not permitted, rename 'C:\\…'",
    })
    await expect(
      installUpdate('0.2.2', { run, script: GLOBAL, platform: 'win32', exists }),
    ).rejects.toMatchObject({
      code: 'update-denied',
      detail: expect.stringContaining('close every Forge window'),
      hint: 'npm i -g forge-terminal@0.2.2',
    })
  })

  it('starts the background check with its console hidden', () => {
    const spawnImpl = vi.fn(() => ({ unref() {} })) as unknown as typeof spawn
    spawnRefresh(GLOBAL, 'win32', spawnImpl)
    spawnRefresh('/opt/homebrew/lib/node_modules/forge-terminal/dist/index.js', 'darwin', spawnImpl)
    const opts = vi.mocked(spawnImpl).mock.calls.map((c) => c[2])
    expect(opts[0]).toMatchObject({ detached: true, windowsHide: true })
    expect(opts[1]).not.toHaveProperty('windowsHide')
  })
})
