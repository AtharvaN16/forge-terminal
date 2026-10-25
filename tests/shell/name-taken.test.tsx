import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { NameTaken } from '../../src/shell/components/NameTaken.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const ENTER = '\r'
const settle = () => new Promise((r) => setTimeout(r, 60))
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const plain = (f: string | undefined) => (f ?? '').replace(SGR, '')
const fgOf = (hex: string) =>
  `38;2;${[1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).join(';')}`

function mount(over: Partial<Parameters<typeof NameTaken>[0]> = {}) {
  const onSubmit = vi.fn()
  const onCancel = vi.fn()
  const app = render(
    <ThemeProvider palette={modePalette(DARK, 'convert')}>
      <NameTaken
        mode="convert"
        width={80}
        name="test.jpg"
        keepBoth="test (1).jpg"
        existing={{ bytes: 68_200, modified: new Date(2026, 9, 10, 18, 42) }}
        now={new Date(2026, 9, 11, 22, 50)}
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...over}
      />
    </ThemeProvider>,
  )
  return { app, onSubmit, onCancel }
}

describe('Name taken (L1)', () => {
  it('titles the question in the mode’s colour, the old file’s size and age at its right', () => {
    const { app } = mount()
    const out = app.lastFrame() ?? ''
    expect(plain(out).split('\n')[0]).toMatch(
      /^ {2}test\.jpg already exists +68\.2 KB · yesterday, 18:42$/,
    )
    expect(out).toContain(fgOf(DARK.modeConvert))
  })

  it('opens on Keep both, which previews the name yours gets, the (1) in the mode’s colour', () => {
    const { app } = mount()
    const out = app.lastFrame() ?? ''
    expect(plain(out)).toMatch(/❯ Keep both +saves yours as test \(1\)\.jpg/)
    expect(out).toContain(`${fgOf(DARK.modeConvert)}m (1)`)
  })

  it('shows on Replace the one there now, crossed out, the band hatched after it', async () => {
    const { app } = mount()
    app.stdin.write(DOWN)
    await settle()
    const out = app.lastFrame() ?? ''
    const row = out.split('\n').find((l) => plain(l).includes('Replace')) ?? ''
    expect(plain(row)).toMatch(/❯ Replace +test\.jpg {2}68\.2 KB ╱+/)
    expect(row).toContain(`${ESC}[9m`)
  })

  it('says on Cancel where it goes', async () => {
    const { app } = mount()
    app.stdin.write(DOWN + DOWN)
    await settle()
    expect(plain(app.lastFrame())).toMatch(/❯ Cancel +back to Save as/)
  })

  it('answers with the highlighted choice on ↵, and esc cancels', async () => {
    const { app, onSubmit, onCancel } = mount()
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(ENTER)
    await settle()
    expect(onSubmit).toHaveBeenCalledWith('replace')
    app.stdin.write(ESC)
    await settle()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('keeps F1 keys, with esc cancel in the footnote', () => {
    const { app } = mount()
    const keys = plain(app.lastFrame()).trimEnd().split('\n').at(-1) ?? ''
    expect(keys).toMatch(/^ {3}↑↓ {2}choose {3}↵ {2}confirm +esc cancel · ctrl-c quit$/)
  })

  it('names several files at once when more than one is taken', () => {
    const { app } = mount({ name: '3 files', existing: undefined, keepBoth: 'report-1 (1).pdf …' })
    expect(plain(app.lastFrame()).split('\n')[0]).toMatch(/^ {2}3 files already exist$/)
  })

  it('keeps “already exists” when the name is long and the terminal narrow, cutting the name instead', () => {
    const name = 'PXL_20261011_123456789.MP.portrait.jpg'
    for (const width of [40, 50, 80]) {
      const { app } = mount({ name, keepBoth: 'PXL_20261011_123456789.MP.portrait (1).jpg', width })
      const title = plain(app.lastFrame()).split('\n')[0] ?? ''
      expect(title).toMatch(/already exists/)
      expect(title.length).toBeLessThanOrEqual(width)
    }
  })

  it('keeps the (1) Keep both adds when the preview has to be cut', () => {
    const { app } = mount({
      name: 'PXL_20261011_123456789.MP.portrait.jpg',
      keepBoth: 'PXL_20261011_123456789.MP.portrait (1).jpg',
      width: 40,
    })
    const row =
      plain(app.lastFrame())
        .split('\n')
        .find((l) => l.includes('Keep both')) ?? ''
    expect(row).toMatch(/ \(1\)\.jpg/)
  })
})
