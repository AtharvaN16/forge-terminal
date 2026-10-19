import { describe, expect, it } from 'vitest'
import { menuItems } from '../../src/menu/items.js'
import { workflowFiles } from '../../src/menu/mac.js'

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
