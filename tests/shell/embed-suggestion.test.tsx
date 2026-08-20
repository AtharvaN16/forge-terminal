import { readdir } from 'node:fs/promises'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { encryptedSource } from '../../src/core/errors.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('the encrypted-file refusal', () => {
  it('names the command that can actually do it', () => {
    const error = encryptedSource('/tmp/scan.pdf')
    expect(`${error.detail} ${error.hint ?? ''}`).toContain('--password-stdin')
  })

  it('names the file so the command can be copied', () => {
    const error = encryptedSource('/tmp/scan.pdf')
    expect(`${error.detail} ${error.hint ?? ''}`).toContain('scan.pdf')
  })
})

const ENTER = String.fromCharCode(13)
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * Drops `file`, converts it to PDF, and accepts every default the wizard
 * offers (destination, then name), landing on the result screen.
 *
 * `targetIdsFor` puts PDF last in a JPEG's target list — png, webp, avif,
 * gif, tiff, pdf (heic is absent: `image.ts`'s `WRITES` cannot encode it) —
 * so five downs, not one, is what actually lands the cursor on it. Mirrors
 * `compress-flow.test.tsx`'s `toCompress`/`finish` pair, one flow later.
 */
async function toPdf(stdin: { write: (s: string) => void }, file: string) {
  stdin.write(file)
  await settle()
  stdin.write(ENTER) // stage the file -> target picker
  await settle(300)
  stdin.write(DOWN + DOWN + DOWN + DOWN + DOWN) // png, webp, avif, gif, tiff, pdf
  await settle()
  stdin.write(ENTER) // choose PDF -> destination (PDF isn't lossy: no quality step)
  await settle()
  stdin.write(ENTER) // accept the default destination -> name step
  await settle()
  stdin.write(ENTER) // accept the proposed name -> runs the conversion
  await settle(1200)
}

/** Back at idle, from the result screen, without discarding anything else. */
async function convertAnother(stdin: { write: (s: string) => void }) {
  stdin.write(ENTER)
  await settle(300)
}

describe('the merge offer', () => {
  it('says nothing after converting just one image to PDF', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    await toPdf(stdin, a)

    // The conversion itself really did succeed — otherwise the negative
    // assertion below would pass for the wrong reason (nothing to offer a
    // merge for because nothing was written at all).
    expect((await readdir(dir)).filter((f) => f.endsWith('.pdf'))).toHaveLength(1)

    const frame = lastFrame() ?? ''
    expect(frame).not.toContain('could become one')
  }, 20_000)

  it('offers to merge them once a second image also becomes a PDF', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    const { stdin, lastFrame } = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    await toPdf(stdin, a)
    await convertAnother(stdin)
    await toPdf(stdin, b)

    const frame = lastFrame() ?? ''
    // Counts what actually happened this session, not a fixed word like
    // "some" — two conversions, so the offer names two.
    expect(frame).toContain('2 PDFs from this session could become one')
    expect(frame).toContain('/pdf')
  }, 30_000)

  it('does not perform the merge on its own', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    const { stdin } = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    await toPdf(stdin, a)
    await convertAnother(stdin)
    await toPdf(stdin, b)

    // Exactly the two one-page PDFs the two conversions wrote — offering a
    // merge is not the same as running one. A third, already-combined file
    // would mean the offer silently acted on its own.
    const pdfs = (await readdir(dir)).filter((f) => f.endsWith('.pdf'))
    expect(pdfs.sort()).toEqual(['a.pdf', 'b.pdf'])
  }, 30_000)
})
