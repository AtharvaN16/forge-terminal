import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeTempDir } from '../helpers/fixtures.js'

const TAB = String.fromCharCode(9)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))
const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

describe('tab completion in the prompt', () => {
  it('completes a unique path in place', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'sunset.jpg'), 'x')
    const { stdin, lastFrame } = render(<App initialWidth={120} prefs={prefs} />)
    stdin.write(join(dir, 'suns'))
    await settle(120)
    stdin.write(TAB)
    await settle()
    expect(lastFrame() ?? '').toContain('sunset.jpg')
  })

  it('lists the candidates when several match', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'sunset.jpg'), 'x')
    await writeFile(join(dir, 'sunrise.jpg'), 'x')
    const { stdin, lastFrame } = render(<App initialWidth={120} prefs={prefs} />)
    stdin.write(join(dir, 'sun'))
    await settle(120)
    stdin.write(TAB)
    await settle()
    const frame = lastFrame() ?? ''
    expect(frame).toContain('sunset.jpg')
    expect(frame).toContain('sunrise.jpg')
  })

  it('does nothing on an empty prompt', async () => {
    const { stdin, lastFrame } = render(<App initialWidth={120} prefs={prefs} />)
    stdin.write(TAB)
    await settle()
    expect((lastFrame() ?? '').toLowerCase()).toContain('drop a file')
  })

  it('never leaves a literal tab in the buffer', async () => {
    const dir = await makeTempDir()
    const { stdin, lastFrame } = render(<App initialWidth={120} prefs={prefs} />)
    stdin.write(`${dir}/nothing-matches-this`)
    await settle(120)
    stdin.write(TAB)
    await settle()
    expect(lastFrame() ?? '').not.toContain('\t')
  })

  it('offers the key in the hints', () => {
    const frame = render(<App initialWidth={120} prefs={prefs} />).lastFrame() ?? ''
    expect(frame).toContain('tab complete')
  })

  it('clears the candidate list once a path is submitted', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'sunset.jpg'), 'x')
    await writeFile(join(dir, 'sunrise.jpg'), 'x')
    const { stdin, lastFrame } = render(<App initialWidth={120} prefs={prefs} />)
    stdin.write(join(dir, 'sun'))
    await settle(120)
    stdin.write(TAB)
    await settle()
    expect(lastFrame() ?? '').toContain('sunrise.jpg')
    stdin.write(String.fromCharCode(13))
    await settle(400)
    // The path was ambiguous, so this fails to probe — but either way the
    // candidate list belongs to the fragment that is now gone.
    expect(lastFrame() ?? '').not.toContain('sunrise.jpg   ')
  })
})
