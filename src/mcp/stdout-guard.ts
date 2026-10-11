import { Writable } from 'node:stream'

/**
 * Claims stdout for the protocol (spec §3.5: stdout belongs to the protocol).
 *
 * It returns a stream that writes to the real stdout, for the transport.
 * After this call, anything else that writes to `out` lands on `err` instead:
 * a `console.log` in a dependency, or an emscripten `print` from the pdfium
 * wasm. One stray line on stdout would corrupt the JSON-RPC stream and end
 * the session. Invariant 1 already keeps core/ and engines/ silent. This
 * guards against libraries.
 */
export function claimStdout(
  out: NodeJS.WriteStream = process.stdout,
  err: NodeJS.WriteStream = process.stderr,
): Writable {
  const write = out.write.bind(out)
  out.write = err.write.bind(err) as typeof out.write
  return new Writable({
    write(chunk, encoding, callback) {
      write(chunk, encoding, callback)
    },
  })
}
