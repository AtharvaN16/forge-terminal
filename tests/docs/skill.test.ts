import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
})
