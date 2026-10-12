import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatMatrix, targetIdsFor } from '../../src/core/capabilities.js'
import type {
  FormatsJson,
  PaletteJson,
  ProbeJson,
  RunJson,
  ScaleJson,
} from '../../src/core/report-data.js'
import { probe } from '../../src/engines/registry.js'
import { createForgeServer } from '../../src/mcp/server.js'
import {
  makeGradientPng,
  makeJpeg,
  makePdf,
  makeTempDir,
  makeTransparentPng,
} from '../helpers/fixtures.js'

const LOCKED = fileURLToPath(new URL('../fixtures/locked-hunter2.pdf', import.meta.url))

let client: Client

beforeEach(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createForgeServer().connect(serverSide)
  client = new Client({ name: 'forge-test', version: '0' })
  await client.connect(clientSide)
})

afterEach(async () => {
  await client.close()
})

interface ToolOutcome<T> {
  isError: boolean
  doc: T
  text: string
  links: string[]
}

async function call<T = RunJson>(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome<T>> {
  const result = await client.callTool({ name, arguments: args })
  const content = (result.content ?? []) as { type: string; text?: string; uri?: string }[]
  return {
    isError: result.isError === true,
    doc: result.structuredContent as T,
    text: content
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n'),
    links: content.filter((c) => c.type === 'resource_link').map((c) => c.uri ?? ''),
  }
}

describe('the tool list', () => {
  it('offers exactly the seven tools, annotated', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'forge_compress',
      'forge_convert',
      'forge_formats',
      'forge_palette',
      'forge_pdf',
      'forge_probe',
      'forge_scale',
    ])
    const byName = new Map(tools.map((t) => [t.name, t]))
    expect(byName.get('forge_probe')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('forge_palette')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('forge_scale')?.annotations?.readOnlyHint).toBe(true)
    expect(byName.get('forge_convert')?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    })
  })
})

describe('forge_convert', () => {
  it('converts, returns the §3.2 shape and a file:// link per output', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await call('forge_convert', { paths: [jpg], to: 'webp' })
    const webp = join(dir, 'a.webp')
    expect(out.isError).toBe(false)
    expect(out.doc.ok).toBe(true)
    expect(out.doc.results[0]?.outputs).toEqual([webp])
    expect(out.links).toEqual([pathToFileURL(webp).href])
    expect(existsSync(webp)).toBe(true)
  })

  it('never overwrites unless asked: an existing output is a tool error the model can act on', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    await call('forge_convert', { paths: [jpg], to: 'webp' })
    const again = await call('forge_convert', { paths: [jpg], to: 'webp' })
    expect(again.isError).toBe(true)
    expect(again.doc.failures[0]?.code).toBe('output-exists')
    const forced = await call('forge_convert', { paths: [jpg], to: 'webp', overwrite: true })
    expect(forced.isError).toBe(false)
  })

  it('refuses a relative path rather than resolving it against the server cwd', async () => {
    const out = await call('forge_convert', { paths: ['photo.jpg'], to: 'webp' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('absolute')
  })

  it('links a path with spaces and accents as a correctly encoded file:// URI', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'my photo é.jpg')
    const out = await call('forge_convert', { paths: [jpg], to: 'png' })
    const png = join(dir, 'my photo é.png')
    expect(out.doc.results[0]?.outputs).toEqual([png])
    expect(out.links).toEqual([pathToFileURL(png).href])
    expect(out.links[0]).toContain('my%20photo%20%C3%A9.png')
  })

  describe('an encrypted PDF', () => {
    let originalStdin: NodeJS.ReadableStream
    beforeEach(() => {
      originalStdin = process.stdin
    })
    afterEach(() => {
      Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true })
    })

    async function locked(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'forge-mcp-'))
      const path = join(dir, 'locked.pdf')
      await cp(LOCKED, path)
      return path
    }

    it('without a password is refused, and stdin (the protocol) is never read', async () => {
      const explosive = new Readable({
        read() {
          this.destroy(new Error('the MCP server read stdin'))
        },
      })
      // A TTY, so that a prompt would attach readline and trip the read guard.
      Object.assign(explosive, { isTTY: true })
      Object.defineProperty(process, 'stdin', { value: explosive, configurable: true })
      const out = await call('forge_convert', { paths: [await locked()], to: 'png' })
      expect(out.isError).toBe(true)
      expect(out.doc.failures[0]?.code).toBe('encrypted-source')
    })

    it('with the right password renders every page', async () => {
      const path = await locked()
      const out = await call('forge_convert', { paths: [path], to: 'png', password: 'hunter2' })
      expect(out.isError).toBe(false)
      expect(out.doc.results[0]?.outputs).toHaveLength(3)
      expect(out.links).toHaveLength(3)
    })

    it('with a wrong password says so, and never echoes it', async () => {
      const out = await call('forge_convert', {
        paths: [await locked()],
        to: 'png',
        password: 'not-the-password',
      })
      expect(out.isError).toBe(true)
      expect(out.doc.failures[0]?.hint).toContain("didn't open it")
      expect(JSON.stringify(out)).not.toContain('not-the-password')
    })
  })
})

describe('forge_compress', () => {
  it('compresses by quality beside the source', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await call('forge_compress', { paths: [jpg], quality: 40 })
    expect(out.isError).toBe(false)
    expect(out.doc.results[0]?.outputs).toEqual([join(dir, 'a-small.jpg')])
  })

  it('compresses to fit a size', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await call('forge_compress', { paths: [jpg], maxSize: '1mb' })
    expect(out.isError).toBe(false)
  })

  it('wants exactly one of quality or maxSize', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    expect(
      (await call('forge_compress', { paths: [jpg], quality: 40, maxSize: '1mb' })).isError,
    ).toBe(true)
    expect((await call('forge_compress', { paths: [jpg] })).isError).toBe(true)
  })
})

describe('forge_pdf', () => {
  it('splits every page', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 3)
    const out = await call('forge_pdf', {
      op: 'split',
      paths: [pdf],
      split: { mode: 'every-page' },
    })
    expect(out.isError).toBe(false)
    expect(out.doc.results[0]?.outputs).toHaveLength(3)
  })

  it('merges in the order given', async () => {
    const dir = await makeTempDir()
    const a = await makePdf(dir, 'a.pdf', 1)
    const b = await makePdf(dir, 'b.pdf', 2)
    const out = await call('forge_pdf', { op: 'merge', paths: [a, b] })
    expect(out.isError).toBe(false)
    expect(out.doc.results[0]?.sources).toEqual([a, b])
  })

  it('rotates', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 2)
    expect((await call('forge_pdf', { op: 'rotate', paths: [pdf], degrees: 90 })).isError).toBe(
      false,
    )
  })

  it('refuses extract without pages, writing nothing', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 2)
    const before = await readdir(dir)
    const out = await call('forge_pdf', { op: 'extract', paths: [pdf] })
    expect(out.isError).toBe(true)
    expect(out.doc.failures[0]?.code).toBe('invalid-arguments')
    expect(await readdir(dir)).toEqual(before)
  })
})

describe('forge_probe and forge_formats', () => {
  it('probes with the same facts as the CLI', async () => {
    const dir = await makeTempDir()
    const pdf = await makePdf(dir, 'doc.pdf', 3)
    const out = await call<ProbeJson>('forge_probe', { paths: [pdf] })
    expect(out.isError).toBe(false)
    expect(out.doc.probes[0]).toMatchObject({
      pages: 3,
      targets: targetIdsFor(await probe(pdf)),
    })
  })

  it('lists formats from the engines', async () => {
    const out = await call<FormatsJson>('forge_formats', {})
    expect(out.doc.formats).toEqual(formatMatrix())
  })
})

describe('writing tools called in parallel', () => {
  it('never lets two calls overwrite each other without overwrite:true', async () => {
    const dir = await makeTempDir()
    const fromPng = await makeTransparentPng(dir, 'photo.png') // 32×32
    const fromJpeg = await makeJpeg(dir, 'photo.jpg') // 40×20

    const [a, b] = await Promise.all([
      call('forge_convert', { paths: [fromPng], to: 'webp' }),
      call('forge_convert', { paths: [fromJpeg], to: 'webp' }),
    ])

    const winners = [a, b].filter((r) => !r.isError)
    const losers = [a, b].filter((r) => r.isError)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0]?.doc.results).toEqual([])
    expect(losers[0]?.doc.failures[0]?.code).toBe('output-exists')

    // The file on disk is the winner's, not replaced by the loser's.
    const winnerSource = winners[0]?.doc.results[0]?.source
    const { width, height } = await sharp(join(dir, 'photo.webp')).metadata()
    expect(winnerSource === fromPng ? [32, 32] : [40, 20]).toEqual([width, height])
  })

  it('keeps going after a call fails', async () => {
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'photo.jpg')
    const [bad, good] = await Promise.all([
      call('forge_convert', { paths: [join(dir, 'missing.png')], to: 'webp' }),
      call('forge_convert', { paths: [src], to: 'png' }),
    ])
    expect(bad.isError).toBe(true)
    expect(good.isError).toBe(false)
    expect(existsSync(join(dir, 'photo.png'))).toBe(true)
  })
})

describe('colour tools', () => {
  it('forge_scale returns the scale document', async () => {
    const out = await call<ScaleJson>('forge_scale', { colour: '#6579FD' })
    expect(out.isError).toBe(false)
    expect(out.doc.scale.reference).toBe('#6579FD')
    expect(out.doc.scale.steps).toHaveLength(11)
  })

  it('forge_palette returns the palette, and inside a colour its shades', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const out = await call<PaletteJson>('forge_palette', { path: jpg })
    expect(out.isError).toBe(false)
    const first = out.doc.palette.colours[0]?.hex ?? expect.fail('no colours')
    const inner = await call<PaletteJson>('forge_palette', { path: jpg, inside: first })
    expect(inner.doc.palette.inside).toBe(first)
  })

  it('refuses a relative path, as every other tool does', async () => {
    const out = await call('forge_palette', { path: 'photo.jpg' })
    expect(out.isError).toBe(true)
    expect(out.text).toContain('absolute')
  })

  it('palette text gives whole percentages that add up to 100', async () => {
    const dir = await makeTempDir()
    const png = await makeGradientPng(dir, 'g.png', 64)
    const out = await call<PaletteJson>('forge_palette', { path: png })
    const pcts = [...out.text.matchAll(/ (\d+)%/g)].map((m) => Number(m[1]))
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('refusals are errors with a reason, not a malformed document', async () => {
    const dir = await makeTempDir()
    const pdf = await call('forge_palette', { path: await makePdf(dir, 'x.pdf') })
    expect(pdf.isError).toBe(true)
    expect(pdf.text).toContain('not an image')
    expect(pdf.text).toContain('A palette is taken from a photo')
    const bad = await call('forge_scale', { colour: 'blue' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('not a colour')
  })
})
