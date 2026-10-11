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
 */
export default function setup(): () => void {
  const root = mkdtempSync(join(tmpdir(), 'forge-run-'))
  const previous = process.env.TMPDIR
  process.env.TMPDIR = root

  return () => {
    if (previous === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previous
    rmSync(root, { recursive: true, force: true })
  }
}
