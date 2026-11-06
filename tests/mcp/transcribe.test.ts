import { readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { afterEach, describe, expect, it } from 'vitest'
import { transcriptMarkdown } from '../../src/core/transcribe/markdown.js'
import { pageMarkdown, pageText } from '../../src/core/transcribe/page-text.js'
import { createForgeServer } from '../../src/mcp/server.js'
import { fakeTranscribeHelper } from '../helpers/fake-transcribe.js'
import { fakeYtDlp } from '../helpers/fake-ytdlp.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'
import { pinPlatform } from '../helpers/platform.js'

pinPlatform('darwin')

/** The first bytes of an MP4: what `sniffKind` reads it by. */
const MP4 = Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0])
const RESULT = {
  ok: true,
  locale: 'en_US',
  seconds: 75,
  segments: [
    { start: 0, end: 3, text: 'Hello and welcome.' },
    { start: 70, end: 72, text: 'Now, milk.' },
  ],
}
const NOTES = {
  summary: 'About tea.',
  parts: [
    { start: 0, heading: 'Welcome', points: ['Tea.'], refused: false },
    { start: 70, heading: 'Milk', points: ['Milk.'], refused: false },
  ],
}
const DOC = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'read', 'doc.json'), 'utf8'),
) as { ok: true; pages: Parameters<typeof pageText>[0] }

const savedHelper = process.env.FORGE_TRANSCRIBE_HELPER
let client: Client | undefined
afterEach(async () => {
  await client?.close()
  if (savedHelper === undefined) delete process.env.FORGE_TRANSCRIBE_HELPER
  else process.env.FORGE_TRANSCRIBE_HELPER = savedHelper
})

async function setUp() {
  const fake = await fakeTranscribeHelper({
    status: {
      lines: [{ ok: true, speech: true, read: true, locale: 'en_US', notes: 'available' }],
    },
    probe: { lines: [{ ok: true, seconds: 75, sound: true }] },
    run: {
      lines: [
        { event: 'heard', seconds: 30, of: 75 },
        { event: 'heard', seconds: 70, of: 75 },
        { ...RESULT, notes: NOTES },
      ],
    },
    read: { lines: [DOC] },
    render: { lines: [{ ok: true }], echo: { from: 1, to: 2, prefix: 'docx:' } },
  })
  process.env.FORGE_TRANSCRIBE_HELPER = fake.path
  const dir = await makeTempDir()
  const video = join(dir, 'talk.mp4')
  await writeFile(video, MP4)
  const folder = await makeTempDir()
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createForgeServer({ folder }).connect(serverSide)
  client = new Client({ name: 'forge-test', version: '0' })
  await client.connect(clientSide)
  return { fake, dir, video, folder, client }
}

interface Outcome {
  isError: boolean
  texts: string[]
  links: string[]
}

async function call(
  c: Client,
  name: string,
  args: Record<string, unknown>,
  onprogress?: (p: { progress: number; total?: number; message?: string }) => void,
): Promise<Outcome> {
  const result = await c.callTool({ name, arguments: args }, onprogress ? { onprogress } : {})
  const content = (result.content ?? []) as { type: string; text?: string; uri?: string }[]
  return {
    isError: result.isError === true,
    texts: content.filter((x) => x.type === 'text').map((x) => x.text ?? ''),
    links: content.filter((x) => x.type === 'resource_link').map((x) => x.uri ?? ''),
  }
}

describe('forge_transcribe', () => {
  it('writes the notes and transcript beside the recording, and hands back the text', async () => {
    const { dir, video, client: c } = await setUp()
    const out = await call(c, 'forge_transcribe', { source: video })
    expect(out.isError).toBe(false)
    const md = transcriptMarkdown(
      { seconds: 75, segments: RESULT.segments, notes: NOTES },
      { title: 'talk', from: 'talk.mp4' },
    )
    expect(await readFile(join(dir, 'talk.md'), 'utf8')).toBe(md)
    expect(out.texts[0]).toMatch(/^✓ .*talk\.md {3}1:15 → 5 words · 2 parts$/)
    expect(out.texts).toContain(md)
    expect(out.links).toEqual([expect.stringMatching(/talk\.md$/)])
  })

  it('passes to, detail and language on, and hands back Markdown even for Word', async () => {
    const { fake, dir, video, client: c } = await setUp()
    const out = await call(c, 'forge_transcribe', {
      source: video,
      to: 'notes',
      detail: 'brief',
      language: 'fr-FR',
      format: 'docx',
    })
    expect(out.isError).toBe(false)
    const argv = JSON.parse(await readFile(join(fake.dir, 'argv.json'), 'utf8')) as string[]
    expect(argv.join(' ')).toContain('render')
    expect(out.links).toEqual([expect.stringMatching(/talk\.docx$/)])
    expect(out.texts.some((t) => t.startsWith('# talk'))).toBe(true)
    expect(await readFile(join(dir, 'talk.docx'), 'utf8')).toMatch(/^docx:/)
  })

  it('reports progress as facts when the client asks for it', async () => {
    const { video, client: c } = await setUp()
    const seen: { progress: number; total?: number; message?: string }[] = []
    await call(c, 'forge_transcribe', { source: video }, (p) => seen.push(p))
    expect(seen.map((p) => p.message)).toEqual(['heard 0:30 of 1:15', 'heard 1:10 of 1:15'])
    expect(seen.every((p) => p.total === undefined)).toBe(true)
    expect(seen[1]?.progress ?? 0).toBeGreaterThan(seen[0]?.progress ?? 0)
  })

  it('refuses to replace a file that is there unless overwrite is true', async () => {
    const { dir, video, client: c } = await setUp()
    await writeFile(join(dir, 'talk.md'), 'mine')
    const out = await call(c, 'forge_transcribe', { source: video })
    expect(out.isError).toBe(true)
    expect(out.texts.join('\n')).toMatch(/already/i)
    expect(await readFile(join(dir, 'talk.md'), 'utf8')).toBe('mine')
    const again = await call(c, 'forge_transcribe', { source: video, overwrite: true })
    expect(again.isError).toBe(false)
  })

  it('refuses a relative path', async () => {
    const { client: c } = await setUp()
    const out = await call(c, 'forge_transcribe', { source: 'talk.mp4' })
    expect(out.isError).toBe(true)
    expect(out.texts.join('\n')).toContain('absolute')
  })

  it('reads a picture by its content, as forge transcribe does', async () => {
    const { dir, client: c } = await setUp()
    const png = await makePng(dir, 'shot.png')
    const out = await call(c, 'forge_transcribe', { source: png })
    expect(out.isError).toBe(false)
    expect(out.texts).toContain(pageMarkdown(pageText(DOC.pages)))
  })

  // A fake yt-dlp is a #! script, which Windows cannot start.
  it.skipIf(process.platform === 'win32')(
    'writes a link into the default folder, not wherever the server was started',
    async () => {
      const { folder, client: c } = await setUp()
      await fakeYtDlp({ facts: { title: 'Zoo', uploader: 'jawed', duration: 19, is_live: false } })
      const out = await call(c, 'forge_transcribe', { source: 'https://youtu.be/jNQXAC9IVRw' })
      expect(out.isError).toBe(false)
      expect(await readFile(join(folder, 'Zoo.md'), 'utf8')).toMatch(/^# Zoo/)
    },
  )
})

describe('forge_read_text', () => {
  it("writes a picture's text beside it and hands it back", async () => {
    const { dir, client: c } = await setUp()
    const png = await makePng(dir, 'shot.png')
    const out = await call(c, 'forge_read_text', { path: png })
    expect(out.isError).toBe(false)
    expect(await readFile(join(dir, 'shot.md'), 'utf8')).toBe(pageMarkdown(pageText(DOC.pages)))
    expect(out.texts).toContain(pageMarkdown(pageText(DOC.pages)))
    expect(out.links).toEqual([expect.stringMatching(/shot\.md$/)])
  })

  it('points a recording at forge_transcribe, writing nothing', async () => {
    const { dir, video, client: c } = await setUp()
    const out = await call(c, 'forge_read_text', { path: video })
    expect(out.isError).toBe(true)
    expect(out.texts.join('\n')).toContain('forge_transcribe')
    expect(await readFile(join(dir, 'talk.md'), 'utf8').catch(() => 'none')).toBe('none')
  })
})
