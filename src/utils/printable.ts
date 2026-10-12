/**
 * C0 controls, DEL, C1 controls (0x9b is a one-byte CSI to some terminals),
 * and the bidi embeddings, overrides and isolates that make "photo‮gpj.exe"
 * read as "photoexe.jpg".
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g

/**
 * A file name as text the terminal will only print. A name can carry an
 * escape sequence — one that sets the window title or, in some terminals,
 * the clipboard — and printed raw, the terminal would act on it. Display
 * only: the path itself is never rewritten, so the file still opens.
 */
export function printable(text: string): string {
  return text.replace(UNPRINTABLE, '?')
}
