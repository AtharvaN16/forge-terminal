import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeDocx, makeTempDir } from '../helpers/fixtures.js'

/**
 * Regression: `execute()`'s rasterisation split (`cli/execute.ts`) used to
 * gate on `kind === 'document'` alone, the same bug `convert.ts` had before
 * it was fixed. A docx/doc source has no pages for pdfium to rasterise, so
 * routing it there crashed with an uncaught "requires at least one selected
 * page" instead of the clean refusal `buildPlan` already produces for any
 * source/target pair the capability graph does not support.
 */
describe('a document source that cannot rasterise', () => {
  it('refuses cleanly rather than crashing when targeting an image format', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['Some text.'])

    const result = await execute(parseArgs([path, '--to', 'jpeg']))

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.join('\n')).toContain("Can't convert")
    expect(result.stderr.join('\n')).not.toContain('at Object.')
    expect(result.stderr.join('\n')).not.toContain('rasterOutputPaths')
  })

  it('still converts a docx to pdf through the same code path', async () => {
    const dir = await makeTempDir()
    const path = await makeDocx(dir, 'report.docx', ['Some text.'])

    const result = await execute(parseArgs([path, '--to', 'pdf']))

    expect(result.exitCode).toBe(0)
  })
})
