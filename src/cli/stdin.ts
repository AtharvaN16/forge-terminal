import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'

/**
 * The first line of `input`, without its line ending, after which the stream
 * is let go.
 *
 * It reads one line rather than reading until EOF. An agent harness often gives
 * Forge a stdin pipe, writes the password to it, and never closes it. Reading
 * to EOF waited on that pipe forever (spec §3.1).
 *
 * If the stream ends before a newline arrives (`echo -n`), readline still emits
 * what was sent as a final line. If it ends with nothing at all, the result is ''.
 *
 * Pausing and unref-ing afterwards is what lets the process exit while the
 * writer still holds the pipe open. readline's close() pauses the stream but
 * leaves its handle keeping the event loop alive.
 */
function readFirstLine(input: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input, terminal: false })
    let done = false
    const finish = (line: string) => {
      if (done) return
      done = true
      rl.close()
      input.pause()
      const handle = input as { unref?: () => void }
      handle.unref?.()
      resolve(line.replace(/\r$/, ''))
    }
    rl.once('line', finish)
    rl.once('close', () => finish(''))
  })
}

/**
 * A password, never from argv.
 *
 * An argument lands in shell history and in `ps` output, and PDF passwords
 * are reused often enough that leaking one leaks more than one file. Reading
 * stdin or prompting costs the same keystrokes and avoids both.
 *
 * Returns `undefined` when there is no way to ask: `--password-stdin` was not
 * given and stdin is not a terminal. Forge never prompts without a TTY. A prompt
 * nobody can see hangs forever on an open pipe, and on a closed one it left Node
 * to exit 13 on an await that could never settle. The caller refuses with
 * `encrypted-source` instead, and that error's hint names --password-stdin.
 */
export async function readPassword(opts: { stdin: boolean }): Promise<string | undefined> {
  if (opts.stdin) return readFirstLine(process.stdin)
  if (!process.stdin.isTTY) return undefined

  // Use a null stream for readline's output to prevent echoing typed characters.
  // readline writes input echo to this stream, which we buffer but do not forward to
  // stderr. We write the prompt manually to stderr instead, and supply the newline
  // after the user presses Enter, since readline's line-submit writes to the buffered
  // output stream that never reaches the terminal.
  const nullOutput = new PassThrough()
  // CRITICAL: terminal:true engages raw mode on real TTYs, disabling OS line discipline
  // echo. Dropping this flag causes the kernel to echo typed characters in plaintext.
  // No test catches this regression — the test suite uses Readable.from() which is
  // never a TTY, so has no kernel echo to suppress. This only breaks on real terminals.
  const rl = createInterface({ input: process.stdin, output: nullOutput, terminal: true })
  try {
    process.stderr.write('Password: ')
    // Use empty string for prompt since we already wrote it; readline would
    // append it to the line but we've handled it separately.
    return await new Promise<string>((resolve) => rl.question('', resolve))
  } finally {
    process.stderr.write('\n')
    // Releases stdin: readline removes its 'keypress' listener and pauses the stream.
    // The finally guarantees it runs whether the promise resolves or rejects.
    // Covered by 'releases stdin when the prompt completes' in tests/cli/stdin.test.ts,
    // which asserts no 'keypress' listener survives. That test must feed stdin from a
    // stream that stays open — Readable.from() ends immediately and readline auto-closes
    // on the input's 'end' event, which would mask this call and make the test hollow.
    rl.close()
  }
}
