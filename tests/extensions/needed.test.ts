import { afterEach, describe, expect, it } from 'vitest'
import { whisperUseful } from '../../src/engines/transcribe.js'
import { catalogEntry } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { hideUnneeded } from '../../src/extensions/needed.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'

const saved = process.env.FORGE_TRANSCRIBE_HELPER
afterEach(() => {
  if (saved === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
  else process.env.FORGE_TRANSCRIBE_HELPER = saved
})

/** Apple's helper, saying whether its recogniser hears. */
async function apple(speech: boolean) {
  const fake = await fakeTranscribeHelper({
    status: { lines: [{ ok: true, speech, locale: 'en_US', notes: 'off' }] },
  })
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
}

const status = (id: string, installed?: string): ExtensionStatus => {
  const entry = catalogEntry(id)
  if (entry === undefined) throw new Error(`${id} is catalogued`)
  return { entry, updateAvailable: false, supported: true, ...(installed ? { installed } : {}) }
}

describe('whisperUseful', () => {
  it('is always useful off the Mac', async () => {
    await apple(true)
    expect(await whisperUseful('win32')).toBe(true)
    expect(await whisperUseful('linux')).toBe(true)
  })

  it('is not on a Mac whose own recogniser hears, and is on one whose does not', async () => {
    await apple(true)
    expect(await whisperUseful('darwin')).toBe(false)
    await apple(false)
    expect(await whisperUseful('darwin')).toBe(true)
  })
})

describe('hideUnneeded', () => {
  it("leaves whisper out where Apple's recogniser hears, unless it is installed", async () => {
    if (process.platform !== 'darwin') return
    await apple(true)
    const ids = async (list: ExtensionStatus[]) => (await hideUnneeded(list)).map((s) => s.entry.id)
    expect(await ids([status('boost'), status('whisper')])).toEqual(['boost'])
    expect(await ids([status('boost'), status('whisper', '1.0.0')])).toEqual(['boost', 'whisper'])
    await apple(false)
    expect(await ids([status('boost'), status('whisper')])).toEqual(['boost', 'whisper'])
  })
})
