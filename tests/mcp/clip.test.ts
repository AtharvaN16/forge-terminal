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

describe('colour tools: the card, and onto the clipboard', () => {
  async function colour(c: Client, name: string, args: Record<string, unknown>) {
    const result = await c.callTool({ name, arguments: args })
    const content = result.content as { type: string; text?: string }[]
    return {
      isError: result.isError === true,
      doc: result.structuredContent as Record<string, unknown> | undefined,
      texts: content.filter((x) => x.type === 'text').map((x) => x.text ?? ''),
    }
  }
  const heldText = (clip: ReturnType<typeof memoryPasteboard>) => {
    const h = clip.held()
    return h?.kind === 'text' ? h : undefined
  }

  it('svg: true gives the card a person gets with c, and still the numbers', async () => {
    const clip = memoryPasteboard()
    const c = await connect(clip)
    const scale = await colour(c, 'forge_scale', { colour: '#6579FD', svg: true })
    expect(scale.isError).toBe(false)
    expect(scale.texts.some((t) => t.startsWith('<svg'))).toBe(true)
    expect(scale.doc).toMatchObject({ ok: true, scale: { reference: '#6579FD' } })
    const jpg = await makeNoiseImage(await makeTempDir(), 'a.jpg', 64, 'jpeg')
    const palette = await colour(c, 'forge_palette', { path: jpg, svg: true })
    expect(palette.texts.some((t) => t.startsWith('<svg') && t.includes('>a.jpg</text>'))).toBe(
      true,
    )
    expect(palette.doc).toMatchObject({ ok: true })
    expect(clip.held()).toBeNull()
  })

  it('copy: true puts the card on the clipboard as plain text and says to paste it', async () => {
    const clip = memoryPasteboard()
    const c = await connect(clip)
    const out = await colour(c, 'forge_card', {
      title: 'Cream blue',
      colours: [
        { name: 'bg', colour: '#f8f1e6' },
        { name: 'blue-600', colour: '#1c50b5' },
      ],
      copy: true,
    })
    expect(out.isError).toBe(false)
    expect(heldText(clip)?.text).toMatch(/^<svg[\s\S]*>Cream blue<\/text>/)
    expect(heldText(clip)?.html ?? '').toBe('')
    expect(out.texts.join('\n')).toMatch(/copied/i)
    expect(out.texts.join('\n')).toContain('Figma')
    // The card is on the clipboard; the agent is not handed it again unless it asks.
    expect(out.texts.some((t) => t.startsWith('<svg'))).toBe(false)
  })

  it('copy: true on scale and palette copies their cards; inside copies the shades', async () => {
    const clip = memoryPasteboard()
    const c = await connect(clip)
    const scale = await colour(c, 'forge_scale', { colour: '#6579FD', copy: true })
    expect(scale.isError).toBe(false)
    expect(heldText(clip)?.text).toContain('<g id="blue-500"')
    expect(scale.doc).toMatchObject({ ok: true })

    const jpg = await makeNoiseImage(await makeTempDir(), 'a.jpg', 64, 'jpeg')
    const first = await colour(c, 'forge_palette', { path: jpg })
    const hex = (first.doc as { palette: { colours: { hex: string }[] } }).palette.colours[0]?.hex
    const inner = await colour(c, 'forge_palette', { path: jpg, inside: hex, copy: true })
    expect(inner.isError).toBe(false)
    expect(heldText(clip)?.text).toContain(`of ${hex}`)
  })

  it('copy and svg together: copied, and the card handed back too', async () => {
    const clip = memoryPasteboard()
    const c = await connect(clip)
    const out = await colour(c, 'forge_scale', { colour: '#6579FD', copy: true, svg: true })
    expect(out.texts.some((t) => t.startsWith('<svg'))).toBe(true)
    expect(heldText(clip)?.text?.startsWith('<svg')).toBe(true)
  })

  it('a clipboard that will not take the card is an error that says so', async () => {
    const clip = memoryPasteboard()
    clip.pb.writeText = async () => {
      throw new Error('pbcopy went away')
    }
    const c = await connect(clip)
    const out = await colour(c, 'forge_scale', { colour: '#6579FD', copy: true })
    expect(out.isError).toBe(true)
    expect(out.texts.join('\n')).toMatch(/clipboard/i)
  })
})
