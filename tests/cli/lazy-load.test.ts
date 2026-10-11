import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fakeExtensions } from '../helpers/fake-extension.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'
import { modulesLoaded, packagesIn } from '../helpers/load-log.js'

/**
 * Spec §4.2 and §7. A command pays only for the libraries it uses. These run
 * the real entrypoint through a module-load hook, so a stray static import
 * fails here instead of quietly costing every command 100 ms.
 */
const entry = join(process.cwd(), 'src', 'index.ts')

const ENGINE_LIBRARIES = [
  'sharp',
  'pdf-lib',
  '@hyzyla/pdfium',
  'mammoth',
  'word-extractor',
  'docx',
  'adm-zip',
  'cfb',
]
const SHELL_LIBRARIES = ['ink', 'react']
// Only `forge mcp` may load these (spec §3.5).
const MCP_LIBRARIES = ['@modelcontextprotocol/server', 'zod']

async function loadedBy(...args: string[]) {
  const run = await modulesLoaded([entry, ...args])
  return { ...run, packages: packagesIn(run.urls) }
}

const loadedExtensions = (urls: string[]) => urls.some((u) => u.includes('/src/extensions/'))
const loadedExecute = (urls: string[]) => urls.some((u) => u.endsWith('/src/cli/execute.ts'))

describe('a command loads only what it needs', () => {
  it('--version loads no engine library, no part of the shell, and not execute.ts', async () => {
    const { exitCode, stdout, packages, urls } = await loadedBy('--version')
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe('0.1.0')
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES, ...MCP_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
    expect(loadedExecute(urls)).toBe(false)
    expect(loadedExtensions(urls)).toBe(false)
  })

  it('--help loads none of them either', async () => {
    const { exitCode, packages, urls } = await loadedBy('--help')
    expect(exitCode).toBe(0)
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES, ...MCP_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
    expect(loadedExecute(urls)).toBe(false)
  })

  it('a usage error is answered before anything heavy loads', async () => {
    const { exitCode, packages } = await loadedBy('--bogus')
    expect(exitCode).toBe(2)
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES, ...MCP_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
  })

  it('--formats reads every engine capability without loading a library', async () => {
    // Invariant 2 still holds: the list comes from every registered engine's
    // reads/writes. That data is static, so reading it costs no library.
    const { exitCode, stdout, packages } = await loadedBy('--formats')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('HEIC')
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES, ...MCP_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
  })

  it('an image conversion loads sharp and no other engine library', async () => {
    const dir = await makeTempDir()
    const jpeg = await makeJpeg(dir, 'a.jpg')
    const { exitCode, packages } = await loadedBy(jpeg, '--to', 'webp')
    expect(exitCode).toBe(0)
    expect(packages).toContain('sharp')
    for (const name of ENGINE_LIBRARIES.filter((n) => n !== 'sharp')) {
      expect(packages, name).not.toContain(name)
    }
    for (const name of SHELL_LIBRARIES) expect(packages, name).not.toContain(name)
  })

  it('a plain conversion never loads src/extensions', async () => {
    const dir = await makeTempDir()
    const jpeg = await makeJpeg(dir, 'a.jpg')
    const { exitCode, urls } = await loadedBy(jpeg, '--to', 'png')
    expect(exitCode).toBe(0)
    expect(loadedExtensions(urls)).toBe(false)
  })

  it('--boost loads src/extensions, but never ONNX Runtime into the Forge process', async () => {
    const fake = fakeExtensions()
    const home = await fake.home()
    try {
      await fake.install(home, 'boost')
      const dir = await makeTempDir()
      const jpeg = await makeJpeg(dir, 'a.jpg')
      const run = await modulesLoaded([entry, jpeg, '--boost'], { env: { XDG_CONFIG_HOME: home } })
      expect(run.exitCode).toBe(0)
      expect(loadedExtensions(run.urls)).toBe(true)
      const names = [...packagesIn(run.urls)]
      expect(names.filter((n) => n.startsWith('onnxruntime'))).toEqual([])
    } finally {
      fake.restore()
    }
  })
})
