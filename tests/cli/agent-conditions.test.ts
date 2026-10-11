import { existsSync } from 'node:fs'
import { cp, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { runForge, type StdinMode } from '../helpers/run-forge.js'

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

async function lockedCopy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'forge-agent-'))
  const path = join(dir, 'locked.pdf')
  await cp(LOCKED, path)
  return path
}

const NO_TTY: StdinMode[] = [{ kind: 'closed' }, { kind: 'open' }]

describe('an encrypted PDF with no terminal (spec §3.1)', () => {
  for (const stdin of NO_TTY) {
    it(`fails at once with stdin ${stdin.kind}, naming --password-stdin`, async () => {
      const path = await lockedCopy()
      const run = await runForge([path, '--to', 'jpeg'], { stdin })
      expect(run.timedOut).toBe(false)
      expect(run.exitCode).toBe(1)
      expect(run.stderr).toContain('password-protected')
      expect(run.stderr).toContain('--password-stdin')
      expect(run.stderr).not.toContain('Password:')
      expect(run.stdout).toBe('')
    })
  }

  it('reads one line from a pipe that stays open, instead of waiting for EOF', async () => {
    const path = await lockedCopy()
    const run = await runForge([path, '--to', 'jpeg', '--password-stdin'], {
      stdin: { kind: 'open-after', text: 'hunter2\n' },
    })
    expect(run.timedOut).toBe(false)
    expect(run.exitCode).toBe(0)
    expect(existsSync(join(path, '..', 'locked-1.jpg'))).toBe(true)
  })

  it('accepts a password sent without a trailing newline, as echo -n sends it', async () => {
    const path = await lockedCopy()
    const run = await runForge([path, '--to', 'png', '--password-stdin'], {
      stdin: { kind: 'text', text: 'hunter2' },
    })
    expect(run.exitCode).toBe(0)
    expect(existsSync(join(path, '..', 'locked-1.png'))).toBe(true)
  })

  it('says a wrong password did not open it, without suggesting the flag just used', async () => {
    const path = await lockedCopy()
    const run = await runForge([path, '--to', 'jpeg', '--password-stdin'], {
      stdin: { kind: 'text', text: 'not-the-password\n' },
    })
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain("didn't open it")
    expect(run.stderr).not.toContain('--password-stdin')
    expect(run.stderr).not.toContain('not-the-password')
  })
})

describe('ordinary commands with no terminal', () => {
  for (const stdin of NO_TTY) {
    it(`converts and exits with stdin ${stdin.kind}`, async () => {
      const dir = await makeTempDir()
      const jpg = await makeJpeg(dir, 'a.jpg')
      const run = await runForge([jpg, '--to', 'webp'], { stdin })
      expect(run.timedOut).toBe(false)
      expect(run.exitCode).toBe(0)
      expect(existsSync(join(dir, 'a.webp'))).toBe(true)
    })

    it(`lists formats and exits with stdin ${stdin.kind}`, async () => {
      const run = await runForge(['--formats'], { stdin })
      expect(run.timedOut).toBe(false)
      expect(run.exitCode).toBe(0)
    })

    it(`exits 2 on a bad flag with stdin ${stdin.kind}`, async () => {
      const run = await runForge(['--bogus'], { stdin })
      expect(run.timedOut).toBe(false)
      expect(run.exitCode).toBe(2)
    })
  }
})
