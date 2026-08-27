import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES } from '../../src/config/preferences.js'
import { App } from '../../src/shell/App.js'
import { makeMarkedPdf, makeTempDir } from '../helpers/fixtures.js'

const ENTER = String.fromCharCode(13)
const ESC = String.fromCharCode(27)
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms))

/**
 * A staged file has to be visible from every screen it affects.
 *
 * The reported bug: a PDF was staged, the user pressed escape back to the
 * prompt, and nothing on screen said so — the file card is deliberately
 * hidden for a lone file at idle, and (at the time this was written) the
 * mode line was unconditionally hidden during `/pdf`, before `/pdf` had a
 * real mode of its own to show. Between those two rules there was a state
 * showing neither, so `/compress` was typed against a file the user had
 * forgotten was there, and the refusal read as if it came from nowhere.
 */
async function stagePdfAtIdle() {
  const dir = await makeTempDir()
  const file = await makeMarkedPdf(dir, 'resonance_brochure.pdf', [1, 2, 3])
  const prefs = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, defaultOutput: dir }
  const app = render(<App initialWidth={100} prefs={prefs} />)
  app.stdin.write(file)
  await settle()
  app.stdin.write(ENTER) // a PDF has real targets now, so this opens the picker
  await settle(400)
  app.stdin.write(ESC) // back to idle, still staged
  await settle(300)
  return app
}

describe('the staged file is never invisible', () => {
  it('names the staged PDF at the idle prompt', async () => {
    const { lastFrame } = await stagePdfAtIdle()
    const frame = lastFrame() ?? ''
    // Positive first: prove we are actually at the prompt and not on a
    // blank frame, so the name assertion below cannot pass vacuously.
    expect(frame).toContain('drop a file or type a path')
    expect(frame).toContain('resonance_brochure.pdf')
  })

  it('says where you are inside /pdf, with a real pdf mode of its own', async () => {
    const { stdin, lastFrame } = await stagePdfAtIdle()
    stdin.write('/pdf')
    await settle()
    stdin.write(ENTER)
    await settle(400)
    const frame = lastFrame() ?? ''
    expect(frame).toContain('PDF — choose an operation')
    // The staged file stays named here too.
    expect(frame).toContain('resonance_brochure.pdf')
    // `mode` is genuinely 'pdf' here now — `/pdf` arms it the same way
    // `/compress` arms 'compress' — so the banner says so rather than being
    // suppressed as a would-be lie about still being in convert mode.
    expect(frame).toContain('current mode: pdf')
  })
})

describe('a change of flow is fenced off from what came before', () => {
  it('rules a line between a refusal and the /pdf screen it is not part of', async () => {
    // The reported confusion: a compress refusal stayed on screen after
    // entering /pdf, directly above the operation list, reading as though
    // it belonged to the menu the user was now looking at. The dashed rule
    // already exists for finished results; a change of flow deserves it for
    // the same reason — one session, several separate operations.
    const { stdin, lastFrame } = await stagePdfAtIdle()

    stdin.write('/compress')
    await settle()
    stdin.write(ENTER)
    await settle(400)
    const refused = lastFrame() ?? ''
    expect(refused).toContain('cannot compress a PDF yet')

    stdin.write('/pdf')
    await settle()
    stdin.write(ENTER)
    await settle(400)
    const frame = lastFrame() ?? ''
    // Positive first: we really are on the PDF screen.
    expect(frame).toContain('PDF — choose an operation')
    // And the refusal is now behind a rule rather than floating above it.
    expect(frame).toContain('╍')
  })
})
