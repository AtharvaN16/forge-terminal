const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/**
 * When a file was last changed, the way Name taken says it beside its size:
 * "today, 09:05", "yesterday, 18:42", "3 Sep", or "24 Dec 2025" in another
 * year. Enough to tell an old file from one written a minute ago.
 */
export function describeAge(modified: Date, now: Date = new Date()): string {
  const time = `${String(modified.getHours()).padStart(2, '0')}:${String(modified.getMinutes()).padStart(2, '0')}`
  if (sameDay(modified, now)) return `today, ${time}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(modified, yesterday)) return `yesterday, ${time}`
  const day = `${modified.getDate()} ${MONTHS[modified.getMonth()]}`
  return modified.getFullYear() === now.getFullYear() ? day : `${day} ${modified.getFullYear()}`
}
