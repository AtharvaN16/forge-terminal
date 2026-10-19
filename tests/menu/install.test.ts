import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { installMenu, isInstalled, type MenuEnv, removeMenu } from '../../src/menu/install.js'

function env(platform: 'darwin' | 'win32', over: Partial<MenuEnv> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'forge-menu-'))
  const calls: [string, string[]][] = []
  const e: MenuEnv = {
    platform,
    home: join(root, 'home'),
    menuDir: join(root, 'config', 'forge', 'menu'),
    node: '/usr/local/bin/node',
    execArgv: [],
    forge: '/usr/local/lib/forge/dist/index.js',
    version: '0.4.0',
    sharpen: true,
    run: async (cmd, args) => {
      calls.push([cmd, args])
    },
    ...over,
  }
  return { e, calls, services: join(e.home, 'Library', 'Services') }
}

describe('installMenu on a Mac', () => {
  it('writes a Quick Action for each item, with the logo in its mode colour', async () => {
    const { e, services } = env('darwin')
    await installMenu(e)
    for (const name of [
      'Open Forge',
      'Convert in Forge',
      'Compress in Forge',
      'Sharpen in Forge',
      'Open in Forge',
    ]) {
      expect(existsSync(join(services, `${name}.workflow`, 'Contents', 'Info.plist'))).toBe(true)
      const icon = join(services, `${name}.workflow`, 'Contents', 'Resources', 'forge.tiff')
      expect((await sharp(icon).metadata()).format).toBe('tiff')
    }
  })

  it('writes an executable launcher the items call', async () => {
    const { e } = env('darwin')
    await installMenu(e)
    const launcher = join(e.menuDir, 'run')
    // Windows has no execute bit to set.
    if (process.platform !== 'win32') expect(statSync(launcher).mode & 0o111).not.toBe(0)
    expect(readFileSync(launcher, 'utf8')).toContain('menu run "$@"')
    const doc = readFileSync(
      join(
        e.home,
        'Library',
        'Services',
        'Compress in Forge.workflow',
        'Contents',
        'document.wflow',
      ),
      'utf8',
    )
    expect(doc).toContain(`'${launcher}' compress`)
  })

  it('tells Finder to read the services again', async () => {
    const { e, calls } = env('darwin')
    await installMenu(e)
    expect(calls).toContainEqual(['/System/Library/CoreServices/pbs', ['-update']])
  })

  it('takes Sharpen out when Boost has gone since the last install', async () => {
    const { e, services } = env('darwin')
    await installMenu(e)
    await installMenu({ ...e, sharpen: false })
    expect(existsSync(join(services, 'Sharpen in Forge.workflow'))).toBe(false)
    expect(existsSync(join(services, 'Convert in Forge.workflow'))).toBe(true)
  })

  it('leaves Quick Actions that are not Forge’s alone', async () => {
    const { e, services } = env('darwin')
    await installMenu(e)
    const other = join(services, 'Open in ZCode.workflow')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(other, { recursive: true })
    await removeMenu(e)
    expect(existsSync(other)).toBe(true)
    expect(existsSync(join(services, 'Open Forge.workflow'))).toBe(false)
  })

  it('removes every item and its own folder, and is no longer installed', async () => {
    const { e, calls, services } = env('darwin')
    await installMenu(e)
    expect(isInstalled(e)).toBe(true)
    await removeMenu(e)
    expect(existsSync(join(services, 'Convert in Forge.workflow'))).toBe(false)
    expect(existsSync(e.menuDir)).toBe(false)
    expect(isInstalled(e)).toBe(false)
    expect(calls.at(-1)).toEqual(['/System/Library/CoreServices/pbs', ['-update']])
  })
})

describe('installMenu on Windows', () => {
  const win = () =>
    env('win32', { node: 'C:\\nodejs\\node.exe', forge: 'C:\\npm\\forge-terminal\\dist\\index.js' })

  it('writes the launcher, an icon per colour and the notification logo', async () => {
    const { e } = win()
    await installMenu(e)
    expect(readFileSync(join(e.menuDir, 'run.mjs'), 'utf8')).toContain("'menu', 'run'")
    for (const ico of ['forge', 'convert', 'compress', 'edit', 'pdf'])
      expect(readFileSync(join(e.menuDir, `${ico}.ico`)).readUInt16LE(2)).toBe(1)
    expect((await sharp(join(e.menuDir, 'forge.png')).metadata()).format).toBe('png')
  })

  it('writes the registry keys through PowerShell', async () => {
    const { e, calls } = win()
    await installMenu(e)
    const [cmd, args] = calls.at(-1) ?? ['', []]
    expect(cmd).toBe('powershell.exe')
    expect(args.at(-1)).toContain('Compress in Forge')
  })

  it('removes the keys and the folder', async () => {
    const { e, calls } = win()
    await installMenu(e)
    await removeMenu(e)
    expect(existsSync(e.menuDir)).toBe(false)
    const script = calls.at(-1)?.[1].at(-1) ?? ''
    expect(script).toContain('Remove-Item')
    expect(script).not.toContain('New-Item')
  })
})

describe('installMenu elsewhere', () => {
  it('does nothing on a platform with no menu to add to', async () => {
    const { e, calls } = env('linux' as 'darwin')
    await installMenu(e)
    expect(calls).toEqual([])
    expect(isInstalled(e)).toBe(false)
  })
})
