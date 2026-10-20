import { describe, expect, it } from 'vitest'
import { listCommands } from '../../src/shell/commands.js'
import { type Row, width } from '../../src/shell/home-art.js'
import { MENU_NAME_COLUMN, menuListRows } from '../../src/shell/menu-art.js'
import { DARK } from '../../src/shell/theme.js'

const text = (r: Row) => r.map((x) => x.text).join('')
const W = 74

function rows(fragment = '', selected = 0) {
  const list = listCommands(fragment)
  return menuListRows({ palette: DARK, width: W, ...list, selected })
}

describe('menuListRows', () => {
  it('heads each group in gold, a faint rule to the edge, a blank row under it and between groups', () => {
    const out = rows().map(text)
    expect(out[0]).toMatch(/^ {2}Settings ─+$/)
    expect(out[1]).toBe('')
    const modes = out.indexOf(out.find((l) => l.startsWith('  Modes')) ?? '')
    expect(out[modes - 1]).toBe('')
    expect(out[modes + 1]).toBe('')
    const heading = rows()[0] as Row
    expect(heading.find((r) => r.text === 'Settings')).toMatchObject({ fg: DARK.brand, bold: true })
    expect(heading.at(-1)?.fg).toBe(DARK.faint)
    expect(width(heading)).toBe(W)
  })

  it('lists the settings above the modes, the chosen one saying what it does after its name', () => {
    const out = rows().map(text)
    const at = (name: string) => out.findIndex((l) => l.includes(`/${name}`))
    expect(at('about')).toBeLessThan(at('convert'))
    const theme = out[at('theme')] ?? ''
    expect(theme.indexOf('switch between light and dark themes')).toBe(MENU_NAME_COLUMN)
  })

  it('says what a command does only on the chosen row (2026-10-18)', () => {
    const list = listCommands('')
    const at = list.items.findIndex((c) => c.name === 'compress')
    const out = menuListRows({ palette: DARK, width: W, ...list, selected: at }).map(text)
    expect(out.find((l) => l.includes('/compress'))).toContain('reduce file size')
    expect(out.find((l) => l.includes('/theme'))?.trimEnd()).toBe('  /theme')
    expect(out.join('\n')).not.toContain('switch between')
  })

  it('bands the chosen row across the width, with a strip in gold for a setting', () => {
    const chosen = rows('', 0)[2] as Row
    expect(text(chosen)).toContain('/theme')
    expect(chosen.every((r) => r.bg === DARK.panelBand)).toBe(true)
    expect(width(chosen)).toBe(W)
    expect(chosen[0]).toMatchObject({ text: '▌', fg: DARK.brand })
  })

  it('takes the mode’s colour for the strip of a chosen mode', () => {
    const list = listCommands('')
    const at = list.items.findIndex((c) => c.name === 'compress')
    const out = menuListRows({ palette: DARK, width: W, ...list, selected: at })
    const row = out.find((r) => text(r).includes('/compress')) as Row
    expect(row[0]).toMatchObject({ text: '▌', fg: DARK.modeCompress })
  })

  it('draws an unchosen name dim, and the chosen row’s description dim too', () => {
    const out = rows('', 0)
    const ext = out.find((r) => text(r).includes('/extensions')) as Row
    expect(ext.find((r) => r.text === 'extensions')?.fg).toBe(DARK.dim)
    const theme = out.find((r) => text(r).includes('/theme')) as Row
    expect(theme.find((r) => r.text.startsWith('switch'))?.fg).toBe(DARK.dim)
  })

  it('cuts a description too long for the width with …', () => {
    const out = menuListRows({ palette: DARK, width: 40, ...listCommands('ed'), selected: 0 }).map(
      text,
    )
    const edit = out.find((l) => l.includes('/edit')) ?? ''
    expect(edit.endsWith('…')).toBe(true)
    expect(edit.length).toBeLessThanOrEqual(40)
  })

  it('narrows by prefix, the typed part bright, and drops a group with nothing left in it', () => {
    const out = rows('ex').map(text)
    expect(out.some((l) => l.includes('/extensions'))).toBe(true)
    expect(out.some((l) => l.startsWith('  Modes'))).toBe(false)
    const row = rows('ex').find((r) => text(r).includes('/extensions')) as Row
    expect(row.find((r) => r.text === '/ex')).toMatchObject({ fg: DARK.fg, bold: true })
  })

  it('scrolls rather than dropping its gaps when the rows are short', () => {
    const full = rows()
    const list = listCommands('')
    const draw = (n: number, selected = 0) =>
      menuListRows({ palette: DARK, width: W, ...list, selected, rows: n }).map(text)
    expect(draw(full.length)).toHaveLength(full.length)
    const short = draw(full.length - 3)
    expect(short).toHaveLength(full.length - 3)
    expect(short.at(-1)).toMatch(/↓ \d+ more/)
    // the blank under the first heading is still there
    expect(short[1]?.replace(/[┃│]/g, '').trim()).toBe('')
    expect(short.join('\n')).toContain('┃')
    // the chosen command is always in view, last one too
    const last = list.items.length - 1
    expect(draw(full.length - 3, last).join('\n')).toContain(`/${list.items[last]?.name}`)
    expect(draw(full.length - 3, last).at(-1)).toBe('')
  })

  it('says so when nothing matches', () => {
    expect(rows('zz').map(text).join('\n')).toContain('no command matches /zz')
  })
})
