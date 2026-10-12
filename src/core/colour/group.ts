/**
 * k-means in OKLab on typed arrays, then two clean-ups: centres closer than
 * `merge` are joined, and groups under `minShare` are dissolved into the
 * nearest one that stays. Deterministic: the first centre is the mean, each
 * next one the point farthest from all centres so far (ties: lowest index).
 */
export interface GroupOptions {
  k: number
  /** ΔE in OKLab below which two centres become one. */
  merge: number
  /** Fraction of the points below which a group is dissolved. */
  minShare: number
}

export type Centre = [number, number, number]

export interface RawGroup {
  centre: Centre
  /** Positions into the input arrays. */
  members: number[]
}

interface Points {
  L: Float64Array
  A: Float64Array
  B: Float64Array
}

const d2 = (p: Points, i: number, c: Centre): number =>
  ((p.L[i] as number) - c[0]) ** 2 +
  ((p.A[i] as number) - c[1]) ** 2 +
  ((p.B[i] as number) - c[2]) ** 2

function seed(p: Points, k: number): Centre[] {
  const n = p.L.length
  const mean: Centre = [0, 0, 0]
  for (let i = 0; i < n; i++) {
    mean[0] += p.L[i] as number
    mean[1] += p.A[i] as number
    mean[2] += p.B[i] as number
  }
  const centres: Centre[] = [[mean[0] / n, mean[1] / n, mean[2] / n]]
  const nearest = new Float64Array(n).fill(Number.POSITIVE_INFINITY)
  while (centres.length < k) {
    const last = centres[centres.length - 1] as Centre
    let far = 0
    let farD = -1
    for (let i = 0; i < n; i++) {
      const d = d2(p, i, last)
      if (d < (nearest[i] as number)) nearest[i] = d
      if ((nearest[i] as number) > farD) {
        farD = nearest[i] as number
        far = i
      }
    }
    centres.push([p.L[far] as number, p.A[far] as number, p.B[far] as number])
  }
  return centres
}

/** Hot: runs for every pixel on every iteration, so a plain loop, not forEach. */
function closest(p: Points, i: number, centres: Centre[]): number {
  let best = 0
  let bestD = Number.POSITIVE_INFINITY
  for (let ci = 0; ci < centres.length; ci++) {
    const d = d2(p, i, centres[ci] as Centre)
    if (d < bestD) {
      bestD = d
      best = ci
    }
  }
  return best
}

function kmeans(p: Points, k: number): RawGroup[] {
  const n = p.L.length
  const centres = seed(p, k)
  const owner = new Int32Array(n).fill(-1)
  for (let it = 0; it < 30; it++) {
    let moved = 0
    for (let i = 0; i < n; i++) {
      const best = closest(p, i, centres)
      if (owner[i] !== best) {
        owner[i] = best
        moved++
      }
    }
    const sum = centres.map(() => [0, 0, 0, 0])
    for (let i = 0; i < n; i++) {
      const s = sum[owner[i] as number] as number[]
      s[0] = (s[0] as number) + (p.L[i] as number)
      s[1] = (s[1] as number) + (p.A[i] as number)
      s[2] = (s[2] as number) + (p.B[i] as number)
      s[3] = (s[3] as number) + 1
    }
    sum.forEach(([l, a, b, c], ci) => {
      if (c) centres[ci] = [(l as number) / c, (a as number) / c, (b as number) / c]
    })
    if (moved === 0) break
  }
  const groups: RawGroup[] = centres.map((centre) => ({ centre, members: [] }))
  for (let i = 0; i < n; i++) groups[owner[i] as number]?.members.push(i)
  return groups.filter((g) => g.members.length > 0)
}

function mergeClose(groups: RawGroup[], threshold: number): RawGroup[] {
  let out = groups
  for (;;) {
    let pair: [number, number] | undefined
    let pairD = threshold ** 2
    for (let a = 0; a < out.length; a++) {
      for (let b = a + 1; b < out.length; b++) {
        const x = (out[a] as RawGroup).centre
        const y = (out[b] as RawGroup).centre
        const d = (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2
        if (d < pairD) {
          pairD = d
          pair = [a, b]
        }
      }
    }
    if (!pair) return out
    const [ia, ib] = pair
    const a = out[ia] as RawGroup
    const b = out[ib] as RawGroup
    const na = a.members.length
    const nb = b.members.length
    const centre = a.centre.map((v, j) => (v * na + (b.centre[j] as number) * nb) / (na + nb))
    out = out.filter((_, i) => i !== ia && i !== ib)
    out.push({ centre: centre as Centre, members: [...a.members, ...b.members] })
  }
}

/** Dissolve groups under `minShare` into the nearest kept one; the largest always stays. */
function dissolveSmall(p: Points, groups: RawGroup[], minShare: number): RawGroup[] {
  const n = p.L.length
  const sorted = [...groups].sort((x, y) => y.members.length - x.members.length)
  const keep = sorted.filter((g, i) => i === 0 || g.members.length / n >= minShare)
  const centres = keep.map((g) => g.centre)
  for (const g of sorted) {
    if (keep.includes(g)) continue
    for (const i of g.members) (keep[closest(p, i, centres)] as RawGroup).members.push(i)
  }
  return keep
}

export function group(
  L: Float64Array,
  A: Float64Array,
  B: Float64Array,
  opts: GroupOptions,
): RawGroup[] {
  const n = L.length
  if (n === 0) return []
  const p = { L, A, B }
  const merged = mergeClose(kmeans(p, Math.min(opts.k, n)), opts.merge)
  return dissolveSmall(p, merged, opts.minShare)
}
