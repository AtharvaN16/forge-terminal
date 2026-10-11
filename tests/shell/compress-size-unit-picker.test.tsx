import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const TAB = String.fromCharCode(9)
const RIGHT = `${String.fromCharCode(27)}[C`
const DOWN = `${String.fromCharCode(27)}[B`
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))

/** Walks as far as the target-size field and stops there. */
async function toSizeField() {
  const dir = await makeTempDir()
  const file = await makeJpeg(dir, 'photo.jpg')
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write('/compress')
  await settle()
  app.stdin.write(ENTER)
  await settle(300)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER)
  await settle(800)
  app.stdin.write(DOWN) // To a target size
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  return app
}

describe('the target-size field', () => {
  it('shows the units it accepts, rather than hiding them in a placeholder', async () => {
    const app = await toSizeField()
    const frame = app.lastFrame() ?? ''

    for (const unit of ['B', 'KB', 'MB', 'GB']) expect(frame).toContain(unit)
  }, 30_000)

  it('changes the unit with the arrow keys once tab moves onto the row', async () => {
    const app = await toSizeField()

    app.stdin.write('500')
    await settle()
    app.stdin.write(TAB)
    await settle()
    app.stdin.write(RIGHT)
    await settle(300)

    // KB is the resting unit; one step right lands on MB, and the field says
    // what it understood rather than making the user guess.
    expect(app.lastFrame()).toContain('500 MB')
  }, 30_000)

  /**
   * The unit row is one half of a single answer, not a step of its own, so
   * confirming it confirms the field. Requiring a tab back onto the amount
   * first made the row a place you could get stuck: every other key the hint
   * bar names works there, and the one it names first did nothing.
   */
  it('confirms from the unit row, without tabbing back to the amount', async () => {
    const app = await toSizeField()

    app.stdin.write('500')
    await settle()
    app.stdin.write(TAB)
    await settle()
    app.stdin.write(RIGHT)
    await settle()
    app.stdin.write(ENTER)
    await settle(400)

    // 'Save to' is the destination step: the size was taken, unit and all.
    expect(app.lastFrame()).toContain('Save to')
  }, 30_000)
})
