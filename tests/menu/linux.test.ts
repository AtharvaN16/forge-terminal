import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { menuItems } from '../../src/menu/items.js'
import {
  desktopQuote,
  dolphinMenu,
  EMPTY_UCA,
  linuxDirs,
  MARKER,
  mergeUca,
  nautilusScript,
  nemoAction,
  nemoName,
  onPath,
  stripUca,
  thunarActions,
} from '../../src/menu/linux.js'

const ITEMS = menuItems({ sharpen: true })
const item = (action: string) => ITEMS.find((i) => i.action === action) as (typeof ITEMS)[number]
const LAUNCHER = '/home/me/.config/forge/menu/run'
const MENU = '/home/me/.config/forge/menu'

describe('linuxDirs', () => {
  it('uses the XDG folders the shell had', () => {
    expect(
      linuxDirs({
        home: '/home/me',
        xdgDataHome: '/d',
        xdgConfigHome: '/c',
        xdgConfigDirs: '/etc/a:/etc/b',
      }),
    ).toEqual({ dataHome: '/d', configHome: '/c', configDirs: ['/etc/a', '/etc/b'] })
  })

  it('falls back to the spec’s defaults, ignoring a relative path as the spec says', () => {
    expect(linuxDirs({ home: '/home/me', xdgDataHome: 'rel', xdgConfigDirs: '' })).toEqual({
      dataHome: '/home/me/.local/share',
      configHome: '/home/me/.config',
      configDirs: ['/etc/xdg'],
    })
  })
})

describe('onPath', () => {
  it('finds an executable on PATH, and not a file that cannot run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-path-'))
    writeFileSync(join(dir, 'tool'), '#!/bin/sh\n')
    writeFileSync(join(dir, 'plain'), '')
    chmodSync(join(dir, 'tool'), 0o755)
    expect(onPath('tool', `/nowhere:${dir}`)).toBe(true)
    expect(onPath('plain', dir)).toBe(false)
    expect(onPath('tool', undefined)).toBe(false)
  })
})

describe('nautilusScript', () => {
  it('calls the launcher with its action, and is marked as Forge’s', () => {
    const sh = nautilusScript(item('convert'), LAUNCHER)
    expect(sh.startsWith('#!/bin/sh\n')).toBe(true)
    expect(sh).toContain(MARKER)
    expect(sh).toContain(`exec '${LAUNCHER}' convert "$@"`)
  })

  // Runs the script with /bin/sh, as Nautilus would.
  it.skipIf(process.platform === 'win32')(
    'hands over the full paths Nautilus lists, spaces and all, else its arguments',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'forge-nautilus-'))
      const log = join(root, 'log')
      const launcher = join(root, 'run')
      writeFileSync(launcher, `#!/bin/sh\nfor a in "$@"; do echo "[$a]" >> '${log}'; done\n`)
      chmodSync(launcher, 0o755)
      const script = join(root, 'Convert in Forge')
      writeFileSync(script, nautilusScript(item('convert'), launcher))
      chmodSync(script, 0o755)
      spawnSync(script, ['b.png'], {
        env: { ...process.env, NAUTILUS_SCRIPT_SELECTED_FILE_PATHS: '/a b/*.png\n/c/d.png\n' },
      })
      expect(readFileSync(log, 'utf8')).toBe('[convert]\n[/a b/*.png]\n[/c/d.png]\n')
      writeFileSync(log, '')
      spawnSync(script, ['b c.png'], {
        env: { ...process.env, NAUTILUS_SCRIPT_SELECTED_FILE_PATHS: '' },
      })
      expect(readFileSync(log, 'utf8')).toBe('[convert]\n[b c.png]\n')
    },
  )
})

describe('nemoAction', () => {
  it('offers the item for its kinds’ MIME types, with every selected path', () => {
    const text = nemoAction(item('open'), LAUNCHER)
    expect(text.startsWith('[Nemo Action]\n')).toBe(true)
    expect(text).toContain('Name=Open Forge\n')
    expect(text).toContain(`Exec='${LAUNCHER}' open %F\n`)
    expect(text).toContain('Mimetypes=image/*;inode/directory;\n')
    expect(text).toContain('Selection=notnone\n')
    expect(nemoAction(item('open-pdf'), LAUNCHER)).toContain('Mimetypes=application/pdf;\n')
  })

  it('quotes a launcher path with a space or a percent sign', () => {
    expect(nemoAction(item('open'), "/h/it's 100%/run")).toContain(
      `Exec='/h/it'\\''s 100%%/run' open %F`,
    )
  })

  it('numbers the files in menu order, the same with or without Sharpen', () => {
    const order = ITEMS.map((i) => i.action)
    expect(nemoName(item('open'), order)).toBe('forge-1-open.nemo_action')
    expect(nemoName(item('open-pdf'), order)).toBe('forge-5-open-pdf.nemo_action')
  })
})

describe('dolphinMenu', () => {
  it('puts an image’s items in a Forge submenu, each with its icon', () => {
    const text = dolphinMenu('image', ITEMS, { launcher: LAUNCHER, menuDir: MENU }) ?? ''
    expect(text).toContain('Type=Service\n')
    expect(text).toContain('MimeType=image/*;\n')
    expect(text).toContain('Actions=open;convert;compress;sharpen;\n')
    expect(text).toContain('X-KDE-Submenu=Forge\n')
    expect(text).toContain(
      `[Desktop Action sharpen]\nName=Sharpen in Forge\nIcon=${MENU}/edit.png\n`,
    )
    expect(text).toContain(`Exec="${LAUNCHER}" compress %F`)
    expect(text).toContain(MARKER)
  })

  it('gives a folder no Sharpen, and a PDF its one item on its own', () => {
    const folder = dolphinMenu('folder', ITEMS, { launcher: LAUNCHER, menuDir: MENU }) ?? ''
    expect(folder).toContain('MimeType=inode/directory;\n')
    expect(folder).toContain('Actions=open;convert;compress;\n')
    const pdf = dolphinMenu('pdf', ITEMS, { launcher: LAUNCHER, menuDir: MENU }) ?? ''
    expect(pdf).toContain('Actions=open-pdf;\n')
    expect(pdf).not.toContain('X-KDE-Submenu')
  })

  it('writes nothing for a kind no item is offered for', () => {
    const items = ITEMS.filter((i) => !i.kinds.includes('pdf'))
    expect(dolphinMenu('pdf', items, { launcher: LAUNCHER, menuDir: MENU })).toBeUndefined()
  })

  it('quotes an Exec argument as the desktop entry spec says, escapes twice over', () => {
    expect(desktopQuote('/a b/run')).toBe('"/a b/run"')
    expect(desktopQuote('/a"$`/50%')).toBe('"/a\\\\"\\\\$\\\\`/50%%"')
    expect(desktopQuote('/a\\b')).toBe('"/a\\\\\\\\b"')
  })
})

const USER_UCA = `<?xml version="1.0" encoding="UTF-8"?>
<actions>
<action>
	<icon>utilities-terminal</icon>
	<name>Open Terminal Here</name>
	<unique-id>1234-1</unique-id>
	<command>exo-open --working-directory %f --launch TerminalEmulator</command>
	<patterns>*</patterns>
	<directories/>
</action>
</actions>
`

describe('Thunar’s uca.xml', () => {
  const actions = thunarActions(ITEMS, { launcher: LAUNCHER, menuDir: MENU })

  it('describes each item as Thunar does, known by a unique-id of Forge’s', () => {
    expect(actions.match(/<action>/g)).toHaveLength(5)
    expect(actions).toContain(`<unique-id>${MARKER}-convert</unique-id>`)
    expect(actions).toContain(`<command>'${LAUNCHER}' convert %F</command>`)
    expect(actions).toContain('<submenu>Forge</submenu>')
  })

  it('matches each kind by Thunar’s file types, a PDF by its name, on its own', () => {
    const block = (a: string) =>
      actions.split('</action>').find((b) => b.includes(`${MARKER}-${a}<`)) ?? ''
    expect(block('open')).toContain('<image-files/>')
    expect(block('open')).toContain('<directories/>')
    expect(block('sharpen')).not.toContain('<directories/>')
    expect(block('open-pdf')).toContain('<patterns>*.pdf;*.PDF</patterns>')
    expect(block('open-pdf')).toContain('<submenu></submenu>')
  })

  it('merges in beside the user’s own actions, and strips back out to the very same file', () => {
    const merged = mergeUca(USER_UCA, actions) ?? ''
    expect(merged).toContain('Open Terminal Here')
    expect(merged).toContain(`${MARKER}-open`)
    expect(merged.trimEnd().endsWith('</actions>')).toBe(true)
    expect(stripUca(merged)).toBe(USER_UCA)
    expect(stripUca(mergeUca(EMPTY_UCA, actions) ?? '')).toBe(EMPTY_UCA)
  })

  it('replaces its own actions rather than adding them twice', () => {
    const twice = mergeUca(mergeUca(USER_UCA, actions) ?? '', actions) ?? ''
    expect(twice.match(new RegExp(`${MARKER}-open<`, 'g'))).toHaveLength(1)
    expect(twice.match(/Open Terminal Here/g)).toHaveLength(1)
  })

  it('keeps the indent of a closing tag, and one sharing a line', () => {
    for (const uca of ['<actions>\n  </actions>\n', '<actions></actions>']) {
      const merged = mergeUca(uca, actions) ?? ''
      expect(merged).toContain(`${MARKER}-open`)
      expect(stripUca(merged)).toBe(uca)
    }
  })

  it('refuses a file it cannot read, so it is never written over', () => {
    expect(mergeUca('not xml at all', actions)).toBeUndefined()
    expect(mergeUca('<actions>\n<action>', actions)).toBeUndefined()
  })
})

describe('presets in the Linux menu', () => {
  const items = menuItems({ sharpen: true, presets: ['web-small', 'print'] })
  const presets = items.filter((i) => i.preset !== undefined)
  const order = menuItems({ sharpen: true }).map((i) => i.action)

  it('runs a preset by name, as Windows and the Mac do', () => {
    const [web] = presets
    if (web === undefined) throw new Error('a preset item')
    expect(nautilusScript(web, '/m/run')).toContain(`exec '/m/run' preset web-small "$@"`)
    expect(nemoAction(web, '/m/run')).toContain(`Exec='/m/run' preset web-small %F`)
  })

  it('gives each preset its own name, after every built-in item', () => {
    const names = presets.map((p) => nemoName(p, order))
    expect(new Set(names).size).toBe(2)
    for (const name of names) expect(name).toMatch(new RegExp(`^forge-${order.length + 1}-preset-`))
  })

  it('gives each its own Dolphin action and Thunar id', () => {
    const menu = dolphinMenu('image', items, { launcher: '/m/run', menuDir: '/m' }) ?? ''
    expect(menu).toContain('[Desktop Action preset-web-small]')
    expect(menu).toContain('[Desktop Action preset-print]')
    const uca = thunarActions(presets, { launcher: '/m/run', menuDir: '/m' })
    expect(uca).toContain('-preset-web-small</unique-id>')
    expect(uca).toContain(`preset print %F</command>`)
  })
})
