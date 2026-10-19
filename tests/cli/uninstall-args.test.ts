import { describe, expect, it } from 'vitest'
import { parseArgs } from '../../src/cli/args.js'

describe('forge uninstall', () => {
  it('parses as its own command', () => {
    expect(parseArgs(['uninstall'])).toEqual({ kind: 'uninstall' })
  })

  it('takes nothing else', () => {
    expect(() => parseArgs(['uninstall', 'now'])).toThrow(/forge uninstall takes nothing else/)
  })
})
