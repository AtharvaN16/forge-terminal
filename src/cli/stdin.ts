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
  // We write the prompt manually to stderr instead.
  const nullOutput = new PassThrough()
  const rl = createInterface({ input: process.stdin, output: nullOutput, terminal: true })
  try {
    process.stderr.write('Password: ')
    // Use empty string for prompt since we already wrote it; readline would
    // append it to the line but we've handled it separately.
    return await new Promise<string>((resolve) => rl.question('', resolve))
  } finally {
    rl.close()
  }
}
