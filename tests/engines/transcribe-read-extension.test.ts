import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isForgeError, readUnavailable } from '../../src/core/errors.js'
import { readRefusal, runRead, transcribeStatus } from '../../src/engines/transcribe.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

/**
 * Where Apple's reader is not (spec 2026-10-23-extract-text-design §6):
 * reading goes to the read-text extension, which answers as the Mac
 * helper's `read` does. Pinned to whisper's helper, so no Apple helper is here.
 */
const saved = process.env.FORGE_TRANSCRIBE_HELPER
const fake = fakeExtensions()

async function noAppleReader() {
  const whisper = await fakeTranscribeHelper(
    { status: { lines: [{ ok: true, speech: true, locale: 'en', notes: 'unsupported' }] } },
    { whisper: true },
  )
  process.env.FORGE_TRANSCRIBE_HELPER = whisper.path
}

afterEach(() => {
  fake.restore()
  if (saved === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
  else process.env.FORGE_TRANSCRIBE_HELPER = saved
})

describe('reading through the read-text extension', () => {
  it('names the extension when it is not installed, where it is offered', async () => {
    await fake.home()
    await noAppleReader()
    const dir = await makeTempDir()
    const png = await makePng(dir, 'shot.png')
    const e = await runRead(png).catch((x: unknown) => x)
    expect(isForgeError(e) && e.code).toBe('read-unavailable')
    expect(isForgeError(e) && e.hint).toBe('Install it with: forge extensions add read-text')
    expect((await transcribeStatus())?.read).toBe(false)
    expect((await readRefusal()).detail).toBe(
      "Reading text needs Forge's free read-text extension.",
    )
  })

  it('reads a picture, once installed, and says so in the status', async () => {
    const home = await fake.home()
    await fake.install(home, 'read-text')
    await noAppleReader()
    const dir = await makeTempDir()
    const png = await makePng(dir, 'shot.png')
    const events: unknown[] = []
    const pages = await runRead(png, { onEvent: (e) => events.push(e) })
    expect(pages).toHaveLength(1)
    expect(JSON.stringify(pages[0])).toContain('page 1 width')
    expect(events).toEqual([{ kind: 'page', page: 1, of: 1 }])
    expect((await transcribeStatus())?.read).toBe(true)
  })

  it("draws each of a PDF's pages and mends their words against its own text", async () => {
    const home = await fake.home()
    await fake.install(home, 'read-text')
    await noAppleReader()
    const dir = await makeTempDir()
    const pdf = join(dir, 'lig.pdf')
    await writeFile(pdf, readFileSync(join(__dirname, '..', 'fixtures', 'text', 'ligatures.pdf')))
    const pages = await runRead(pdf)
    expect(pages).toHaveLength(1)
    const text = JSON.stringify(pages[0])
    // Drawn at 200 dpi: a US Letter page is 1700 px wide.
    expect(text).toContain('width 1700')
    // "waff e" is "waffle" on the page itself.
    expect(text).toContain('waffle')
  })

  it("keeps the Mac's wording where no extension is offered", () => {
    expect(readUnavailable().detail).toBe('Reading text needs macOS 26 or later.')
    expect(readUnavailable(true).shellHint).toBe('Open /extensions to install it.')
  })
})
