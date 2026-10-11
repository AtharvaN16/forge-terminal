import { Text } from 'ink'
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it } from 'vitest'
import { SizeAside } from '../../src/shell/components/SizeAside.js'
import { setMotionForTests } from '../../src/shell/motion.js'
import { ThemeProvider } from '../../src/shell/ThemeContext.js'
import { DARK } from '../../src/shell/theme.js'
import { type MeasureFn, useMeasuredSize } from '../../src/shell/useMeasuredSize.js'

const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms))

/** A measure function whose answers the test hands out by hand. */
function controlled() {
  const pending = new Map<string, { resolve: (n: number) => void; reject: (e: Error) => void }>()
  const asked: string[] = []
  const measure: MeasureFn = (target) =>
    new Promise<number>((resolve, reject) => {
      asked.push(target)
      pending.set(target, { resolve, reject })
    })
  return { measure, asked, pending }
}

function Probe(props: { highlighted?: string; measure?: MeasureFn; resetKey?: string }) {
  const size = useMeasuredSize({
    highlighted: props.highlighted,
    measure: props.measure,
    resetKey: props.resetKey ?? 'a.png',
    delayMs: 10,
  })
  return <Text>{size.status === 'done' ? `done ${size.bytes}` : size.status}</Text>
}

describe('useMeasuredSize', () => {
  it('says measuring, then the number once the encode answers', async () => {
    const c = controlled()
    const app = render(<Probe highlighted="webp" measure={c.measure} />)
    expect(app.lastFrame()).toBe('measuring')
    await wait()
    expect(c.asked).toEqual(['webp'])
    c.pending.get('webp')?.resolve(41_800)
    await wait()
    expect(app.lastFrame()).toBe('done 41800')
  })

  it('a late result stays with its own target', async () => {
    const c = controlled()
    const app = render(<Probe highlighted="avif" measure={c.measure} />)
    await wait()
    app.rerender(<Probe highlighted="webp" measure={c.measure} />)
    await wait()
    c.pending.get('avif')?.resolve(33_100)
    await wait()
    // WebP is now highlighted and has not been measured: AVIF's number must not show here.
    expect(app.lastFrame()).toBe('measuring')
    // …and the queued WebP encode runs once AVIF's is out of the way.
    expect(c.asked).toEqual(['avif', 'webp'])
    c.pending.get('webp')?.resolve(41_800)
    await wait()
    expect(app.lastFrame()).toBe('done 41800')
    // Back on AVIF: cached, shown at once, not measured again.
    app.rerender(<Probe highlighted="avif" measure={c.measure} />)
    await wait()
    expect(app.lastFrame()).toBe('done 33100')
    expect(c.asked).toEqual(['avif', 'webp'])
  })

  it('runs one encode at a time', async () => {
    const c = controlled()
    const app = render(<Probe highlighted="avif" measure={c.measure} />)
    await wait()
    app.rerender(<Probe highlighted="webp" measure={c.measure} />)
    await wait()
    app.rerender(<Probe highlighted="gif" measure={c.measure} />)
    await wait()
    expect(c.asked).toEqual(['avif'])
  })

  it('shows nothing when the encode fails', async () => {
    const c = controlled()
    const app = render(<Probe highlighted="heic" measure={c.measure} />)
    await wait()
    c.pending.get('heic')?.reject(new Error('no encoder'))
    await wait()
    expect(app.lastFrame()).toBe('idle')
  })

  it('does nothing without a measure function — a document, say', async () => {
    const app = render(<Probe highlighted="png" />)
    await wait()
    expect(app.lastFrame()).toBe('idle')
  })

  it('forgets every size when the source changes', async () => {
    const c = controlled()
    const app = render(<Probe highlighted="webp" measure={c.measure} resetKey="a.png" />)
    await wait()
    c.pending.get('webp')?.resolve(41_800)
    await wait()
    app.rerender(<Probe highlighted="webp" measure={c.measure} resetKey="b.png" />)
    expect(app.lastFrame()).toBe('measuring')
  })
})

describe('SizeAside', () => {
  afterEach(() => setMotionForTests(undefined))
  const show = (node: React.ReactElement) =>
    render(<ThemeProvider palette={DARK}>{node}</ThemeProvider>).lastFrame() ?? ''

  it('says how much smaller', () => {
    expect(
      show(
        <SizeAside size={{ status: 'done', bytes: 74_600 }} sourceBytes={122_000} budget={40} />,
      ),
    ).toBe('74.6 KB  39% smaller')
  })

  it('says how much larger, in the larger colour', () => {
    const frame = show(
      <SizeAside size={{ status: 'done', bytes: 130_500 }} sourceBytes={122_000} budget={40} />,
    )
    expect(frame).toContain('7% larger')
  })

  it('says measuring while the encode runs', () => {
    setMotionForTests(false)
    expect(show(<SizeAside size={{ status: 'measuring' }} sourceBytes={1} budget={40} />)).toBe(
      'measuring…',
    )
  })

  it('says nothing when there is no room or nothing to say', () => {
    expect(
      show(<SizeAside size={{ status: 'done', bytes: 1 }} sourceBytes={2} budget={10} />),
    ).toBe('')
    expect(show(<SizeAside size={{ status: 'idle' }} sourceBytes={2} budget={40} />)).toBe('')
  })
})

describe('the format picker measures the highlighted format', () => {
  const ENTER = String.fromCharCode(13)
  const DOWN = `${String.fromCharCode(27)}[B`

  async function until(frame: () => string | undefined, ok: (f: string) => boolean) {
    for (let i = 0; i < 100; i++) {
      const f = frame() ?? ''
      if (ok(f)) return f
      await wait(30)
    }
    return frame() ?? ''
  }

  async function atPicker() {
    const { App } = await import('../../src/shell/App.js')
    const { DEFAULT_PREFERENCES } = await import('../../src/config/preferences.js')
    const { makePng, makeTempDir } = await import('../helpers/fixtures.js')
    const dir = await makeTempDir()
    const png = await makePng(dir, 'shot.png')
    const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
    const app = render(<App initialWidth={90} prefs={prefs} />)
    app.stdin.write(png)
    await wait(150)
    app.stdin.write(ENTER)
    await until(app.lastFrame, (f) => f.includes('▌'))
    return app
  }

  it('shows a real size and how it compares on the highlighted row only', async () => {
    const app = await atPicker()
    const frame = await until(app.lastFrame, (f) => /▌ \S+\s+[\d.]+ (B|KB) {2}/.test(f))
    const rows = frame.split('\n').filter((l) => /(smaller|larger|the same)/.test(l))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain('▌')
  })

  it('measures the next format once the highlight moves there', async () => {
    const app = await atPicker()
    await until(app.lastFrame, (f) => /(smaller|larger|the same)/.test(f))
    app.stdin.write(DOWN)
    const frame = await until(app.lastFrame, (f) => {
      const row = f.split('\n').find((l) => l.includes('▌')) ?? ''
      return /(smaller|larger|the same)/.test(row)
    })
    const row = frame.split('\n').find((l) => l.includes('▌')) ?? ''
    expect(row).toMatch(/[\d.]+ (B|KB)/)
  })
})
