import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installBytes, packageRoot } from '../../src/core/install-size.js'

const tree = (files: Record<string, string | number>) => {
  const root = mkdtempSync(join(tmpdir(), 'forge-size-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), typeof body === 'number' ? Buffer.alloc(body) : body)
  }
  return root
}
const pkg = (m: object) => JSON.stringify(m)

describe('installBytes', () => {
  it('counts the shipped files and every dependency once, not what only a checkout holds', async () => {
    const forge = pkg({ name: 'forge-terminal', files: ['dist'], dependencies: { a: '1', b: '1' } })
    const a = pkg({ name: 'a', dependencies: { c: '1' } })
    const b = pkg({ name: 'b', dependencies: { c: '1' }, optionalDependencies: { gone: '1' } })
    const c = pkg({ name: 'c' })
    const root = tree({
      'package.json': forge,
      'dist/cli.js': 100,
      'tests/big.test.ts': 5000,
      'node_modules/a/package.json': a,
      'node_modules/a/index.js': 10,
      'node_modules/b/package.json': b,
      'node_modules/b/index.js': 20,
      'node_modules/c/package.json': c,
      'node_modules/c/index.js': 30,
      'node_modules/vitest/package.json': pkg({ name: 'vitest' }),
      'node_modules/vitest/huge.js': 9000,
    })
    const manifests = [forge, a, b, c].reduce((n, m) => n + m.length, 0)
    expect(await installBytes(root)).toBe(manifests + 100 + 10 + 20 + 30)
  })

  it('finds a nested copy of a dependency before the hoisted one', async () => {
    const forge = pkg({ name: 'forge-terminal', files: [], dependencies: { a: '1' } })
    const a = pkg({ name: 'a', dependencies: { c: '2' } })
    const c2 = pkg({ name: 'c', version: '2' })
    const root = tree({
      'package.json': forge,
      'node_modules/a/package.json': a,
      'node_modules/a/node_modules/c/package.json': c2,
      'node_modules/a/node_modules/c/index.js': 7,
      'node_modules/c/package.json': pkg({ name: 'c', version: '1' }),
      'node_modules/c/index.js': 999,
    })
    expect(await installBytes(root)).toBe(forge.length + a.length + c2.length + 7)
  })

  it('is nothing where there is no package', async () => {
    expect(await installBytes(tree({}))).toBe(0)
  })
})

describe('packageRoot', () => {
  it('is the folder of the forge-terminal package.json, found upwards', async () => {
    const root = tree({ 'package.json': pkg({ name: 'forge-terminal' }), 'dist/core/x.js': 1 })
    expect(await packageRoot(join(root, 'dist', 'core'))).toBe(root)
  })
})
