import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'
import type { CreditSection } from '../../src/core/attributions.js'
import { AboutFlow, type AboutSystem } from '../../src/shell/flows/about.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const TAB = '\t'
const DOWN = `${ESC}[B`
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
}
const tick = () => new Promise((r) => setTimeout(r, 50))

const OTHERS = Array.from({ length: 40 }, (_, i) => ({
  name: `package-${String(i).padStart(2, '0')}`,
  licence: 'MIT',
}))
const SECTIONS: CreditSection[] = [
  {
    title: 'App',
    credits: [{ name: 'sharp · libvips', licence: 'Apache-2.0 · LGPL-3.0', does: 'images' }],
  },
  {
    title: 'Extensions',
    credits: [{ name: 'ONNX Runtime', licence: 'MIT', does: 'Boost resolution' }],
  },
  { title: 'Others', credits: OTHERS },
]

function fakeSystem() {
  const calls = { urls: [] as string[], files: [] as string[] }
  const system: AboutSystem = {
    async openUrl(url) {
      calls.urls.push(url)
    },
    async openFile(path) {
      calls.files.push(path)
    },
    async credits() {
      return { sections: SECTIONS, file: '/x/third-party-licenses.txt' }
    },
  }
  return { system, calls }
}

const open = (system: AboutSystem, onClose = vi.fn()) =>
  render(<AboutFlow width={80} height={24} version="0.3.1" system={system} onClose={onClose} />)
const frame = (f: ReturnType<typeof open>) => f.lastFrame() ?? ''
const lines = (f: ReturnType<typeof open>) => frame(f).split('\n')

describe('AboutFlow', () => {
  it('signs the bar “by Atharva Nayak” and names Forge and its version', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('GitHub'))
    expect(lines(f)[0]).toMatch(/about.*by Atharva Nayak/)
    expect(frame(f)).toContain('Forge 0.3.1')
    expect(frame(f)).not.toContain('Made by')
  })

  it('has the two tabs, About first', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('GitHub'))
    expect(frame(f)).toMatch(/About\s+Attributions/)
  })

  it('shows the three links as pills in one row, and the chosen one’s address under them', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('GitHub'))
    expect(lines(f).find((l) => l.includes('GitHub ↗'))).toMatch(
      /GitHub ↗\]?\s+Portfolio ↗\]?\s+Report a bug ↗/,
    )
    expect(frame(f)).toContain('github.com/AtharvaN16')
    expect(frame(f)).not.toContain('atharvanayak.design')
  })

  it('←→ choose a pill and ↵ opens it in the browser', async () => {
    const { system, calls } = fakeSystem()
    const f = open(system)
    await until(() => frame(f).includes('GitHub'))
    await tick()
    f.stdin.write(RIGHT)
    await until(() => frame(f).includes('atharvanayak.design'))
    f.stdin.write(ENTER)
    await until(() => calls.urls.length > 0)
    expect(calls.urls).toEqual(['https://atharvanayak.design/'])
    f.stdin.write(RIGHT)
    await until(() => frame(f).includes('forge-terminal/issues'))
    f.stdin.write(ENTER)
    await until(() => calls.urls.length > 1)
    expect(calls.urls[1]).toBe('https://github.com/AtharvaN16/forge-terminal/issues')
    f.stdin.write(LEFT)
    f.stdin.write(LEFT)
    await until(() => frame(f).includes('github.com/AtharvaN16') && !frame(f).includes('issues'))
    f.stdin.write(ENTER)
    await until(() => calls.urls.length > 2)
    expect(calls.urls[2]).toBe('https://github.com/AtharvaN16')
  })

  it('tab opens Attributions: App, Extensions and Others, with what is still below', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('GitHub'))
    await tick()
    f.stdin.write(TAB)
    await until(() => frame(f).includes('sharp · libvips'))
    expect(frame(f)).toMatch(/sharp · libvips\s+Apache-2\.0 · LGPL-3\.0\s+images/)
    expect(frame(f)).toContain('Extensions')
    expect(frame(f)).toContain('Others')
    expect(frame(f)).toMatch(/↓ \d+ more/)
    expect(frame(f)).not.toContain('package-39')
    expect(frame(f)).not.toContain('GitHub ↗')
  })

  it('↓ scrolls the list to its end, where nothing is said to be below', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('GitHub'))
    await tick()
    f.stdin.write(TAB)
    await until(() => frame(f).includes('sharp · libvips'))
    for (let i = 0; i < 60; i++) f.stdin.write(DOWN)
    await until(() => frame(f).includes('package-39'))
    expect(frame(f)).not.toMatch(/↓ \d+ more/)
    expect(frame(f)).not.toContain('sharp · libvips')
  })

  it('↵ on Attributions opens the full licence texts', async () => {
    const { system, calls } = fakeSystem()
    const f = open(system)
    await until(() => frame(f).includes('GitHub'))
    await tick()
    f.stdin.write(TAB)
    await until(() => frame(f).includes('sharp · libvips'))
    f.stdin.write(ENTER)
    await until(() => calls.files.length > 0)
    expect(calls.files).toEqual(['/x/third-party-licenses.txt'])
  })

  it('does not offer the licence texts when there is no file', async () => {
    const { system } = fakeSystem()
    const f = open({ ...system, credits: async () => ({ sections: SECTIONS }) })
    await until(() => frame(f).includes('GitHub'))
    await tick()
    f.stdin.write(TAB)
    await until(() => frame(f).includes('sharp · libvips'))
    expect(frame(f)).not.toContain('licence texts')
  })

  it('tab comes back to About, and esc closes', async () => {
    const onClose = vi.fn()
    const f = open(fakeSystem().system, onClose)
    await until(() => frame(f).includes('GitHub'))
    await tick()
    f.stdin.write(TAB)
    await until(() => frame(f).includes('sharp · libvips'))
    f.stdin.write(TAB)
    await until(() => frame(f).includes('GitHub ↗'))
    f.stdin.write(ESC)
    await until(() => onClose.mock.calls.length > 0)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('puts its keys on the window’s last row', async () => {
    const f = open(fakeSystem().system)
    await until(() => frame(f).includes('GitHub'))
    const all = lines(f)
    expect(all).toHaveLength(24)
    expect(all[23]).toMatch(/choose.*open.*tab.*esc back/)
  })
})
