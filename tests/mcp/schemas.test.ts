import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { writableFormats } from '../../src/core/capabilities.js'
import {
  FormatsOutput,
  PAGE_OPS,
  ProbeOutput,
  ROTATE_DEGREES,
  RunOutput,
  SPLIT_MODES,
  SPLIT_SPEC_MODES,
  TARGETS,
} from '../../src/mcp/schemas.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

describe('MCP vocabularies come from core, never from a list here', () => {
  it('page operations are the page-op actions', () => {
    expect(PAGE_OPS).toEqual(['merge', 'split', 'extract', 'delete', 'rotate'])
  })

  it('rotation degrees are the rotate action’s choices', () => {
    expect(ROTATE_DEGREES).toEqual([90, 180, 270])
  })

  it('split modes match the split action’s choices', () => {
    expect([...SPLIT_SPEC_MODES]).toEqual(SPLIT_MODES)
  })

  it('targets are what the engines write', () => {
    expect(TARGETS).toEqual(writableFormats())
  })
})

describe('output schemas match what the CLI prints', () => {
  async function jsonOf(argv: string[]): Promise<unknown> {
    const out = await execute(parseArgs([...argv, '--json']), { json: true })
    return JSON.parse(out.stdout[0] ?? '')
  }

  it('a conversion document parses as RunOutput', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    expect(RunOutput.safeParse(await jsonOf([jpg, '--to', 'png'])).success).toBe(true)
  })

  it('a probe document parses as ProbeOutput', async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    expect(ProbeOutput.safeParse(await jsonOf(['probe', jpg])).success).toBe(true)
  })

  it('the formats document parses as FormatsOutput', async () => {
    expect(FormatsOutput.safeParse(await jsonOf(['--formats'])).success).toBe(true)
  })
})
