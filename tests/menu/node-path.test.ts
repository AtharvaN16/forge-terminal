import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stableNode } from '../../src/menu/node-path.js'

/** A Cellar-style versioned Node, and a bin folder linking `node` to it, as Homebrew lays it out. */
function homebrew() {
  const root = mkdtempSync(join(tmpdir(), 'forge-node-'))
  const cellar = join(root, 'Cellar', 'node', '26.8.1', 'bin')
  const bin = join(root, 'bin')
  mkdirSync(cellar, { recursive: true })
  mkdirSync(bin)
  const real = join(cellar, 'node')
  writeFileSync(real, '')
  symlinkSync(real, join(bin, 'node'))
  return { real, link: join(bin, 'node'), bin, root }
}

// Symlinks need admin rights or Developer Mode on Windows; Homebrew's layout is a Mac one.
describe.skipIf(process.platform === 'win32')('stableNode', () => {
  it('prefers the PATH link to the versioned file, which an upgrade deletes', () => {
    const { real, link, bin } = homebrew()
    expect(stableNode(real, ['/usr/bin', bin].join(delimiter), 'darwin')).toBe(link)
  })

  it('skips a node on PATH that is a different Node', () => {
    const { real, root } = homebrew()
    const other = join(root, 'other')
    mkdirSync(other)
    writeFileSync(join(other, 'node'), '')
    expect(stableNode(real, other, 'darwin')).toBe(real)
  })

  it('keeps the path it was given when PATH has nothing better', () => {
    expect(stableNode('/opt/node/bin/node', undefined, 'darwin')).toBe('/opt/node/bin/node')
  })
})
