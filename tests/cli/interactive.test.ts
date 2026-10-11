import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const readPassword = vi.fn(async () => undefined as string | undefined)
vi.mock('../../src/cli/stdin.js', () => ({ readPassword }))

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

describe('runIntent with interactive: false', () => {
  async function lockedIntent(extra: { password?: string } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'forge-int-'))
    const path = join(dir, 'locked.pdf')
    await cp(LOCKED, path)
    return {
      kind: 'convert' as const,
      inputs: [path],
      target: 'png' as const,
      options: { background: '#ffffff', keepMetadata: false },
      force: false,
      recursive: false,
      debug: false,
      dpi: 150,
      passwordStdin: true,
      ...extra,
    }
  }

  it('never asks for a password, and refuses with encrypted-source', async () => {
    const { runIntent } = await import('../../src/cli/execute.js')
    readPassword.mockClear()
    const report = await runIntent(await lockedIntent(), { interactive: false })
    expect(readPassword).not.toHaveBeenCalled()
    expect(report.failures[0]?.error.code).toBe('encrypted-source')
  })

  it('still asks when interactive (the default)', async () => {
    const { runIntent } = await import('../../src/cli/execute.js')
    readPassword.mockClear()
    await runIntent(await lockedIntent())
    expect(readPassword).toHaveBeenCalledTimes(1)
  })
})
