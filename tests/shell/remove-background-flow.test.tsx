import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeJpeg, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms))

async function openFlow() {
  const dir = await makeTempDir()
  const input = await makeJpeg(dir, 'product.jpg')
  const app = render(
    <App
      initialWidth={100}
      prefs={{ ...DEFAULT_PREFERENCES, theme: 'dark', defaultOutput: dir }}
    />,
  )
  app.stdin.write('/remove-background')
  await settle()
  app.stdin.write(ENTER)
  await settle()
  app.stdin.write(input)
  await settle()
  app.stdin.write(ENTER)
  await settle(400)
  return app
}

describe('/remove-background flow', () => {
  it('arms a visible mode and offers capability-derived transparent formats', async () => {
    const { lastFrame } = await openFlow()
    const frame = lastFrame() ?? ''

    expect(frame).toContain('current mode: remove background')
    expect(frame).toContain('Save the transparent image as')
    expect(frame).toContain('PNG')
    expect(frame).not.toContain('JPEG  universal')
    expect(frame).not.toContain('PDF')
  })

  it('proposes a suffixed filename before any model work starts', async () => {
    const { stdin, lastFrame } = await openFlow()
    stdin.write(ENTER) // default PNG target
    await settle()
    expect(lastFrame() ?? '').toContain('product-no-bg.png')

    stdin.write(ENTER) // destination
    await settle()
    expect(lastFrame() ?? '').toContain('product-no-bg')
    expect(lastFrame() ?? '').toContain('Name the file')
  })
})
