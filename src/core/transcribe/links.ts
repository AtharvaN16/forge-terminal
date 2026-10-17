/**
 * YouTube links, as typed or pasted into transcribe (spec
 * 2026-10-17-transcribe-design §4.2). Pure: this only reads the text; whether
 * the video exists is yt-dlp's to say.
 */
export type Link = { kind: 'video'; id: string; url: string } | { kind: 'playlist' }

const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const video = (id: string | null | undefined): Link | undefined =>
  id && VIDEO_ID.test(id)
    ? { kind: 'video', id, url: `https://www.youtube.com/watch?v=${id}` }
    : undefined

/**
 * The YouTube video or playlist `text` names, or `undefined` when it is not a
 * YouTube link. A video opened from a playlist is that video alone: one video
 * per run.
 */
export function readLink(text: string): Link | undefined {
  const raw = text.trim()
  if (raw === '') return undefined
  let url: URL
  try {
    url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return undefined
  }
  const host = url.hostname.toLowerCase()
  if (host === 'youtu.be') return video(url.pathname.slice(1).split('/')[0])
  if (!HOSTS.has(host)) return undefined
  const [first, second] = url.pathname.split('/').filter(Boolean)
  if (first === 'watch') return video(url.searchParams.get('v'))
  if (first === 'shorts' || first === 'live') return video(second)
  if (first === 'playlist' && url.searchParams.get('list')) return { kind: 'playlist' }
  return undefined
}
