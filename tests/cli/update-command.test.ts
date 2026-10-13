import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { runUpdate } from '../../src/cli/update-command.js'

describe('forge update: arguments', () => {
  it('is its own command', () => {
    expect(parseArgs(['update'])).toEqual({ kind: 'update' })
    expect(parseArgs(['update', '--json'])).toEqual({ kind: 'update' })
  })

  it('takes nothing else', () => {
    expect(() => parseArgs(['update', 'now'])).toThrow(
      expect.objectContaining({ code: 'invalid-arguments' }),
    )
  })
})

describe('forge update', () => {
  const deps = (latest: string | undefined) => {
    const installed: string[] = []
    return {
      installed,
      check: async () => latest,
      install: async (v: string) => {
        installed.push(v)
      },
    }
  }

  it('installs a newer Forge and says so', async () => {
    const d = deps('0.2.2')
    const r = await runUpdate('0.2.1', d)
    expect(d.installed).toEqual(['0.2.2'])
    expect(r.stdout).toEqual(['✓ Forge 0.2.2 is installed. It runs from your next forge.'])
    expect(r.data).toEqual({ current: '0.2.1', latest: '0.2.2', installed: true })
  })

  it('says this is the latest, and installs nothing', async () => {
    const d = deps('0.2.1')
    const r = await runUpdate('0.2.1', d)
    expect(d.installed).toEqual([])
    expect(r.stdout).toEqual(['✓ Forge 0.2.1 is the latest.'])
    expect(r.data).toEqual({ current: '0.2.1', latest: '0.2.1', installed: false })
  })

  it('tells the caller before it starts installing, so a person sees something happen', async () => {
    const seen: string[] = []
    await runUpdate('0.2.1', { ...deps('0.2.2'), onInstalling: (v) => seen.push(v) })
    expect(seen).toEqual(['0.2.2'])
  })

  it('refuses with update-unreachable when npm cannot be asked', async () => {
    await expect(runUpdate('0.2.1', deps(undefined))).rejects.toMatchObject({
      code: 'update-unreachable',
    })
  })
})
