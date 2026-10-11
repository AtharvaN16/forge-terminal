import { existsSync } from 'node:fs'
import { cp, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatMatrix, targetIdsFor } from '../../src/core/capabilities.js'
import type { FormatsJson, ProbeJson, RunJson } from '../../src/core/report-data.js'
import { probe } from '../../src/engines/registry.js'
import { createForgeServer } from '../../src/mcp/server.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

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
  it('offers exactly the five tools, annotated', async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'forge_compress',
      'forge_convert',
      'forge_formats',
      'forge_pdf',
      'forge_probe',
    ])
    const byName = new Map(tools.map((t) => [t.name, t]))
    expect(byName.get('forge_probe')?.annotations?.readOnlyHint).toBe(true)
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
