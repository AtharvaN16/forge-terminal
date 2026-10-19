import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { MenuPopup, ScreenBar, ScreenKeys } from '../../src/shell/components/MenuPopup.js'
import { Text } from '../../src/shell/Text.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'
import { unpaint } from '../helpers/unpaint.js'

const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms))
const plain = (s: string | undefined) => unpaint(s ?? '')

function popup(body: React.ReactNode, o: { title?: string } = {}) {
  return render(
    <ThemeProvider palette={DARK}>
      <MenuPopup
        width={80}
        height={24}
        {...(o.title ? { title: o.title } : {})}
        body={body}
        field={<Text>› /</Text>}
        keys={{
          pairs: [
            ['↑↓', 'choose'],
            ['↵', 'open'],
          ],
          foot: [['esc', 'close']],
        }}
      />
    </ThemeProvider>,
  )
}

describe('MenuPopup', () => {
  it('fills the window: a box over rows 0–20, the "/ menu" hint, then the key row', async () => {
    const { lastFrame } = popup(<Text>the list</Text>)
    await settle()
    const lines = plain(lastFrame()).split('\n')
    expect(lines).toHaveLength(24)
    expect(lines[0]).toMatch(/^ ╭─+╮ ?$/)
    expect(lines[20]).toMatch(/^ ╰─+╯ ?$/)
    expect(lines[21]).toMatch(/\/ +menu\s*$/)
    expect(lines[23]).toMatch(/↑↓\s+choose/)
    expect(lines[23]).toContain('esc close')
  })

  it('has the menu chip in its bar, and nothing after it on the list', async () => {
    const { lastFrame } = popup(<Text>the list</Text>)
    await settle()
    const lines = plain(lastFrame()).split('\n')
    expect(lines[1]).toContain('menu')
    expect(lines[1]).not.toMatch(/menu.*Menu/)
  })

  it('names a setting at the end of its bar', async () => {
    const { lastFrame } = popup(<Text>the theme</Text>, { title: 'Theme' })
    await settle()
    expect(plain(lastFrame()).split('\n')[1]).toMatch(/Theme/)
  })

  it('puts its own field at the bottom of the box', async () => {
    const { lastFrame } = popup(<Text>the list</Text>)
    await settle()
    const lines = plain(lastFrame()).split('\n')
    expect(lines[19]).toContain('› /')
  })
})

describe('a settings screen inside the popup', () => {
  function Setting() {
    return (
      <>
        <ScreenBar
          chip={{ label: 'update', colour: DARK.brand, stops: [] }}
          trail={{ answers: [], current: 'Update' }}
          width={74}
        />
        <Text>the setting’s body</Text>
        <ScreenKeys width={74} pairs={[['↵', 'check again']]} foot={[['esc', 'back']]} />
      </>
    )
  }

  it('draws its own bar and keys when it stands alone', async () => {
    const { lastFrame } = render(
      <ThemeProvider palette={DARK}>
        <Setting />
      </ThemeProvider>,
    )
    await settle()
    const frame = plain(lastFrame())
    expect(frame).toContain('update')
    expect(frame).toContain('check again')
  })

  it('gives its keys to the popup’s key row, and leaves the bar to the popup', async () => {
    const { lastFrame } = render(
      <ThemeProvider palette={DARK}>
        <MenuPopup
          width={80}
          height={24}
          title="Update"
          body={<Setting />}
          field={<Text>› /update</Text>}
          keys={{ pairs: [], foot: [] }}
        />
      </ThemeProvider>,
    )
    await settle()
    const lines = plain(lastFrame()).split('\n')
    expect(lines[23]).toMatch(/↵\s+check again/)
    expect(lines[23]).toContain('esc back')
    // one bar: the popup's, with the menu chip
    expect(lines.filter((l) => l.includes('╱╱╱'))).toHaveLength(1)
    expect(lines.slice(2, 19).join('\n')).not.toContain('check again')
  })
})
