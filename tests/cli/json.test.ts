import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute, renderRun, runIntent } from '../../src/cli/execute.js'
import type { ConfigJson, FormatsJson, RunJson } from '../../src/core/report-data.js'
import { displayPath } from '../../src/utils/display-path.js'
import { makeJpeg, makePdf, makeTempDir } from '../helpers/fixtures.js'

/** Runs argv with --json and returns the one document stdout carries. */
async function jsonOf(argv: string[]): Promise<{ exitCode: number; doc: unknown }> {
  const out = await execute(parseArgs([...argv, '--json']), { json: true })
  expect(out.stdout).toHaveLength(1)
  expect(out.stderr).toEqual([])
  return { exitCode: out.exitCode, doc: JSON.parse(out.stdout[0] ?? '') as unknown }
}

/** The §3.2 run shape, checked key by key so a stray field fails here. */
function assertRunShape(doc: unknown): asserts doc is RunJson {
  const d = doc as RunJson
  expect(typeof d.forge).toBe('string')
  expect(typeof d.ok).toBe('boolean')
  expect(Object.keys(d).sort()).toEqual(['failures', 'forge', 'ok', 'results'])
  for (const r of d.results) {
    expect(Object.keys(r).sort()).toEqual([
      'inputBytes',
      'op',
      'outputBytes',
      'outputs',
      'source',
      'sources',
      'warnings',
    ])
    expect(isAbsolute(r.source)).toBe(true)
    for (const o of r.outputs) expect(isAbsolute(o)).toBe(true)
    for (const w of r.warnings) expect(Object.keys(w).sort()).toEqual(['code', 'message'])
  }
  for (const f of d.failures) {
    for (const key of Object.keys(f)) {
      expect(['path', 'code', 'title', 'detail', 'hint']).toContain(key)
    }
    if (f.path !== undefined) expect(isAbsolute(f.path)).toBe(true)
  }
}

describe('--json for conversions', () => {
  it('reports one conversion with absolute paths', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const { exitCode, doc } = await jsonOf([jpg, '--to', 'webp'])
    assertRunShape(doc)
    expect(exitCode).toBe(0)
    expect(doc.ok).toBe(true)
    expect(doc.results[0]?.outputs).toEqual([join(dir, 'a.webp')])
    expect(existsSync(join(dir, 'a.webp'))).toBe(true)
  })

  it('lists every output of a batch', async () => {
    const dir = await makeTempDir()
    for (let i = 0; i < 3; i++) await makeJpeg(dir, `f${i}.jpg`)
    const { doc } = await jsonOf([dir, '--to', 'webp'])
    assertRunShape(doc)
    expect(doc.results.flatMap((r) => r.outputs).sort()).toEqual(
      [0, 1, 2].map((i) => join(dir, `f${i}.webp`)),
    )
  })

  it('reports a partly refused batch: exit 1, ok false, both halves present', async () => {
    const dir = await makeTempDir()
    const a = await makeJpeg(dir, 'a.jpg')
    const b = await makeJpeg(dir, 'b.jpg')
    await writeFile(join(dir, 'b.webp'), 'already here')
    const { exitCode, doc } = await jsonOf([a, b, '--to', 'webp'])
    assertRunShape(doc)
    expect(exitCode).toBe(1)
    expect(doc.ok).toBe(false)
    expect(doc.results.map((r) => r.source)).toEqual([a])
    expect(doc.failures).toEqual([expect.objectContaining({ path: b, code: 'output-exists' })])
  })

  it('keeps spaces and non-ASCII characters in paths exactly', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'my photo é.jpg')
    const { doc } = await jsonOf([jpg, '--to', 'webp'])
    assertRunShape(doc)
    expect(doc.results[0]?.source).toBe(jpg)
    expect(doc.results[0]?.outputs).toEqual([join(dir, 'my photo é.webp')])
  })

  it('reports a page operation that does not fit as a failure, exit 1', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const pdf = await makePdf(dir, 'b.pdf', 2)
    const { exitCode, doc } = await jsonOf([jpg, pdf, '--merge'])
    assertRunShape(doc)
    expect(exitCode).toBe(1)
    expect(doc.failures[0]?.code).toBe('unsupported-operation')
  })
})

describe('--json for the other commands', () => {
  const savedXdg = process.env.XDG_CONFIG_HOME
  let dir: string
  beforeEach(async () => {
    dir = await makeTempDir()
    process.env.XDG_CONFIG_HOME = dir
  })
  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
  })

  it('--formats --json returns the capability matrix', async () => {
    const { exitCode, doc } = await jsonOf(['--formats'])
    const d = doc as FormatsJson
    expect(exitCode).toBe(0)
    expect(d.ok).toBe(true)
    expect(d.formats.find((f) => f.id === 'heic')).toMatchObject({ read: true, write: false })
  })

  it('config path --json returns the path as data', async () => {
    const { doc } = await jsonOf(['config', 'path'])
    expect((doc as ConfigJson).config.path).toBe(join(dir, 'forge', 'config.json'))
  })

  it('a rejected config value is a JSON failure with exit 2', async () => {
    const { exitCode, doc } = await jsonOf(['config', 'set', 'theme', 'chartreuse'])
    expect(exitCode).toBe(2)
    expect((doc as RunJson).failures[0]?.code).toBe('invalid-arguments')
  })
})

describe('text and JSON are two renderings of one report', () => {
  it('names the same output paths in both', async () => {
    const dir = await makeTempDir()
    for (let i = 0; i < 2; i++) await makeJpeg(dir, `f${i}.jpg`)
    const intent = parseArgs([dir, '--to', 'webp'])
    if (intent.kind !== 'convert') throw new Error('expected a convert intent')
    const report = await runIntent(intent)
    const doc = JSON.parse(
      renderRun(report, { json: true, debug: false }).stdout[0] ?? '',
    ) as RunJson
    const text = renderRun(report, { json: false, debug: false }).stdout.join('\n')
    for (const output of doc.results.flatMap((r) => r.outputs)) {
      expect(text).toContain(displayPath(output, { cwd: process.cwd() }))
    }
  })
})
