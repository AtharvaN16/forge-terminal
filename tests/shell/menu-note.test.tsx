import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const }

describe('the right-click menu’s first-run note', () => {
  it('says once that Forge added itself to the menu', async () => {
    const { lastFrame, frames } = render(
      <App
        initialWidth={100}
        prefs={prefs}
        menuNote={async () => 'Added Forge to Finder’s Quick Actions'}
      />,
    )
    await settle()
    expect(frames.join('\n')).toContain('Added Forge to Finder’s Quick Actions')
    expect(lastFrame()).toBeDefined()
  })

  it('says nothing when the menu was already set up', async () => {
    const { frames } = render(
      <App initialWidth={100} prefs={prefs} menuNote={async () => undefined} />,
    )
    await settle()
    expect(frames.join('\n')).not.toContain('Added Forge')
  })

  it('says nothing when setting the menu up failed', async () => {
    const { frames } = render(
      <App
        initialWidth={100}
        prefs={prefs}
        menuNote={async () => {
          throw new Error('no Library folder')
        }}
      />,
    )
    await settle()
    expect(frames.join('\n')).not.toContain('Library')
  })
})
