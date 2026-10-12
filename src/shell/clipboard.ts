import { execFile, execFileSync } from 'node:child_process'

/**
 * The system clipboard, via macOS's own `pbcopy` / `pbpaste`.
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
export function copy(text: string, platform: NodeJS.Platform = process.platform): void {
  if (text === '') return
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
export function paste(platform: NodeJS.Platform = process.platform): string {
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
