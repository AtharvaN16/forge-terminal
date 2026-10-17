import { describe, expect, it } from 'vitest'
import { menuItems } from '../../src/menu/items.js'
import { registryPlan, registryRoots, registryScript } from '../../src/menu/windows.js'

const O = {
  node: 'C:\\Program Files\\nodejs\\node.exe',
  menuDir: 'C:\\Users\\me\\AppData\\Roaming\\forge\\menu',
  items: menuItems({ sharpen: true }),
}
const C = 'HKCU\\Software\\Classes'
const byKey = (o = O) => Object.fromEntries(registryPlan(o).map((e) => [e.key, e.values]))

describe('registryPlan', () => {
  it('puts the image items in one Forge › row, with Forge’s icon', () => {
    const k = byKey()
    expect(k[`${C}\\SystemFileAssociations\\image\\shell\\Forge`]).toEqual({
      MUIVerb: 'Forge',
      Icon: `${O.menuDir}\\forge.ico`,
      SubCommands: '',
    })
    const sub = `${C}\\SystemFileAssociations\\image\\shell\\Forge\\shell`
    expect(Object.keys(k).filter((x) => x.startsWith(sub) && !x.endsWith('command'))).toEqual([
      `${sub}\\1open`,
      `${sub}\\2convert`,
      `${sub}\\3compress`,
      `${sub}\\4sharpen`,
    ])
  })

  it('gives each item its label, its mode’s icon and a hidden-console command', () => {
    const k = byKey()
    const item = `${C}\\SystemFileAssociations\\image\\shell\\Forge\\shell\\3compress`
    expect(k[item]).toEqual({ MUIVerb: 'Compress in Forge', Icon: `${O.menuDir}\\compress.ico` })
    expect(k[`${item}\\command`]).toEqual({
      '': `conhost.exe --headless "${O.node}" "${O.menuDir}\\run.mjs" compress "%1"`,
    })
  })

  it('gives folders their own Forge › row, without Sharpen', () => {
    const sub = `${C}\\Directory\\shell\\Forge\\shell`
    const keys = Object.keys(byKey()).filter((x) => x.startsWith(sub) && !x.endsWith('command'))
    expect(keys).toEqual([`${sub}\\1open`, `${sub}\\2convert`, `${sub}\\3compress`])
  })

  it('puts Open in Forge straight in a PDF’s menu, one item needing no submenu', () => {
    const k = byKey()
    expect(k[`${C}\\SystemFileAssociations\\.pdf\\shell\\ForgeOpen`]).toEqual({
      MUIVerb: 'Open in Forge',
      Icon: `${O.menuDir}\\pdf.ico`,
    })
  })

  it('leaves Sharpen out when Boost is not installed', () => {
    const keys = Object.keys(byKey({ ...O, items: menuItems({ sharpen: false }) }))
    expect(keys.some((x) => x.includes('sharpen'))).toBe(false)
  })

  it('registers Forge’s app ID so its notifications carry its name and logo', () => {
    expect(byKey()[`${C}\\AppUserModelId\\ForgeTerminal.Forge`]).toEqual({
      DisplayName: 'Forge',
      IconUri: `${O.menuDir}\\forge.png`,
    })
  })
})

describe('registryRoots', () => {
  it('lists the keys that, deleted, remove everything the plan wrote', () => {
    const roots = registryRoots()
    for (const { key } of registryPlan(O)) expect(roots.some((r) => key.startsWith(r))).toBe(true)
  })
})

describe('registryScript', () => {
  it('writes each key with PowerShell, values single-quoted', () => {
    const ps = registryScript([{ key: `${C}\\X`, values: { MUIVerb: "Tom's", '': 'cmd "%1"' } }])
    expect(ps).toContain(
      `New-Item -Path 'Registry::HKEY_CURRENT_USER\\Software\\Classes\\X' -Force`,
    )
    expect(ps).toContain(`-Name 'MUIVerb' -Value 'Tom''s'`)
    expect(ps).toContain(`-Name '(default)' -Value 'cmd "%1"'`)
  })

  it('clears the old keys first, so an item that went (Sharpen) does not linger', () => {
    const ps = registryScript([])
    for (const r of registryRoots())
      expect(ps).toContain(
        `Remove-Item -Path 'Registry::${r.replace('HKCU', 'HKEY_CURRENT_USER')}'`,
      )
  })
})
