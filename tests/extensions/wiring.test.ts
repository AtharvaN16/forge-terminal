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

  it('--sharpen writes name-sharp.png at the same size', async () => {
    await fake.install(home, 'boost')
    const dir = await makeTempDir()
    const src = await makeTransparentPng(dir, 'photo.png')

    const out = await forge(src, '--sharpen', '--json')
    const doc = JSON.parse(out.stdout[0] ?? '') as RunJson
    expect(out.exitCode).toBe(0)
    expect(doc.results[0]).toMatchObject({ op: 'boost', outputs: [join(dir, 'photo-sharp.png')] })
    const meta = await sharp(join(dir, 'photo-sharp.png')).metadata()
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([32, 32, true])
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

  it('--boost 3 writes name-3x.png at three times the size with boost 1.1.0', async () => {
    await fake.install(home, 'boost', '1.1.0')
    const dir = await makeTempDir()
    const src = await makeTransparentPng(dir, 'photo.png')

    const out = await forge(src, '--boost', '3', '--json')
    const doc = JSON.parse(out.stdout[0] ?? '') as RunJson
    expect(out.exitCode).toBe(0)
    expect(doc.results[0]).toMatchObject({ op: 'boost', outputs: [join(dir, 'photo-3x.png')] })
    const meta = await sharp(join(dir, 'photo-3x.png')).metadata()
    expect([meta.width, meta.height]).toEqual([96, 96])
  })

  it('--boost 3 on boost 1.0.0, with no release that makes 3x, says so once and points at 2 or 4', async () => {
    // The real catalogue: until boost 1.1.0 is released, "update it" would
    // change nothing (the add command finds 1.0.0 already installed).
    await fake.install(home, 'boost', '1.0.0')
    const dir = await makeTempDir()
    const a = await makeTransparentPng(dir, 'one.png')
    const b = await makeTransparentPng(dir, 'two.png')

    const out = await forge(a, b, '--boost', '3', '--json')
    expect(out.exitCode).toBe(2) // invalid-arguments: the command's own fault, as --boost 5 is
    const doc = JSON.parse(out.stdout[0] ?? '') as RunJson
    const said = JSON.stringify(doc)
    expect(doc.failures).toHaveLength(1)
    expect(said).toContain('No released boost makes 3× yet.')
    expect(said).toContain('Try --boost 2 or --boost 4.')
    expect(said).not.toContain('forge extensions add boost')
    expect(existsSync(join(dir, 'one-3x.png'))).toBe(false)
  })

  it('names 3x as the factor that fits only when the installed boost makes 3x', async () => {
    const dir = await makeTempDir()
    // 5000 px wide: 4x would be 20,000 px; 3x is 15,000, 2x is 10,000.
    const src = join(dir, 'wide.png')
    await sharp({ create: { width: 5000, height: 50, channels: 3, background: '#fff' } })
      .png()
      .toFile(src)

    await fake.install(home, 'boost', '1.1.0')
    expect((await forge(src, '--boost', '4')).stderr.join('\n')).toContain(
      '3x is the most it can take',
    )
    await fake.install(home, 'boost', '1.0.0')
    expect((await forge(src, '--boost', '4')).stderr.join('\n')).toContain(
      '2x is the most it can take',
    )
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
