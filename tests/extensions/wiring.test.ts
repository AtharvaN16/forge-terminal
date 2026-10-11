import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/client'
import { InMemoryTransport } from '@modelcontextprotocol/server'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import type { ProbeJson, RunJson } from '../../src/core/report-data.js'
import { createForgeServer } from '../../src/mcp/server.js'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeJpeg, makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'
import { runForge } from '../helpers/run-forge.js'

const fake = fakeExtensions()
let home: string
beforeEach(async () => {
  home = await fake.home()
})
afterEach(() => fake.restore())

const forge = (...argv: string[]) => execute(parseArgs(argv), { json: argv.includes('--json') })

describe('--boost with an installed extension', () => {
  it('writes name-2x.png at twice the size and keeps the alpha', async () => {
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    const src = await makeTransparentPng(dir, 'photo.png')

    const out = await forge(src, '--boost', '--json')
    const doc = JSON.parse(out.stdout[0] ?? '') as RunJson
    expect(out.exitCode).toBe(0)
    expect(doc.results[0]).toMatchObject({ op: 'boost', outputs: [join(dir, 'photo-2x.png')] })

    const meta = await sharp(join(dir, 'photo-2x.png')).metadata()
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([64, 64, true])
  })

  it('flattens alpha only because the chosen target cannot carry it', async () => {
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    const src = await makeTransparentPng(dir, 'logo.png')

    expect((await forge(src, '--boost', '4', '--to', 'jpeg')).exitCode).toBe(0)
    const meta = await sharp(join(dir, 'logo-4x.jpg')).metadata()
    expect([meta.width, meta.hasAlpha]).toEqual([128, false])
  })
  it('names the factor a too-wide source can take, and runs nothing', async () => {
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    // 4x would be 16400 px wide, past the 16384 px limit; 2x fits.
    const src = join(dir, 'banner.png')
    await sharp({ create: { width: 4100, height: 50, channels: 3, background: '#fff' } })
      .png()
      .toFile(src)

    const out = await forge(src, '--boost', '4')
    const said = out.stderr.join('\n')
    expect(out.exitCode).toBe(1)
    expect(said).toContain('banner.png')
    expect(said).toContain('2x is the most it can take')
    expect(said).toContain('--boost 2')
    expect(existsSync(join(dir, 'banner-4x.png'))).toBe(false)
  })
})

describe('--remove-bg', () => {
  it('writes name-cutout.png with transparency', async () => {
    await fake.install(home, 'remove-background')
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'portrait.jpg')

    expect((await forge(src, '--remove-bg')).exitCode).toBe(0)
    const meta = await sharp(join(dir, 'portrait-cutout.png')).metadata()
    expect(meta.hasAlpha).toBe(true)
  })

  it('refuses a target without alpha, before anything runs', async () => {
    await fake.install(home, 'remove-background')
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'portrait.jpg')

    const out = await runForge([src, '--remove-bg', '--to', 'jpeg'])
    expect(out.exitCode).toBe(2)
    expect(out.stderr).toContain('cannot hold transparency')
    expect(existsSync(join(dir, 'portrait-cutout.jpg'))).toBe(false)
  })
})

describe('without the extension', () => {
  it('says how to install it, exits 1, and writes nothing', async () => {
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'photo.jpg')

    const out = await forge(src, '--boost')
    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('forge extensions add boost')
    expect(existsSync(join(dir, 'photo-2x.png'))).toBe(false)
  })

  it('MCP: removeBackground is an extension-missing tool error', async () => {
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'photo.jpg')
    const [c, s] = InMemoryTransport.createLinkedPair()
    await createForgeServer().connect(s)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(c)

    const res = await client.callTool({
      name: 'forge_convert',
      arguments: { paths: [src], to: 'png', removeBackground: true },
    })
    expect(res.isError).toBe(true)
    expect((res.structuredContent as RunJson).failures[0]?.code).toBe('extension-missing')
    await client.close()
  })
})

describe('forge probe', () => {
  it('lists an extension action only while that extension is installed', async () => {
    const dir = await makeTempDir()
    const src = await makeJpeg(dir, 'photo.jpg')
    const actions = async () =>
      (JSON.parse((await forge('probe', src, '--json')).stdout[0] ?? '') as ProbeJson).probes[0]
        ?.actions

    expect(await actions()).not.toContain('boost')
    await fake.install(home, 'boost')
    const after = await actions()
    expect(after).toContain('boost')
    expect(after).not.toContain('remove-background')
  })
})
