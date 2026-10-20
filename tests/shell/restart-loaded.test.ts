import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * /update's restart runs after npm has replaced Forge's files. The bundle's
 * chunks are named by hash, so a chunk first loaded after the update is no
 * longer there: 0.3.9 → 0.4.0 failed with "Cannot find module
 * …/chunks/restart-RO6DM5N3.js" (2026-10-17). What the restart needs must be
 * loaded when the shell starts, not imported once it exits.
 */
describe('the restart after /update', () => {
  it('is loaded with the shell, not imported after it exits', async () => {
    const launch = await readFile(new URL('../../src/shell/launch.tsx', import.meta.url), 'utf8')
    expect(launch).not.toMatch(/import\(\s*['"]\.\/restart\.js['"]\s*\)/)
    expect(launch).toMatch(/^import \{[^}]*\brelaunch\b[^}]*\} from '\.\/restart\.js'$/m)
  })
})
