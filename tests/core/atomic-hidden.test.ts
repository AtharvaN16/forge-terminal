// tests/core/atomic-hidden.test.ts
//
// iCloud Drive (Desktop & Documents) marks a file whose name starts with a dot
// hidden a few seconds after it appears, and a rename keeps the mark. Forge's
// temp files are dot-named, so a long encode came out hidden: faded in Finder
// and missing from the desktop. Real filesystem, so its own file
// (tests/core/atomic.test.ts mocks node:fs/promises).
import { execFile } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { renameAtomic } from '../../src/core/atomic.js'
import { makeTempDir } from '../helpers/fixtures.js'

const run = promisify(execFile)
const flagsOf = async (path: string) => (await run('/bin/ls', ['-lO', path])).stdout

describe.skipIf(process.platform !== 'darwin')('renameAtomic on a Mac', () => {
  it('clears the hidden mark a synced folder put on the temp file', async () => {
    const dir = await makeTempDir()
    const temp = join(dir, '.forge-abc123-clip.mov')
    const out = join(dir, 'clip.mov')
    await writeFile(temp, 'x')
    await run('/usr/bin/chflags', ['hidden', temp])
    expect(await flagsOf(temp)).toContain('hidden')

    await renameAtomic(temp, out)

    expect(await flagsOf(out)).not.toContain('hidden')
  })
})
