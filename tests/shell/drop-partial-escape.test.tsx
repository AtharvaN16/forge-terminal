import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/shell/App.js'
import { makePng, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

describe('a single dropped path with one unescaped space', () => {
  it('resolves as the one real file, not two nonexistent fragments', async () => {
    // Reproduces the exact shape Terminal.app pastes for a macOS screenshot:
    // it backslash-escapes most spaces in the name but leaves the one before
    // "AM.png"/"PM.png" bare. Confirmed against the literal bytes it sends
    // (`cat -A` on a real drop), not assumed.
    const dir = await makeTempDir()
    const name = 'Screenshot 2026-08-26 at 1.06.52 AM.png'
    const path = await makePng(dir, name)
    const pastedRaw = path.replace(
      'Screenshot 2026-08-26 at 1.06.52 AM.png',
      'Screenshot\\ 2026-08-26\\ at\\ 1.06.52 AM.png',
    )
    // Sanity check on the fixture itself: the paste must actually contain an
    // unescaped space, or this test would pass without exercising anything.
    expect(pastedRaw).toMatch(/\d\.\d\d \S/)

    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(pastedRaw)
    await settle()
    stdin.write(ENTER)
    await settle(400)

    const frame = lastFrame() ?? ''
    // The real file was found and staged for conversion...
    expect(frame).toContain('PNG')
    // ...not misread as two nonexistent fragments.
    expect(frame).not.toContain('skipped')
    expect(frame).not.toContain('not found')
  })

  it('still splits a genuine multi-file drop of real files', async () => {
    const dir = await makeTempDir()
    const a = await makePng(dir, 'a.png')
    const b = await makePng(dir, 'b.png')

    const { stdin, lastFrame } = render(<App initialWidth={80} />)
    stdin.write(`${a} ${b}`)
    await settle()
    stdin.write(ENTER)
    await settle(400)

    const frame = lastFrame() ?? ''
    // Both real files staged — the whole-string attempt fails (no file
    // literally named "a.png <space> b.png"), so it correctly falls through
    // to splitting, unchanged from before this fix.
    expect(frame).toContain('a.png')
    expect(frame).toContain('b.png')
  })
})
