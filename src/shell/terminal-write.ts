/**
 * Writes a control sequence to the terminal.
 *
 * A named seam rather than `process.stdout.write` at the call site, so tests
 * can observe the sequence without a TTY and so the `isTTY` gate is stated
 * once. Control sequences are not the frame: a piped or redirected run must
 * never receive them (the frame is the product's output, and nothing that is
 * not the frame belongs in it).
 */
export function writeToTerminal(sequence: string, stream?: NodeJS.WriteStream): void {
  const out = stream ?? process.stdout
  if (!out.isTTY) return
  out.write(sequence)
}
