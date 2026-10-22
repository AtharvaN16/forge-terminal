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
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

type Shell = { stdin: { write: (s: string) => void }; lastFrame: () => string | undefined }

/**
 * Waits until the frame shows `text`, then a beat more for the screen's keys
 * to be listened for — the same walk as app-convert.test.tsx's, for the same
 * reason: on a busy machine a fixed pause can send a key to the wrong screen.
 */
async function until(lastFrame: Shell['lastFrame'], text: string | RegExp, ms = 15_000) {
  const plain = () => (lastFrame() ?? '').replace(SGR, '')
  const shown = () => (typeof text === 'string' ? plain().includes(text) : text.test(plain()))
  const start = Date.now()
  while (!shown() && Date.now() - start < ms) await settle(30)
  if (!shown()) throw new Error(`never showed ${String(text)}:\n${plain()}`)
  await settle(100)
}

const prefsFor = (dir: string) => ({
  ...DEFAULT_PREFERENCES,
  theme: 'dark' as const,
  defaultOutput: dir,
})

/**
 * Drops `file`, converts it to PDF, and accepts every default the wizard
 * offers (Save as's name and folder), landing on the result screen.
 *
 * `targetIdsFor` puts PDF last in a JPEG's target list — png, webp, avif,
 * gif, tiff, pdf (heic is absent: `image.ts`'s `WRITES` cannot encode it) —
 * so five downs, not one, is what actually lands the cursor on it. Mirrors
 * `compress-flow.test.tsx`'s `toCompress`/`finish` pair, one flow later.
 */
async function toPdf({ stdin, lastFrame }: Shell, file: string) {
  stdin.write(file)
  await settle()
  stdin.write(ENTER) // stage the file -> target picker
  await until(lastFrame, 'Convert to')
  stdin.write(DOWN + DOWN + DOWN + DOWN + DOWN) // png, webp, avif, gif, tiff, pdf
  await until(lastFrame, /▌ PDF/)
  stdin.write(ENTER) // choose PDF -> Save as (PDF isn't lossy: no quality step)
  await until(lastFrame, 'Save as')
  stdin.write(ENTER) // Save as: the proposed name, in the default folder -> runs the conversion
  await until(lastFrame, '↵ Home')
}

/** Back at idle, from the result screen, without discarding anything else. */
async function convertAnother({ stdin, lastFrame }: Shell) {
  stdin.write(ENTER)
  await until(lastFrame, /drop a file/i)
}

describe('the merge offer', () => {
  it('says nothing after converting just one image to PDF', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    await toPdf(app, a)

    // The conversion itself really did succeed — otherwise the negative
    // assertion below would pass for the wrong reason (nothing to offer a
    // merge for because nothing was written at all).
    expect((await readdir(dir)).filter((f) => f.endsWith('.pdf'))).toHaveLength(1)

    const frame = app.lastFrame() ?? ''
    expect(frame).not.toContain('could become one')
  }, 20_000)

  it('offers to merge them once a second image also becomes a PDF', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    await toPdf(app, a)
    await convertAnother(app)
    await toPdf(app, b)

    const frame = app.lastFrame() ?? ''
    // Counts what actually happened this session, not a fixed word like
    // "some" — two conversions, so the offer names two.
    expect(frame).toContain('2 PDFs from this session could become one')
    expect(frame).toContain('/pdf')
  }, 30_000)

  it('does not perform the merge on its own', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    const app = render(<App initialWidth={100} prefs={prefsFor(dir)} />)

    await toPdf(app, a)
    await convertAnother(app)
    await toPdf(app, b)

    // Exactly the two one-page PDFs the two conversions wrote — offering a
    // merge is not the same as running one. A third, already-combined file
    // would mean the offer silently acted on its own.
    const pdfs = (await readdir(dir)).filter((f) => f.endsWith('.pdf'))
    expect(pdfs.sort()).toEqual(['a.pdf', 'b.pdf'])
  }, 30_000)
})
