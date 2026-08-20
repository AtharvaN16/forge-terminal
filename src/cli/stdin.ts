import { createInterface } from 'node:readline'

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

  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true })
  try {
    // Prompt on stderr so a piped stdout stays clean.
    return await new Promise<string>((resolve) => rl.question('Password: ', resolve))
  } finally {
    rl.close()
  }
}
