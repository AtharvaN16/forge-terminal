import { execFile, execFileSync, spawn } from 'node:child_process'
import { linuxBackends } from '../utils/pasteboard.js'

/**
 * The system clipboard as text: macOS's own `pbcopy` / `pbpaste`, Windows'
 * `clip.exe` and PowerShell, and on Linux wl-clipboard (Wayland) or xclip or
 * xsel (X11).
 *
 * `execFile`, never `execSync` with an interpolated string: no shell means no
 * quoting surface for a path that contains a quote, a backtick, or a newline —
 * and paths in this app come straight from the user.
 *
 * Not OSC 52. That escape-sequence protocol is what you reach for over SSH,
 * but Terminal.app — the terminal this app is built for — does not implement
 * it, and its read side is a clipboard-exfiltration channel for anything
 * sharing the session. `pbpaste` has neither problem locally.
 */

/**
 * `LANG` is forced because `pbcopy` falls back to the C encoding when the
 * locale does not name one, and a path with an accent or a CJK character
 * would round-trip as mojibake.
 */
const env = () => ({ ...process.env, LANG: process.env.LANG ?? 'en_US.UTF-8' })

/**
 * Fire-and-forget: a clipboard that could not be written is not worth
 * interrupting the flow for, and there is nothing useful to say about it. The
 * `.catch` is not optional though — an unhandled rejection would take the
 * process down, which is the one outcome worse than a failed copy.
 */
export function copy(
  text: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (text === '') return
  if (platform === 'linux') {
    copyOnLinux(Buffer.from(text, 'utf8'), linuxText(environment, 'copy'))
    return
  }
  if (platform === 'win32') {
    try {
      const child = execFile('clip.exe', () => {})
      child.on('error', () => {})
      // UTF-16LE with a BOM: `clip.exe` reads stdin in the console's OEM code
      // page unless it sees a BOM, and a path with an accent would paste as
      // mojibake. The BOM is what makes it decode the bytes as Unicode.
      child.stdin?.end(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]))
    } catch {
      // No clip.exe (a stripped environment). Same rule as below: never fatal.
    }
    return
  }
  try {
    const child = execFile('pbcopy', { env: env() }, () => {})
    child.on('error', () => {})
    // A Buffer, not a string: writing a string re-encodes it through the
    // stream's default encoding, which is not necessarily UTF-8.
    child.stdin?.end(Buffer.from(text, 'utf8'))
  } catch {
    // No pbcopy (not macOS, or a stripped environment). Copying is a
    // convenience; losing it must never be fatal.
  }
}

/**
 * Synchronous because the caller is a keystroke handler that has to insert the
 * text into the buffer before the next render. `pbpaste` is a local process
 * that returns in single-digit milliseconds, so this does not stall the UI in
 * any way a person can perceive.
 */
export function paste(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'linux') return pasteOnLinux(linuxText(environment, 'paste'))
  if (platform === 'win32') {
    try {
      const out = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // Output encoding is forced to UTF-8; the default would be the OEM
          // code page and an accented path would come back mangled.
          '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Clipboard -Raw',
        ],
        // 5 s, not pbpaste's 2: a cold PowerShell start alone can take most
        // of 2 s, and running out pastes nothing, silently.
        { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 5000 },
      )
      // PowerShell ends its output with a line break the clipboard never had.
      return out.toString('utf8').replace(/\r\n$/, '')
    } catch {
      return ''
    }
  }
  try {
    const out = execFileSync('pbpaste', {
      encoding: 'buffer',
      env: env(),
      // The default is 1 MB and it *throws* rather than truncating. A
      // clipboard holding a large document is not this app's business, but it
      // must not crash it either.
      maxBuffer: 64 * 1024 * 1024,
      timeout: 2000,
    })
    return out.toString('utf8')
  } catch {
    return ''
  }
}

/**
 * The commands for Linux's clipboard, the desktop's own first (as the image
 * clipboard picks them, `linuxBackends`). X11 has two common ones; xclip is
 * tried first, xsel where it is the one installed.
 *
 * Paste asks for text by name: given no type, `wl-paste` hands over whatever
 * is held, and a copied picture would land in the field as bytes.
 */
export function linuxText(
  environment: NodeJS.ProcessEnv,
  direction: 'copy' | 'paste',
): [string, string[]][] {
  return linuxBackends(environment).flatMap((b): [string, string[]][] =>
    b.name === 'wayland'
      ? direction === 'copy'
        ? [['wl-copy', ['--type', 'text/plain;charset=utf-8']]]
        : [['wl-paste', ['--no-newline', '--type', 'text']]]
      : direction === 'copy'
        ? [
            ['xclip', ['-selection', 'clipboard', '-i']],
            ['xsel', ['--clipboard', '--input']],
          ]
        : [
            ['xclip', ['-selection', 'clipboard', '-o']],
            ['xsel', ['--clipboard', '--output']],
          ],
  )
}

/**
 * `spawn` with no pipe back, not `execFile`: wl-copy, xclip and xsel all fork
 * and leave a child holding the copy until something else is copied, and a
 * pipe that child inherited would keep Forge running as long. Detached, so
 * the copy outlives the terminal, as it does on a Mac. A command that is not
 * installed moves on to the next; none at all is the same quiet failure as a
 * Mac without pbcopy.
 */
function copyOnLinux(bytes: Buffer, commands: [string, string[]][]): void {
  const [first, ...rest] = commands
  if (!first) return
  try {
    const child = spawn(first[0], first[1], { stdio: ['pipe', 'ignore', 'ignore'], detached: true })
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') copyOnLinux(bytes, rest)
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(bytes)
    child.unref()
  } catch {
    copyOnLinux(bytes, rest)
  }
}

function pasteOnLinux(commands: [string, string[]][]): string {
  for (const [cmd, args] of commands) {
    try {
      const out = execFileSync(cmd, args, {
        encoding: 'buffer',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 2000,
        // Not 'pipe' for stdin: xclip -o would otherwise wait on it.
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return out.toString('utf8')
    } catch (e) {
      // Installed but holding no text: that is the answer. Not installed:
      // the next command may be.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') return ''
    }
  }
  return ''
}
