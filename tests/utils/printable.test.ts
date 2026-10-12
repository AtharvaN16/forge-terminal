import { describe, expect, it } from 'vitest'
import { printable } from '../../src/utils/printable.js'

describe('printable', () => {
  it('replaces an escape sequence hidden in a name, so the terminal never acts on it', () => {
    // OSC 52 sets the clipboard in terminals that honour it.
    expect(printable('a\x1b]52;c;aGk=\x07.png')).toBe('a?]52;c;aGk=?.png')
  })

  it('replaces every C0 control, DEL and C1 control', () => {
    expect(printable('a\nb\tc\x00d\x7fe\x9bf')).toBe('a?b?c?d?e?f')
  })

  it('replaces the bidi overrides that disguise an extension', () => {
    // Shown as "photo‮gpj.exe" reads as "photoexe.jpg".
    expect(printable('photo‮gpj.exe')).toBe('photo?gpj.exe')
    expect(printable('a⁦b⁩')).toBe('a?b?')
  })

  it('leaves ordinary names, accents, CJK and emoji untouched', () => {
    const names = ['IMG_4021.HEIC', 'Café menu.pdf', '写真 (1).png', 'trip 🏔.jpg']
    for (const name of names) expect(printable(name)).toBe(name)
  })
})
