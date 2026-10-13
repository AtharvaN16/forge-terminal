import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Gives every test run one temp root and deletes it when the run ends.
 *
 * Roughly fifty test files make fixtures with `mkdtemp(tmpdir())` and none of
 * them clean up — a full run left a few hundred `forge-test-*` folders behind,
 * and enough runs filled the disk. Pointing `TMPDIR` at a per-run folder
 * catches all of them, including subprocesses the tests spawn, without
 * touching each call site. Workers inherit the variable because they start
 * after global setup.
 *
 * The settings go there too: a save remembers its folder in the config
 * (`lastOutput`), and no test may write the real one. A test that needs its
 * own config home still sets XDG_CONFIG_HOME itself.
 */
export default function setup(): () => void {
  const root = mkdtempSync(join(tmpdir(), 'forge-run-'))
  const previous = process.env.TMPDIR
  const previousConfig = process.env.XDG_CONFIG_HOME
  process.env.TMPDIR = root
  process.env.XDG_CONFIG_HOME = join(root, 'config')

  return () => {
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
    if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previousConfig
    rmSync(root, { recursive: true, force: true })
  }
}
