import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
  'pdf-parse',
]
const SHELL_LIBRARIES = ['ink', 'react']

async function loadedBy(...args: string[]) {
  const run = await modulesLoaded([entry, ...args])
  return { ...run, packages: packagesIn(run.urls) }
}

const loadedExecute = (urls: string[]) => urls.some((u) => u.endsWith('/src/cli/execute.ts'))

describe('a command loads only what it needs', () => {
  it('--version loads no engine library, no part of the shell, and not execute.ts', async () => {
    const { exitCode, stdout, packages, urls } = await loadedBy('--version')
    expect(exitCode).toBe(0)
    expect(stdout.trim()).toBe('0.1.0')
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
    expect(loadedExecute(urls)).toBe(false)
  })

  it('--help loads none of them either', async () => {
    const { exitCode, packages, urls } = await loadedBy('--help')
    expect(exitCode).toBe(0)
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
    expect(loadedExecute(urls)).toBe(false)
  })

  it('a usage error is answered before anything heavy loads', async () => {
    const { exitCode, packages } = await loadedBy('--bogus')
    expect(exitCode).toBe(2)
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES]) {
      expect(packages, name).not.toContain(name)
    }
  })

  it('--formats reads every engine capability without loading a library', async () => {
    // Invariant 2 still holds: the list comes from every registered engine's
    // reads/writes. That data is static, so reading it costs no library.
    const { exitCode, stdout, packages } = await loadedBy('--formats')
    expect(exitCode).toBe(0)
    expect(stdout).toContain('HEIC')
    for (const name of [...ENGINE_LIBRARIES, ...SHELL_LIBRARIES]) {
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
})
