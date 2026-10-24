import { describe, expect, it } from 'vitest'
import { menuItems } from '../../src/menu/items.js'

const labels = (o: Parameters<typeof menuItems>[0]) => menuItems(o).map((i) => i.label)

describe('menuItems', () => {
  it('offers the four image items, and Open in Forge for PDFs, once Boost is installed', () => {
    expect(labels({ sharpen: true })).toEqual([
      'Open Forge',
      'Convert in Forge',
      'Compress in Forge',
      'Sharpen in Forge',
      'Open in Forge',
    ])
  })

  it('leaves Sharpen out until Boost is installed', () => {
    expect(labels({ sharpen: false })).not.toContain('Sharpen in Forge')
  })

  it('shows Open in Forge for PDFs only, never for images', () => {
    const openIn = menuItems({ sharpen: true }).find((i) => i.label === 'Open in Forge')
    expect(openIn?.kinds).toEqual(['pdf'])
  })

  it('shows Sharpen for images only, Open Forge and the two modes for folders too', () => {
    const kinds = Object.fromEntries(menuItems({ sharpen: true }).map((i) => [i.label, i.kinds]))
    expect(kinds['Sharpen in Forge']).toEqual(['image'])
    expect(kinds['Open Forge']).toEqual(['image', 'folder'])
    expect(kinds['Convert in Forge']).toEqual(['image', 'folder'])
    expect(kinds['Compress in Forge']).toEqual(['image', 'folder'])
  })

  it('runs Sharpen with no window and opens Forge for the rest', () => {
    const windowless = menuItems({ sharpen: true }).filter((i) => !i.window)
    expect(windowless.map((i) => i.action)).toEqual(['sharpen'])
  })

  it('adds each preset turned on in /right-click after Forge’s own: images only, no window, Forge’s mark', () => {
    const items = menuItems({ sharpen: false, presets: ['webblog', 'thumbs'] })
    expect(items.map((i) => i.label).slice(-3)).toEqual([
      'Open in Forge',
      'webblog in Forge',
      'thumbs in Forge',
    ])
    const webblog = items.find((i) => i.preset === 'webblog')
    expect(webblog).toEqual({
      action: 'preset',
      preset: 'webblog',
      label: 'webblog in Forge',
      kinds: ['image'],
      window: false,
      paint: 'forge',
    })
  })

  it('paints each item in its mode colour, Open Forge in Forge’s own gradient', () => {
    const paint = Object.fromEntries(menuItems({ sharpen: true }).map((i) => [i.action, i.paint]))
    expect(paint).toEqual({
      open: 'forge',
      convert: 'convert',
      compress: 'compress',
      sharpen: 'edit',
      'open-pdf': 'pdf',
    })
  })
})
