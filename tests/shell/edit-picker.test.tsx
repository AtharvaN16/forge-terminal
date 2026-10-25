import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import type { ImageInfo } from '../../src/core/types.js'
import { EditPicker } from '../../src/shell/components/EditPicker.js'
import { editRows } from '../../src/shell/edit.js'
import { pinPlatform } from '../helpers/platform.js'

// The Mac's rows (Remove background among them); see pinPlatform.
pinPlatform('darwin')

const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const settle = () => new Promise((r) => setTimeout(r, 60))

const photo = {
  kind: 'image',
  path: '/tmp/photo.jpg',
  format: 'jpeg',
  width: 1200,
  height: 900,
  bytes: 1000,
  hasAlpha: false,
} as ImageInfo

const picker = (width: number) =>
  render(
    <EditPicker
      format="JPEG"
      rows={editRows(photo)}
      tools={{ boost: { kind: 'ready' }, 'remove-background': { kind: 'ready' } }}
      checking={false}
      width={width}
      onChoose={() => {}}
      onStop={() => {}}
      onCancel={() => {}}
    />,
  )

describe('the edit picker’s split (S1)', () => {
  it('keeps every row on one line in a narrow terminal: the pane gives way, not the list', async () => {
    const app = picker(60)
    await settle()
    app.stdin.write(DOWN)
    await settle()
    const lines = (app.lastFrame() ?? '').split('\n')
    const boost = lines.findIndex((l) => l.includes('Boost resolution'))
    expect(lines[boost]).toMatch(/❯ Boost resolution +‹ 2× › +│/)
    expect(lines[boost + 1]).toMatch(/^ +Remove background +│/)
  })

  it('with no Remove background row, keeps the blank row after Boost', async () => {
    // Every OS with a build offers Remove background now; one without it would draw this.
    const app = render(
      <EditPicker
        format="JPEG"
        rows={editRows(photo, undefined, undefined, 'win32').filter((r) => r.id !== 'cutout')}
        tools={{ boost: { kind: 'ready' } }}
        checking={false}
        width={80}
        onChoose={() => {}}
        onStop={() => {}}
        onCancel={() => {}}
      />,
    )
    await settle()
    const lines = (app.lastFrame() ?? '').split('\n')
    const boost = lines.findIndex((l) => l.includes('Boost resolution'))
    expect(lines[boost + 1]).toMatch(/^ +│/)
    expect(lines[boost + 2]).toContain('Trim edges')
  })

  it('ignores ←→ on Boost while it is not installed: the scale it opens at is 2×', async () => {
    const draw = (boost: 'absent' | 'ready') => (
      <EditPicker
        format="JPEG"
        rows={editRows(photo)}
        tools={{
          boost: boost === 'ready' ? { kind: 'ready' } : { kind: 'absent', downloadBytes: 1000 },
          'remove-background': { kind: 'ready' },
        }}
        checking={false}
        width={80}
        onChoose={() => {}}
        onStop={() => {}}
        onCancel={() => {}}
      />
    )
    const app = render(draw('absent'))
    await settle()
    app.stdin.write(DOWN)
    await settle()
    app.stdin.write(`${ESC}[C`)
    await settle()
    app.rerender(draw('ready'))
    await settle()
    expect(app.lastFrame()).toContain('‹ 2× ›')
    expect(app.lastFrame()).toContain('becomes 2400 × 1800')
  })

  it('widens the list for a dimmed row’s reason, said in full left of the line', async () => {
    const banner = { ...photo, width: 9000, height: 50 }
    const app = render(
      <EditPicker
        format="JPEG"
        rows={editRows(banner)}
        tools={{ boost: { kind: 'ready' }, 'remove-background': { kind: 'ready' } }}
        checking={false}
        width={80}
        onChoose={() => {}}
        onStop={() => {}}
        onCancel={() => {}}
      />,
    )
    await settle()
    expect(app.lastFrame()).toMatch(/Boost resolution +18,000 px, over 16,384 +│/)
  })
})
