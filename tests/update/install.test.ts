import { describe, expect, it } from 'vitest'
import {
  installedGlobally,
  installUpdate,
  npmBeside,
  type RunResult,
} from '../../src/update/install.js'

const GLOBAL = '/opt/homebrew/lib/node_modules/forge-terminal/dist/index.js'

function fakeRun(result: RunResult) {
  const calls: { cmd: string; args: string[] }[] = []
  const run = async (cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    return result
  }
  return { run, calls }
}

describe('installedGlobally', () => {
  it('is true for a forge that npm i -g put in a global node_modules', () => {
    expect(installedGlobally(GLOBAL, 'darwin')).toBe(true)
    expect(
      installedGlobally(
        '/Users/me/.nvm/versions/node/v24.1.0/lib/node_modules/forge-terminal/dist/index.js',
        'darwin',
      ),
    ).toBe(true)
  })

  it('is false for a checkout, npx, or anything else', () => {
    expect(installedGlobally('/Users/me/Developer/forge/src/index.ts', 'darwin')).toBe(false)
    expect(
      installedGlobally(
        '/Users/me/.npm/_npx/abc/node_modules/forge-terminal/dist/index.js',
        'darwin',
      ),
    ).toBe(false)
    expect(installedGlobally(undefined, 'darwin')).toBe(false)
  })
})

// The Mac layout; Windows runs npm-cli.js through node (tests/windows/update.test.ts).
describe.skipIf(process.platform === 'win32')('npmBeside', () => {
  it('uses the npm next to the node running Forge, so it updates the same install', () => {
    expect(npmBeside('/opt/homebrew/bin/node', (p) => p === '/opt/homebrew/bin/npm')).toBe(
      '/opt/homebrew/bin/npm',
    )
  })

  it('falls back to npm on PATH', () => {
    expect(npmBeside('/opt/homebrew/bin/node', () => false)).toBe('npm')
  })
})

describe('installUpdate', () => {
  it('installs exactly the version it was offered', async () => {
    const { run, calls } = fakeRun({ code: 0, output: 'added 1 package' })
    await installUpdate('0.2.2', {
      run,
      npm: '/opt/homebrew/bin/npm',
      script: GLOBAL,
      platform: 'darwin',
    })
    expect(calls).toEqual([
      { cmd: '/opt/homebrew/bin/npm', args: ['install', '--global', 'forge-terminal@0.2.2'] },
    ])
  })

  it('refuses, naming the command, when Forge was not installed with npm i -g', async () => {
    const { run, calls } = fakeRun({ code: 0, output: '' })
    await expect(
      installUpdate('0.2.2', {
        run,
        npm: 'npm',
        script: '/Users/me/forge/src/index.ts',
        platform: 'darwin',
      }),
    ).rejects.toMatchObject({
      code: 'update-unavailable',
      hint: expect.stringContaining('npm i -g forge-terminal'),
    })
    expect(calls).toEqual([])
  })

  it('says npm needs permission, and gives the sudo command, when it is refused', async () => {
    const { run } = fakeRun({
      code: 243,
      output:
        'npm error code EACCES\nnpm error syscall rename\nnpm error Error: EACCES: permission denied',
    })
    await expect(
      installUpdate('0.2.2', { run, npm: 'npm', script: GLOBAL, platform: 'darwin' }),
    ).rejects.toMatchObject({
      code: 'update-denied',
      hint: 'sudo npm i -g forge-terminal@0.2.2',
    })
  })

  it('reports any other failure with npm’s own last words', async () => {
    const { run } = fakeRun({
      code: 1,
      output: 'npm error code ETIMEDOUT\nnpm error network timeout',
    })
    await expect(
      installUpdate('0.2.2', { run, npm: 'npm', script: GLOBAL, platform: 'darwin' }),
    ).rejects.toMatchObject({
      code: 'update-failed',
      detail: expect.stringContaining('network timeout'),
    })
  })
})

describe('runningScript', () => {
  // npm's bin on Windows is a forge.cmd shim, not a symlink.
  it.skipIf(process.platform === 'win32')(
    'follows the bin symlink npm makes to the real file in node_modules',
    async () => {
      const { mkdir, symlink, writeFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const { makeTempDir } = await import('../helpers/fixtures.js')
      const { runningScript } = await import('../../src/update/install.js')
      const root = await makeTempDir()
      const real = join(root, 'lib', 'node_modules', 'forge-terminal', 'dist', 'index.js')
      await mkdir(join(root, 'lib', 'node_modules', 'forge-terminal', 'dist'), { recursive: true })
      await writeFile(real, '')
      await mkdir(join(root, 'bin'))
      await symlink(real, join(root, 'bin', 'forge'))
      const resolved = runningScript(join(root, 'bin', 'forge'))
      expect(resolved?.endsWith('/lib/node_modules/forge-terminal/dist/index.js')).toBe(true)
      expect(installedGlobally(resolved, 'darwin')).toBe(true)
    },
  )

  it('is undefined when there is no script', async () => {
    const { runningScript } = await import('../../src/update/install.js')
    expect(runningScript(undefined)).toBeUndefined()
  })
})
