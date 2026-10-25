import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CATALOG } from '../../src/extensions/catalog.js'
import type { ExtensionStatus } from '../../src/extensions/manager.js'
import { loadCredits } from '../../src/shell/about-credits.js'
import { extensionCredits } from '../../src/shell/flows/extensions.js'

const boost = CATALOG.find((e) => e.id === 'boost')
if (!boost) throw new Error('no boost in the catalogue')
const status = (installed?: string): ExtensionStatus => ({
  entry: boost,
  updateAvailable: false,
  supported: true,
  ...(installed ? { installed } : {}),
})

async function bundle(withFile: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'forge-about-'))
  await mkdir(join(root, 'dist', 'chunks'), { recursive: true })
  if (withFile)
    await writeFile(join(root, 'dist', 'third-party-licenses.txt'), 'jszip@3.10.1 — MIT\n\ntext\n')
  return { root, chunk: pathToFileURL(join(root, 'dist', 'chunks', 'about.js')).href }
}

describe('loadCredits', () => {
  it('finds the licence file beside the bundle, a folder up from its chunks', async () => {
    const { root, chunk } = await bundle(true)
    const got = await loadCredits({ from: chunk, list: async () => [] })
    expect(got.file).toBe(join(root, 'dist', 'third-party-licenses.txt'))
    const others = got.sections.find((s) => s.title === 'Others')
    expect(others?.credits.map((c) => c.name)).toContain('jszip')
  })

  it('offers no file when the build wrote none', async () => {
    const { chunk } = await bundle(false)
    const got = await loadCredits({ from: chunk, list: async () => [] })
    expect(got.file).toBeUndefined()
  })

  it('credits only the extensions that are installed, under what they do', async () => {
    const { chunk } = await bundle(true)
    const none = await loadCredits({ from: chunk, list: async () => [status()] })
    expect(none.sections.map((s) => s.title)).not.toContain('Extensions')
    const some = await loadCredits({ from: chunk, list: async () => [status('1.0.0')] })
    const ext = some.sections.find((s) => s.title === 'Extensions')
    expect(ext?.credits).toContainEqual({
      name: 'ONNX Runtime',
      licence: 'MIT',
      does: 'Boost resolution',
    })
  })
})

describe('extensionCredits', () => {
  it('credits Remove background with what it is on each OS: Apple Vision on a Mac, BiRefNet-lite elsewhere', () => {
    const cutout = CATALOG.find((e) => e.id === 'remove-background')
    if (!cutout) throw new Error('no remove-background in the catalogue')
    const names = (os: NodeJS.Platform) => extensionCredits(cutout, os).map((c) => c.name)
    expect(names('darwin')).toContain('Apple Vision')
    for (const os of ['win32', 'linux'] as const) {
      expect(extensionCredits(cutout, os)).toEqual([
        { name: 'BiRefNet-lite', licence: 'MIT', does: 'Remove background' },
        { name: 'ONNX Runtime', licence: 'MIT', does: 'Remove background' },
      ])
    }
  })
})
