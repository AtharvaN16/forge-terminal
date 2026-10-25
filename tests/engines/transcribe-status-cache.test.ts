import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appleDoes, renderPages, runRead, transcribeStatus } from '../../src/engines/transcribe.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { makeTempDir } from '../helpers/fixtures.js'

/**
 * Apple's helper's `status` was spawned by every step that wanted to know
 * what the Mac can do — the status, the reader, the renderer — about three
 * times a run. It is asked once per locale now; only `transcribeStatus`
 * asks afresh, since whether notes are ready can change while Forge runs.
 */
const saved = process.env.FORGE_TRANSCRIBE_HELPER
afterEach(() => {
  if (saved === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
  else process.env.FORGE_TRANSCRIBE_HELPER = saved
})

const READS = {
  lines: [{ ok: true, speech: true, locale: 'en_US', notes: 'off', read: true }],
}

async function helper(answers: Parameters<typeof fakeTranscribeHelper>[0]) {
  const fake = await fakeTranscribeHelper(answers)
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  const log = join(fake.dir, 'calls.log')
  const statuses = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .filter((l) => JSON.parse(l)[0] === 'status')
      : []
  return { ...fake, statuses }
}

describe("Apple's helper's status", () => {
  it('is asked once, however many steps want it', async () => {
    const fake = await helper({ status: READS })
    await appleDoes('darwin')
    await appleDoes('darwin')
    await Promise.all([appleDoes('darwin'), appleDoes('darwin')])
    expect(fake.statuses()).toHaveLength(1)
  })

  it('is asked once for a picture read and set as a PDF: the reader and renderer share it', async () => {
    const fake = await helper({
      status: READS,
      read: { lines: [{ ok: true, pages: [] }] },
      render: { lines: [{ ok: true }], echo: { from: 1, to: 2, prefix: 'pdf:' } },
    })
    const picture = join(await makeTempDir(), 'a.png')
    await writeFile(picture, 'x')
    await runRead(picture)
    const bytes = await renderPages([], 'pdf', 'a.png')
    // Set by the helper, so the renderer did find it there.
    expect(bytes.toString('utf8').startsWith('pdf:')).toBe(true)
    expect(fake.statuses()).toHaveLength(1)
  })

  it('is asked again by transcribeStatus, which says whether notes are ready yet', async () => {
    const fake = await helper({ status: READS })
    await appleDoes('darwin')
    await transcribeStatus()
    expect(fake.statuses()).toHaveLength(2)
    // And what it learnt is what the other steps use from then on.
    await appleDoes('darwin')
    expect(fake.statuses()).toHaveLength(2)
  })

  it('is asked once per locale', async () => {
    const fake = await helper({ status: READS })
    await transcribeStatus({ locale: 'fr_FR' })
    await transcribeStatus({ locale: 'fr_FR' })
    await appleDoes('darwin')
    await appleDoes('darwin')
    const asked = fake.statuses().map((l) => JSON.parse(l))
    expect(asked).toEqual([
      ['status', '--locale', 'fr_FR'],
      ['status', '--locale', 'fr_FR'],
      ['status'],
    ])
  })

  it('is not asked again once it could not answer: a helper that cannot start never will', async () => {
    const fake = await helper({
      status: { lines: [{ ok: false, code: 'crash', message: 'dyld' }], exit: 1 },
    })
    expect(await appleDoes('darwin')).toEqual({ hears: false, reads: false })
    await appleDoes('darwin')
    expect(fake.statuses()).toHaveLength(1)
  })
})
