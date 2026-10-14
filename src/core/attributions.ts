/**
 * Who Forge is built on, for /about's Attributions tab: data only. The full
 * licence texts of everything bundled are in `third-party-licenses.txt`,
 * which the build writes beside the bundle; this names the parts.
 */

export interface Credit {
  name: string
  licence: string
  /** What the part does in Forge, for the main ones. */
  does?: string
}

export interface CreditSection {
  title: 'App' | 'Extensions' | 'Others'
  credits: Credit[]
}

/** The parts that do Forge's real work, and the packages each one stands for. */
const APP: Array<Credit & { packages: string[] }> = [
  {
    name: 'sharp · libvips',
    licence: 'Apache-2.0 · LGPL-3.0',
    does: 'images',
    packages: ['sharp'],
  },
  { name: 'PDFium', licence: 'BSD-3-Clause', does: 'PDF pages', packages: [] },
  { name: 'pdf-lib', licence: 'MIT', does: 'writing PDFs', packages: ['pdf-lib'] },
  {
    name: 'mammoth · docx',
    licence: 'BSD-2-Clause · MIT',
    does: 'Word documents',
    packages: ['mammoth', 'docx'],
  },
  { name: 'Ink · React', licence: 'MIT', does: 'this screen', packages: ['ink', 'react'] },
]

/**
 * Installed beside the bundle rather than inlined (package.json
 * `dependencies`), so the licence file, which only covers the bundle, does
 * not name them.
 */
const NATIVE: Credit[] = [{ name: '@hyzyla/pdfium', licence: 'MIT' }]

/** Data compiled into the source rather than a package, so no licence file names it. */
const DATA: Credit[] = [{ name: 'xkcd colour survey', licence: 'CC0-1.0' }]

/**
 * Every package in the build's licence file: its sections start
 * `name@version — licence`. A licence the package wrote as an SPDX
 * expression loses its outer brackets.
 */
export function parseLicences(text: string): Credit[] {
  const out: Credit[] = []
  for (const line of text.split('\n')) {
    const m = /^((?:@[^/\s]+\/)?[^@\s]+)@\S+ — (.+)$/.exec(line)
    if (!m) continue
    out.push({ name: m[1] as string, licence: (m[2] as string).replace(/^\((.*)\)$/, '$1') })
  }
  return out
}

const sortKey = (c: Credit) => c.name.replace(/^@/, '')

/**
 * The tab's sections: the app's main parts, what the installed extensions
 * brought, then every other package A–Z. Extensions is left out when none is
 * installed.
 */
export function attributions({
  bundled,
  extensions,
}: {
  bundled: Credit[]
  extensions: Credit[]
}): CreditSection[] {
  const named = new Set(APP.flatMap((c) => c.packages))
  const others = [...bundled.filter((c) => !named.has(c.name)), ...NATIVE, ...DATA].sort((a, b) =>
    sortKey(a).localeCompare(sortKey(b)),
  )
  return [
    { title: 'App', credits: APP.map(({ packages: _, ...c }) => c) },
    ...(extensions.length > 0 ? [{ title: 'Extensions' as const, credits: extensions }] : []),
    { title: 'Others', credits: others },
  ]
}
