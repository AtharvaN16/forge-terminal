import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { probeFiles } from '../../src/core/probe-report.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('skills/forge/SKILL.md', () => {
  it('has Agent Skills frontmatter and teaches the agent contract', async () => {
    const text = await readFile(join(process.cwd(), 'skills', 'forge', 'SKILL.md'), 'utf8')
    const front = text.match(/^---\n([\s\S]*?)\n---\n/)
    expect(front?.[1]).toMatch(/^name: forge$/m)
    expect(front?.[1]).toMatch(/^description: .{40,}$/m)
    for (const needle of ['forge probe', '--json', 'Exit codes', '--force', '--password-stdin']) {
      expect(text).toContain(needle)
    }
  })

  it('agrees with what probe reports for actions', async () => {
    const dir = await makeTempDir()
    const jpeg = await makeJpeg(dir, 'a.jpg')
    const { probes } = await probeFiles([jpeg])
    const actions = probes[0]?.actions ?? []
    expect(actions).toContain('compress')

    const docs = [
      await readFile(join(process.cwd(), 'skills', 'forge', 'SKILL.md'), 'utf8'),
      await readFile(join(process.cwd(), 'README.md'), 'utf8'),
    ]
    for (const text of docs) {
      expect(text).not.toContain('Compression is not an action')
      expect(text).toMatch(/`compress`/)
      expect(text).toMatch(/op: ?"convert"|`op` of `convert`|`op: "convert"`/)
    }
  })
})
