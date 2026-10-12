import { describe, expect, it, vi } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'
import { execute } from '../../src/cli/execute.js'
import { makeJpeg, makePdf, makeTempDir, makeTransparentPng } from '../helpers/fixtures.js'

const run = (argv: string[], colour = false) =>
  execute(parseArgs(argv), { json: argv.includes('--json'), colour })

describe('forge scale', () => {
  it('prints eleven rows, plain when colour is off', async () => {
    const out = await run(['scale', '6579FD'])
    expect(out.exitCode).toBe(0)
    expect(out.stdout).toHaveLength(11)
    expect(out.stdout[5]).toBe(' 500  #6579FD  white 3.6 large · black 5.7 AA')
    expect(out.stdout[3]).toBe(' 300  #A3B6FF  white 1.9 fails · black 10.6 AAA')
    expect(out.stdout.join('\n')).not.toContain('\x1b[')
  })

  it('draws swatches in true colour when colour is on', async () => {
    const out = await run(['scale', '#6579FD'], true)
    expect(out.stdout[5]).toContain('\x1b[38;2;101;121;253m██\x1b[39m')
  })

  it('--json is the scale document', async () => {
    const doc = JSON.parse((await run(['scale', '#6579fd', '--json'])).stdout[0] ?? '')
    expect(doc.ok).toBe(true)
    expect(doc.scale.reference).toBe('#6579FD')
    expect(doc.scale.steps[5]).toEqual({
      step: 500,
      hex: '#6579FD',
      oklch: 'oklch(63% 0.196 273)',
      white: 3.6,
      black: 5.7,
    })
  })

  it('a ratio just under a threshold is rated below it: #777777 is not AA on white', async () => {
    const out = await run(['scale', '777777'])
    expect(out.stdout[5]).toBe(' 500  #777777  white 4.4 large · black 4.6 AA')
  })

  it('a whole ratio keeps its decimal, so the column stays even', async () => {
    const out = await run(['scale', 'FFFFFF'])
    expect(out.stdout[5]).toBe(' 500  #FFFFFF  white 1.0 fails · black 21.0 AAA')
  })

  it('--svg prints the card', async () => {
    const out = await run(['scale', '6579FD', '--svg'])
    expect(out.stdout[0]?.startsWith('<svg')).toBe(true)
  })

  it('a missing or bad colour is invalid arguments (exit 2), with a hint about quoting', () => {
    // Unquoted `forge scale #6579FD` in bash arrives as `forge scale`.
    expect(() => parseArgs(['scale'])).toThrow(
      expect.objectContaining({
        code: 'invalid-arguments',
        hint: expect.stringMatching(/quote/),
      }),
    )
    for (const bad of ['blue', '#GGGGGG', '#12345']) {
      expect(() => parseArgs(['scale', bad]), bad).toThrow(
        expect.objectContaining({ code: 'invalid-arguments', detail: `${bad} is not a colour.` }),
      )
    }
  })
})

describe('--help on the colour commands', () => {
  it('prints their usage and ends as help does (exit 0), for both and for -h', () => {
    for (const argv of [
      ['palette', '--help'],
      ['scale', '-h'],
      ['scale', '6579FD', '--help'],
    ]) {
      const written: string[] = []
      const spy = vi.spyOn(process.stdout, 'write').mockImplementation((s) => {
        written.push(String(s))
        return true
      })
      try {
        expect(() => parseArgs(argv), argv.join(' ')).toThrow(
          expect.objectContaining({ code: 'commander.helpDisplayed' }),
        )
      } finally {
        spy.mockRestore()
      }
      const text = written.join('')
      expect(text).toContain(`forge ${argv[0]}`)
      expect(text).toContain('--json')
    }
  })
})

describe('forge palette', () => {
  it('prints one row per colour with whole percentages adding to 100', async () => {
    const dir = await makeTempDir()
    const out = await run(['palette', await makeJpeg(dir, 'a.jpg')])
    expect(out.exitCode).toBe(0)
    const pcts = out.stdout.map((l) => Number(/(\d+)%$/.exec(l)?.[1]))
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
    for (const l of out.stdout) expect(l).toMatch(/^#[0-9A-F]{6} {2}\s*\d+%$/)
  })

  it("--json validates and --inside lists one colour's shades", async () => {
    const dir = await makeTempDir()
    const jpg = await makeJpeg(dir, 'a.jpg')
    const doc = JSON.parse((await run(['palette', jpg, '--json'])).stdout[0] ?? '')
    expect(doc.palette.colours.length).toBeGreaterThan(0)
    const first = doc.palette.colours[0].hex
    const inner = JSON.parse(
      (await run(['palette', jpg, '--inside', first, '--json'])).stdout[0] ?? '',
    )
    expect(inner.palette.inside).toBe(first)
  })

  it('a PDF is refused as not an image, exit 1', async () => {
    const dir = await makeTempDir()
    const out = await run(['palette', await makePdf(dir, 'x.png')])
    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('not an image')
  })

  it('a fully transparent image has nothing to take colours from, exit 1', async () => {
    const dir = await makeTempDir()
    // makeTransparentPng is 32 × 32, alpha 0 everywhere.
    const out = await run(['palette', await makeTransparentPng(dir, 't.png')])
    expect(out.exitCode).toBe(1)
    expect(out.stderr.join('\n')).toContain('no visible pixels')
  })
})
