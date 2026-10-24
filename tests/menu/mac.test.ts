import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { menuItems } from '../../src/menu/items.js'
import { serviceKey, servicesStatus, workflowFiles } from '../../src/menu/mac.js'

const item = (action: string) => {
  const found = menuItems({ sharpen: true }).find((i) => i.action === action)
  if (!found) throw new Error(action)
  return found
}
const LAUNCHER = '/Users/me/.config/forge/menu/run'

describe('workflowFiles', () => {
  it('names the bundle after the item, as Finder lists it', () => {
    expect(workflowFiles(item('compress'), LAUNCHER).name).toBe('Compress in Forge.workflow')
  })

  it('declares a Finder service with the item’s label and its file types', () => {
    const info = workflowFiles(item('sharpen'), LAUNCHER).files['Contents/Info.plist'] as string
    expect(info).toContain('<string>Sharpen in Forge</string>')
    expect(info).toContain('<string>runWorkflowAsService</string>')
    expect(info).toContain('<string>com.apple.finder</string>')
    expect(info).toContain('<string>public.image</string>')
    expect(info).not.toContain('public.folder')
  })

  it('offers an image-and-folder item for both', () => {
    const info = workflowFiles(item('convert'), LAUNCHER).files['Contents/Info.plist'] as string
    expect(info).toContain('<string>public.image</string>')
    expect(info).toContain('<string>public.folder</string>')
  })

  it('offers Open in Forge for PDFs', () => {
    const info = workflowFiles(item('open-pdf'), LAUNCHER).files['Contents/Info.plist'] as string
    expect(info).toContain('<string>com.adobe.pdf</string>')
  })

  it('runs the launcher with the action and every selected file', () => {
    const doc = workflowFiles(item('compress'), LAUNCHER).files['Contents/document.wflow'] as string
    expect(doc).toContain(`<string>'${LAUNCHER}' compress "$@"</string>`)
    // files arrive as arguments, not on stdin
    expect(doc).toMatch(/<key>inputMethod<\/key>\s*<integer>1<\/integer>/)
  })

  it('quotes a launcher path with a quote in it for the shell, then escapes it for XML', () => {
    const doc = workflowFiles(item('open'), "/Users/o'neil & co/run").files[
      'Contents/document.wflow'
    ] as string
    expect(doc).toContain(`<string>'/Users/o'\\''neil &amp; co/run' open "$@"</string>`)
  })

  it('tells Automator what the service takes, so the menu is filtered the same way', () => {
    const meta = (action: string) =>
      (workflowFiles(item(action), LAUNCHER).files['Contents/document.wflow'] as string).match(
        /<key>serviceInputTypeIdentifier<\/key>\s*<string>([^<]+)<\/string>/,
      )?.[1]
    expect(meta('sharpen')).toBe('com.apple.Automator.fileSystemObject.image')
    expect(meta('open-pdf')).toBe('com.apple.Automator.fileSystemObject.PDF')
    expect(meta('convert')).toBe('com.apple.Automator.fileSystemObject')
  })

  it('names its icon so Finder shows the logo instead of Automator’s', () => {
    const files = workflowFiles(item('compress'), LAUNCHER).files
    expect(files['Contents/Info.plist']).toContain('<key>NSIconName</key>')
    expect(Object.keys(files)).toContain('Contents/Resources/document.wflow')
  })
})

describe('a preset’s Quick Action', () => {
  const webblog = menuItems({ sharpen: false, presets: ['webblog'] }).find(
    (i) => i.preset === 'webblog',
  )
  if (!webblog) throw new Error('webblog')

  it('is named as Finder lists it and runs the launcher with the preset’s name before the files', () => {
    const { name, files } = workflowFiles(webblog, LAUNCHER)
    expect(name).toBe('webblog in Forge.workflow')
    expect(files['Contents/document.wflow']).toContain(
      `<string>'${LAUNCHER}' preset 'webblog' "$@"</string>`,
    )
    expect(files['Contents/Info.plist']).toContain('<string>public.image</string>')
  })

  it('has a bundle ID of its own, so the services settings key each preset apart', () => {
    expect(serviceKey(webblog)).toBe(
      'com.forge-terminal.menu.preset.webblog - webblog in Forge - runWorkflowAsService',
    )
  })
})

describe('serviceKey', () => {
  it('names the service as the services settings key it: bundle ID, menu name, message', () => {
    const info = workflowFiles(item('open-pdf'), LAUNCHER).files['Contents/Info.plist'] as string
    expect(info).toContain('<string>com.forge-terminal.menu.open-pdf</string>')
    expect(serviceKey(item('open-pdf'))).toBe(
      'com.forge-terminal.menu.open-pdf - Open in Forge - runWorkflowAsService',
    )
  })
})

// Runs the real script against a scratch preferences domain, never Finder's own.
describe.runIf(process.platform === 'darwin')('servicesStatus, run for real', () => {
  const domain = `com.forge-terminal.test.services.${process.pid}`
  afterEach(() => {
    spawnSync('defaults', ['delete', domain])
  })
  const apply = (o: { on: string[]; off: string[] }) => {
    const [cmd, args] = servicesStatus({ ...o, domain })
    expect(spawnSync(cmd, args).status).toBe(0)
  }
  const read = () => {
    const xml = spawnSync('defaults', ['export', domain, '-'], { encoding: 'utf8' }).stdout
    const json = spawnSync('plutil', ['-convert', 'json', '-o', '-', '-'], {
      input: xml,
      encoding: 'utf8',
    }).stdout
    return JSON.parse(json) as { NSServicesStatus?: Record<string, unknown>; Other?: string }
  }
  const ON = {
    presentation_modes: {
      ContextMenu: true,
      FinderPreview: true,
      ServicesMenu: true,
      TouchBar: true,
    },
  }

  it('switches a service on for the right-click menu, with booleans as Automator writes them', () => {
    apply({ on: ['a.b - Open in Forge - runWorkflowAsService'], off: [] })
    expect(read().NSServicesStatus?.['a.b - Open in Forge - runWorkflowAsService']).toEqual(ON)
  })

  it('switches a service off and keeps every other entry and setting', () => {
    spawnSync('defaults', ['write', domain, 'Other', '-string', 'keep'])
    apply({ on: ['a - One - runWorkflowAsService', "b - Mike's - runWorkflowAsService"], off: [] })
    apply({ on: [], off: ['a - One - runWorkflowAsService'] })
    const after = read()
    expect(after.Other).toBe('keep')
    expect(Object.keys(after.NSServicesStatus ?? {})).toEqual(["b - Mike's - runWorkflowAsService"])
  })
})
