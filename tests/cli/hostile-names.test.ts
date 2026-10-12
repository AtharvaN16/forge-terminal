import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileNotFound } from '../../src/core/errors.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { runForge } from '../helpers/run-forge.js'

/** Sets the terminal's title. A name carrying it must reach the terminal as text. */
const TITLE = '\x1b]0;pwned\x07'

describe('a file whose name carries an escape sequence', () => {
  // NTFS refuses control characters (1–31) in a name, so the file cannot exist on Windows.
  it.skipIf(process.platform === 'win32')(
    'converts, and the report prints the name without the sequence',
    async () => {
      const dir = await makeTempDir()
      const jpg = await makeJpeg(dir, `a${TITLE}.jpg`)
      const run = await runForge([jpg, '--to', 'webp'])
      expect(run.exitCode).toBe(0)
      expect(run.stdout + run.stderr).toContain('a?]0;pwned?')
      expect(run.stdout + run.stderr).not.toContain(TITLE)
    },
  )

  it('is named in an error without the sequence', async () => {
    const dir = await makeTempDir()
    const run = await runForge([join(dir, `missing${TITLE}.jpg`), '--to', 'webp'])
    expect(run.exitCode).not.toBe(0)
    expect(run.stderr).not.toContain(TITLE)
  })

  it('keeps the error prose printable', () => {
    const error = fileNotFound(`/tmp/missing${TITLE}.jpg`)
    expect(error.detail).toBe('missing?]0;pwned?.jpg could not be found.')
  })
})
