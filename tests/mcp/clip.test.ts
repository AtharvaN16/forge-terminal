import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import { afterEach, describe, expect, it } from 'vitest'
import { createForgeServer } from '../../src/mcp/server.js'
import { makeNoiseImage, makeTempDir } from '../helpers/fixtures.js'
import { memoryPasteboard } from '../helpers/pasteboard.js'

let client: Client | undefined

afterEach(async () => {
  await client?.close()
})

async function connect(clip: ReturnType<typeof memoryPasteboard>) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const deps = { pasteboard: clip.pb, root: await makeTempDir(), fallback: await makeTempDir() }
  await createForgeServer({ clip: deps }).connect(serverSide)
  client = new Client({ name: 'forge-test', version: '0' })
  await client.connect(clientSide)
  return client
}

async function call(c: Client, args: Record<string, unknown>) {
  const result = await c.callTool({ name: 'forge_clip', arguments: args })
  const content = result.content as { type: string; text?: string; uri?: string }[]
  return {
    isError: result.isError === true,
    doc: result.structuredContent as Record<string, unknown> & {
      failures: { code: string }[]
    },
    text: content.find((x) => x.type === 'text')?.text ?? '',
    links: content.filter((x) => x.type === 'resource_link').map((x) => x.uri ?? ''),
  }
}

describe('forge_clip', () => {
  it('compresses the copied image and puts it back', async () => {
    const clip = memoryPasteboard()
    await clip.copyImage(await makeNoiseImage(await makeTempDir(), 'held.jpg', 96, 'jpeg'))
    const c = await connect(clip)

    const out = await call(c, { quality: 40 })

    expect(out.isError).toBe(false)
    expect(out.doc).toMatchObject({ ok: true, clipboard: 'placed' })
    expect(out.text).toContain('→ clipboard')
    expect(out.links[0]).toMatch(/Copied%20image\.jpg$/)
    const held = clip.held()
    expect(held?.kind === 'image' && held.format).toBe('jpeg')
  })

  it('converts with to', async () => {
    const clip = memoryPasteboard()
    await clip.copyImage(await makeNoiseImage(await makeTempDir(), 'held.jpg', 96, 'jpeg'))
    const out = await call(await connect(clip), { to: 'webp' })
    expect(out.isError).toBe(false)
    const held = clip.held()
    expect(held?.kind === 'image' && held.format).toBe('webp')
  })

  it('says why when no image is copied', async () => {
    const clip = memoryPasteboard()
    clip.copyText()
    const out = await call(await connect(clip), {})
    expect(out.isError).toBe(true)
    expect(out.doc.failures[0]?.code).toBe('no-clipboard-image')
  })

  it('undo puts the original back', async () => {
    const clip = memoryPasteboard()
    await clip.copyImage(await makeNoiseImage(await makeTempDir(), 'held.jpg', 96, 'jpeg'))
    const c = await connect(clip)
    const original = clip.held()
    await call(c, { quality: 40 })

    const out = await call(c, { undo: true })

    expect(out.isError).toBe(false)
    expect(out.doc).toMatchObject({ ok: true, clipboard: 'restored' })
    const held = clip.held()
    expect(held?.kind === 'image' && held.bytes).toEqual(
      original?.kind === 'image' && original.bytes,
    )
  })
})
