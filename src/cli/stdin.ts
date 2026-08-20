import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'

/**
 * A password, never from argv.
 *
 * An argument lands in shell history and in `ps` output, and PDF passwords
 * are reused often enough that leaking one leaks more than one file. Reading
 * stdin or prompting costs the same keystrokes and avoids both.
 */
export async function readPassword(opts: { stdin: boolean }): Promise<string> {
  if (opts.stdin) {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
      .toString('utf8')
      .replace(/\r?\n$/, '')
  }

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
