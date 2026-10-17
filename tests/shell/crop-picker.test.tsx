import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { ImageInfo } from '../../src/core/types.js'
import { EditPicker } from '../../src/shell/components/EditPicker.js'
import { type EditRow, editRows } from '../../src/shell/edit.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modePalette } from '../../src/shell/theme.js'
import { pinPlatform } from '../helpers/platform.js'
import { ansiRow } from './home-cells.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

// The Mac's rows (Remove background among them); see pinPlatform.
pinPlatform('darwin')

/**
 * Crop to shape's row (mockups/crop-2026-10.html, tab 2): Boost's pill, one
 * implementation, stepping shapes instead of scales.
 */
const ESC = String.fromCharCode(27)
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const ENTER = String.fromCharCode(13)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = () => new Promise((r) => setTimeout(r, 60))
const P = modePalette(DARK, 'edit')

const photo = {
  kind: 'image',
  path: '/tmp/photo.jpg',
  format: 'jpeg',
  width: 4032,
  height: 3024,
  bytes: 1000,
  hasAlpha: false,
  frames: 1,
} as ImageInfo

function picker(
  onChoose: (row: EditRow, step?: number | string) => void = () => {},
  image: ImageInfo = photo,
) {
  const app = render(
    <ThemeProvider palette={P}>
      <EditPicker
        format="JPEG"
        rows={editRows(image)}
        tools={{ boost: { kind: 'ready' }, 'remove-background': { kind: 'ready' } }}
        checking={false}
        width={80}
        onChoose={onChoose}
        onStop={() => {}}
        onCancel={() => {}}
      />
    </ThemeProvider>,
  )
  const lines = () => (app.lastFrame() ?? '').split('\n')
  const plain = () => lines().map((l) => l.replace(SGR, ''))
  return { app, lines, plain }
}

/** The colour of the cell where `text` starts on the line holding it. */
function fgOf(lines: string[], plain: string[], text: string): string | null {
  const at = plain.findIndex((l) => l.includes(text))
  const col = plain[at]?.indexOf(text) ?? -1
  return ansiRow(lines[at] ?? '')[col + 1]?.fg ?? null
}

describe('the Crop to shape row’s pill', () => {
  it('steps 1:1 · 4:5 · 16:9 · 9:16 with ←→, the arrow grey where there is no step', async () => {
    const chose: Array<[string, unknown]> = []
    const p = picker((row, step) => chose.push([row.id, step]))
    await settle()
    // Sharpen, Boost, Remove background, Trim edges, Resize, then Crop to shape.
    for (let i = 0; i < 5; i++) {
      p.app.stdin.write(DOWN)
      await settle()
    }
    expect(p.plain().join('\n')).toMatch(/▌ Crop to shape +‹ 1:1 › +│/)
    expect(p.plain().join('\n')).toContain('Changes the shape.')
    expect(p.plain().join('\n')).toContain('becomes 3024 × 3024')
    expect(p.plain().at(-1)).toMatch(/↑↓ +choose +←→ +shape +↵ +confirm/)
    // At the first shape the left arrow has nowhere to go: grey; the right is live.
    expect(fgOf(p.lines(), p.plain(), ' ‹ ')).toBe(P.border)
    expect(fgOf(p.lines(), p.plain(), ' › ')).toBe(P.accent)

    for (const [shape, size] of [
      ['4:5', '2419 × 3024'],
      ['16:9', '4032 × 2268'],
      ['9:16', '1701 × 3024'],
    ]) {
      p.app.stdin.write(RIGHT)
      await settle()
      expect(p.plain().join('\n')).toContain(`‹ ${shape} ›`)
      expect(p.plain().join('\n')).toContain(`becomes ${size}`)
    }
    // At the last, → does nothing and the right arrow is grey.
    p.app.stdin.write(RIGHT)
    await settle()
    expect(p.plain().join('\n')).toContain('‹ 9:16 ›')
    expect(fgOf(p.lines(), p.plain(), ' › ')).toBe(P.border)
    expect(fgOf(p.lines(), p.plain(), ' ‹ ')).toBe(P.accent)

    p.app.stdin.write(LEFT)
    await settle()
    p.app.stdin.write(ENTER)
    await settle()
    expect(chose).toEqual([['crop', '16:9']])
  })

  it('keeps Boost’s own scale while Crop’s shape moves, and says “scale” on Boost', async () => {
    // Small enough for 4×.
    const p = picker(undefined, { ...photo, width: 1200, height: 900 })
    await settle()
    p.app.stdin.write(DOWN)
    await settle()
    p.app.stdin.write(RIGHT)
    await settle()
    expect(p.plain().join('\n')).toContain('‹ 4× ›')
    expect(p.plain().at(-1)).toMatch(/←→ +scale/)
    for (let i = 0; i < 4; i++) {
      p.app.stdin.write(DOWN)
      await settle()
    }
    // Crop opens at its first shape, not at Boost's second step.
    expect(p.plain().join('\n')).toContain('‹ 1:1 ›')
    for (let i = 0; i < 4; i++) {
      p.app.stdin.write(`${ESC}[A`)
      await settle()
    }
    expect(p.plain().join('\n')).toContain('‹ 4× ›')
  })

  it('is dimmed with why when no shape would change the image (1 × 1), and ↵ does nothing', async () => {
    const dot = { ...photo, width: 1, height: 1 }
    const row = editRows(dot).find((r) => r.id === 'crop')
    expect(row?.shapes).toEqual([])
    expect(row?.tooLarge).toBe('no shape to cut')

    const chose: string[] = []
    const p = picker((r) => chose.push(r.id), dot)
    await settle()
    expect(p.plain().join('\n')).toMatch(/Crop to shape +no shape to cut/)
    // The cursor never lands on it: past Resize it stays where it was.
    for (let i = 0; i < 6; i++) {
      p.app.stdin.write(DOWN)
      await settle()
    }
    p.app.stdin.write(ENTER)
    await settle()
    expect(chose).not.toContain('crop')
  })

  it('opens on the shape chosen before, coming back from the crop', async () => {
    const app = render(
      <ThemeProvider palette={P}>
        <EditPicker
          format="JPEG"
          rows={editRows(photo)}
          tools={{ boost: { kind: 'ready' }, 'remove-background': { kind: 'ready' } }}
          checking={false}
          width={80}
          chosen={{ tool: 'crop', step: '16:9' }}
          onChoose={() => {}}
          onStop={() => {}}
          onCancel={() => {}}
        />
      </ThemeProvider>,
    )
    await settle()
    expect((app.lastFrame() ?? '').replace(SGR, '')).toMatch(/▌ Crop to shape +‹ 16:9 ›/)
  })
})
