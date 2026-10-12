import { describe, expect, it } from 'vitest'
import { imageProtocol, inlineImageSequence, KITTY_CHUNK } from '../../src/shell/inline-image.js'

const ESC = '\u001b'

describe('imageProtocol', () => {
  it.each([
    [{ TERM_PROGRAM: 'iTerm.app' }, 'iterm'],
    [{ TERM_PROGRAM: 'WezTerm' }, 'iterm'],
    [{ TERM: 'xterm-kitty' }, 'kitty'],
    [{ TERM: 'xterm-ghostty' }, 'kitty'],
    [{ KITTY_WINDOW_ID: '1' }, 'kitty'],
    [{ GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app/Contents/Resources/ghostty' }, 'kitty'],
    [{ TERM_PROGRAM: 'Apple_Terminal' }, null],
    [{ TERM_PROGRAM: 'vscode' }, null],
    [{}, null],
    [{ TERM_PROGRAM: 'iTerm.app', NO_COLOR: '1' }, null],
    [{ TERM: 'xterm-kitty', NO_COLOR: '1' }, null],
    [{ TERM_PROGRAM: 'iTerm.app', FORGE_INLINE_IMAGES: '0' }, null],
    [{ TERM_PROGRAM: 'Apple_Terminal', FORGE_INLINE_IMAGES: '1' }, 'iterm'],
    [{ TERM_PROGRAM: 'tmux', KITTY_WINDOW_ID: '1' }, null],
    [{ TERM_PROGRAM: 'iTerm.app', TMUX: '/tmp/tmux-501/default,1,0' }, null],
    // VS Code opened from Ghostty inherits Ghostty's variables, and draws no pictures.
    [{ TERM_PROGRAM: 'vscode', GHOSTTY_RESOURCES_DIR: '/Applications/Ghostty.app' }, null],
    [{ TERM_PROGRAM: 'ghostty', TERM: 'xterm-ghostty' }, 'kitty'],
    [{ TERM_PROGRAM: 'iTerm.app', ZELLIJ: '0' }, null],
    [{ TERM_PROGRAM: 'iTerm.app', STY: '123.pts-0' }, null],
    // Forced on: the protocol this terminal speaks.
    [{ TERM: 'xterm-kitty', FORGE_INLINE_IMAGES: '1' }, 'kitty'],
    [{ TERM_PROGRAM: 'tmux', KITTY_WINDOW_ID: '1', FORGE_INLINE_IMAGES: '1' }, 'kitty'],
  ] as const)('%o → %s', (env, want) => {
    expect(imageProtocol(env)).toBe(want)
  })
})

describe('inlineImageSequence', () => {
  it("is iTerm2's OSC 1337 File=, sized in cells, the whole PNG in base64, ended by BEL", () => {
    const png = Buffer.from('not really a png, but bytes all the same')
    const seq = inlineImageSequence(png, 36, 16, 'iterm')
    expect(seq).toBe(
      `${ESC}]1337;File=inline=1;size=${png.length};width=36;height=16;preserveAspectRatio=1;doNotMoveCursor=1:${png.toString('base64')}\u0007`,
    )
  })

  it('is Kitty APC G in 4096-byte chunks, keys on the first, m=1 until the last', () => {
    const png = Buffer.alloc(10_000, 7)
    const seq = inlineImageSequence(png, 36, 16, 'kitty', 42)
    const chunks = [...seq.matchAll(new RegExp(`${ESC}_G([^;]*);([^${ESC}]*)${ESC}\\\\`, 'g'))]
    expect(chunks.map((c) => c[0]).join('')).toBe(seq)
    const data = png.toString('base64')
    expect(chunks).toHaveLength(Math.ceil(data.length / KITTY_CHUNK))
    expect(chunks[0]?.[1]).toBe('a=T,f=100,c=36,r=16,C=1,q=2,i=42,m=1')
    expect(chunks.slice(1, -1).every((c) => c[1] === 'm=1')).toBe(true)
    expect(chunks.at(-1)?.[1]).toBe('m=0')
    expect(chunks.slice(0, -1).every((c) => c[2]?.length === KITTY_CHUNK)).toBe(true)
    expect(chunks.map((c) => c[2]).join('')).toBe(data)
  })

  it('sends a small picture to Kitty in one chunk', () => {
    const seq = inlineImageSequence(Buffer.from('tiny'), 4, 2, 'kitty')
    expect(seq).toBe(`${ESC}_Ga=T,f=100,c=4,r=2,C=1,q=2,m=0;dGlueQ==${ESC}\\`)
  })
})
