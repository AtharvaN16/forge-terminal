#!/usr/bin/env node
/**
 * Key & mouse byte probe.
 *
 * Prints the raw bytes your terminal sends for each keystroke, so we can see
 * what Forge actually has to work with. Nothing is interpreted — this is the
 * ground truth beneath Ink's `parse-keypress`.
 *
 *   node keyprobe.mjs          # keys only
 *   node keyprobe.mjs --mouse  # also turn on mouse reporting
 *
 * ctrl-c (or q on its own) quits and restores the terminal.
 */

const wantMouse = process.argv.includes('--mouse')

const NAMES = {
  '\x7f': 'plain Backspace (DEL 0x7f)',
  '\x08': 'Ctrl+H / Backspace (BS 0x08)',
  '\x1b\x7f': 'ESC-prefixed Backspace  ← Option+Backspace WITH meta enabled',
  '\x1b\x08': 'ESC-prefixed BS',
  '\x1b[3~': 'Forward Delete (fn+Delete)',
  '\x1bb': 'ESC b  ← Option+Left, "Natural Text Editing" style',
  '\x1bf': 'ESC f  ← Option+Right, "Natural Text Editing" style',
  '\x1b[1;3D': 'CSI 1;3D  ← Option+Left, iTerm2/xterm alt-modifier style',
  '\x1b[1;3C': 'CSI 1;3C  ← Option+Right, iTerm2/xterm alt-modifier style',
  '\x1b[1;5D': 'CSI 1;5D  ← Ctrl+Left',
  '\x1b[1;5C': 'CSI 1;5C  ← Ctrl+Right',
  '\x1b[1;2D': 'CSI 1;2D  ← Shift+Left (selection)',
  '\x1b[1;2C': 'CSI 1;2C  ← Shift+Right (selection)',
  '\x1b[D': 'Left Arrow',
  '\x1b[C': 'Right Arrow',
  '\x1b[H': 'Home',
  '\x1b[F': 'End',
  '\x01': 'Ctrl+A (0x01)',
  '\x05': 'Ctrl+E (0x05)',
  '\x15': 'Ctrl+U (0x15)',
  '\x0b': 'Ctrl+K (0x0b)',
  '\x17': 'Ctrl+W (0x17)',
  '\x04': 'Ctrl+D (0x04)',
}

const show = (buf) => {
  const s = buf.toString('binary')
  const hex = [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  const printable = s
    .replace(/\x1b/g, '\\e')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: showing control bytes is the point
    .replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)

  // SGR mouse: ESC [ < btn ; col ; row (M press | m release)
  const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(s)
  if (mouse) {
    const [, b, col, row, kind] = mouse
    const n = Number(b)
    const button = n & 3
    const label =
      n & 64
        ? button === 0
          ? 'wheel up'
          : 'wheel down'
        : ['left', 'middle', 'right'][button] ?? '?'
    const mods = [n & 4 && 'shift', n & 8 && 'option/meta', n & 16 && 'ctrl']
      .filter(Boolean)
      .join('+')
    console.log(
      `  ${hex.padEnd(34)} ${`"${printable}"`.padEnd(30)} MOUSE ${label}${
        mods ? ` (${mods})` : ''
      } ${kind === 'M' ? 'press' : 'release'} at col ${col}, row ${row}`,
    )
    return
  }

  const note = NAMES[s]
  console.log(`  ${hex.padEnd(34)} ${`"${printable}"`.padEnd(30)}${note ? ` ${note}` : ''}`)
}

process.stdin.setRawMode(true)
process.stdin.resume()

if (wantMouse) {
  // 1000 = press/release, 1002 = also drag, 1006 = SGR (needed past col 223)
  process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h')
}

const restore = () => {
  if (wantMouse) process.stdout.write('\x1b[?1006l\x1b[?1002l\x1b[?1000l')
  process.stdin.setRawMode(false)
  process.stdout.write('\nrestored. bye.\n')
  process.exit(0)
}

console.log(`
Press keys — each line is what your terminal really sent.
${wantMouse ? 'Mouse reporting is ON: click and scroll in this window too.\n' : ''}
Worth trying:  Option+Backspace · Option+Left/Right · fn+Delete
               Cmd+Backspace · Cmd+Left/Right · Home/End · Shift+Left

  ctrl-c to quit
${'─'.repeat(72)}`)

process.stdin.on('data', (buf) => {
  if (buf.length === 1 && buf[0] === 3) restore()
  show(buf)
})

process.on('SIGINT', restore)
