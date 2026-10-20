import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import { QualityStep } from '../../src/shell/components/QualityStep.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK, modeColours } from '../../src/shell/theme.js'
import type { MeasuredSize } from '../../src/shell/useMeasuredSize.js'

vi.hoisted(() => {
  process.env.FORCE_COLOR = '3'
  process.env.NO_COLOR = ''
})

const ESC = String.fromCharCode(27)
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms))
const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}`
}
const lines = (f: string | undefined) => (f ?? '').split('\n')
const plain = (line: string | undefined) => (line ?? '').replace(SGR, '')

const OFF = 'Use dithering for smoother colours — the file gets bigger.'

function step({
  size = { status: 'done', bytes: 50_000 } as MeasuredSize,
  value = 65,
  dither,
  onSubmit = () => {},
  noBigger = true,
}: {
  size?: MeasuredSize
  value?: number
  dither?: { on: boolean; onToggle: () => void }
  onSubmit?: (q: number) => void
  noBigger?: boolean
}) {
  return render(
    <ThemeProvider palette={DARK}>
      <QualityStep
        mode="compress"
        aside="shot.png"
        min={30}
        max={100}
        step={35}
        points
        value={value}
        onChange={() => {}}
        onSubmit={onSubmit}
        onCancel={() => {}}
        size={size}
        sourceBytes={100_000}
        noBigger={noBigger}
        dither={dither}
        width={80}
      />
    </ThemeProvider>,
  )
}

describe('the dither note (N4)', () => {
  it('sits above the keys with d on a grey cap, lined up with the key row', async () => {
    const app = step({ dither: { on: false, onToggle: () => {} } })
    await settle()
    const rows = lines(app.lastFrame())
    const note = rows.findIndex((r) => plain(r).includes(OFF))
    expect(plain(rows[note])).toBe(`   d  ${OFF}`)
    // A blank row, the rule, then the keys, whose first cap starts in the same column.
    expect(plain(rows[note + 1]).trim()).toBe('')
    expect(plain(rows[note + 2])).toBe(`  ${'─'.repeat(76)}`)
    expect(plain(rows[note + 3]).indexOf('←→')).toBe(plain(rows[note]).indexOf('d'))
    expect(rows[note]).toContain(`48;2;${rgb(DARK.keycapBg)}`)
  })

  it('says “Dithering on” once on, the d in the mode’s green', async () => {
    const app = step({ dither: { on: true, onToggle: () => {} } })
    await settle()
    const row = lines(app.lastFrame()).find((r) => plain(r).includes('Dithering on')) ?? ''
    expect(plain(row)).toBe('   d  Dithering on')
    expect(row).toContain(`38;2;${rgb(modeColours(DARK, 'compress').fg)}`)
  })

  it('d presses the toggle', async () => {
    const onToggle = vi.fn()
    const app = step({ dither: { on: false, onToggle } })
    await settle()
    app.stdin.write('d')
    await settle()
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('says nothing, and d does nothing, where dithering would change nothing', async () => {
    const app = step({})
    await settle()
    expect(app.lastFrame()).not.toContain('dithering')
    app.stdin.write('d')
    await settle()
  })
})

describe('cannot compress more (E3)', () => {
  it('says so on the size line, in orange, where the result would not be smaller', async () => {
    const app = step({ size: { status: 'done', bytes: 101_000 } })
    await settle()
    const row = lines(app.lastFrame()).find((r) => plain(r).includes('cannot compress more')) ?? ''
    expect(plain(row).trim()).toBe('101 KB  cannot compress more')
    expect(row).toContain(`38;2;${rgb(DARK.larger)}`)
    expect(app.lastFrame()).not.toMatch(/\d+% larger/)
  })

  it('greys ↵ out, and ↵ then does nothing', async () => {
    const onSubmit = vi.fn()
    const app = step({ size: { status: 'done', bytes: 100_000 }, onSubmit })
    await settle()
    const keys = lines(app.lastFrame()).findLast((r) => plain(r).includes('confirm')) ?? ''
    expect(keys).toContain(`38;2;${rgb(DARK.border)}`)
    app.stdin.write('\r')
    await settle()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('takes ↵ as usual when the result is smaller', async () => {
    const onSubmit = vi.fn()
    const app = step({ onSubmit })
    await settle()
    app.stdin.write('\r')
    await settle()
    expect(onSubmit).toHaveBeenCalledWith(65)
  })

  it('outside /compress a larger result is only said, as today', async () => {
    const app = step({ size: { status: 'done', bytes: 120_000 }, noBigger: false })
    await settle()
    expect(app.lastFrame()?.replace(SGR, '')).toContain('20% larger')
  })
})
