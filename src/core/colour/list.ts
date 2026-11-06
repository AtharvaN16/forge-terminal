/**
 * A list of named colours read out of text, for `forge card` (colour spec
 * §7.3). What the text is, is read from what it holds, never from a file
 * name: JSON design tokens, a CSV with a header, CSS custom properties, or
 * one "name colour" a line as people and agents write them. Data only.
 */
import { parseColour } from './parse.js'
import { toHex } from './space.js'

export interface NamedColour {
  name: string
  /** #RRGGBB, upper case */
  hex: string
  /** 0–1, only when the colour is see-through */
  alpha?: number
}

export interface ColourList {
  colours: NamedColour[]
  /** What could not be read, as written: a line, or `name: value` for a token. */
  bad: string[]
}

function named(name: string, value: string): NamedColour | undefined {
  const parsed = parseColour(value)
  if (!parsed) return undefined
  const alpha = parsed.alpha !== undefined && parsed.alpha < 1 ? parsed.alpha : undefined
  return { name, hex: toHex(parsed.rgb), ...(alpha === undefined ? {} : { alpha }) }
}

export function readColourList(text: string): ColourList {
  const t = text.replace(/^﻿/, '').trim()
  if (t === '') return { colours: [], bad: [] }
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return fromJson(JSON.parse(t) as unknown)
    } catch {
      // Not JSON after all: read it as lines.
    }
  }
  return fromLines(t.split(/\r?\n/))
}

// ── JSON ─────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const COLOUR_KEYS = ['hex', 'colour', 'color', 'value', '$value']

function fromJson(doc: unknown): ColourList {
  const out: ColourList = { colours: [], bad: [] }
  if (Array.isArray(doc)) {
    for (const item of doc) {
      if (!isObj(item)) continue
      const name = typeof item.name === 'string' ? item.name : undefined
      const key = COLOUR_KEYS.find((k) => typeof item[k] === 'string')
      if (!name || !key) continue
      const value = item[key] as string
      const c = named(name, value)
      if (c) out.colours.push(c)
      else out.bad.push(`${name}: ${value}`)
    }
    return out
  }
  if (!isObj(doc)) return out
  // A lone top-level group, such as DTCG's usual `color`, names nothing.
  const keys = Object.keys(doc).filter((k) => !k.startsWith('$'))
  const only = keys.length === 1 ? doc[keys[0] as string] : undefined
  const root = isObj(only) && !('$value' in only) ? only : doc
  const resolve = (value: string, seen = 0): string => {
    const alias = /^\{(.+)\}$/.exec(value.trim())
    if (!alias || seen > 8) return value
    let node: unknown = doc
    for (const part of (alias[1] as string).split('.')) node = isObj(node) ? node[part] : undefined
    if (isObj(node) && typeof node.$value === 'string') return resolve(node.$value, seen + 1)
    return typeof node === 'string' ? resolve(node, seen + 1) : value
  }
  const walk = (node: Obj, path: string[], inheritedType?: unknown) => {
    const type = node.$type ?? inheritedType
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$')) continue
      const name = [...path, key].join('/')
      if (isObj(child) && '$value' in child) {
        const childType = child.$type ?? type
        const raw = child.$value
        if (typeof raw !== 'string') continue
        const c = named(name, resolve(raw))
        if (c) out.colours.push(c)
        // A token typed as a colour that does not read as one is a mistake;
        // an untyped one that does not (4px, a font) is just not a colour.
        else if (childType === 'color') out.bad.push(`${name}: ${raw}`)
      } else if (isObj(child)) {
        walk(child, [...path, key], type)
      } else if (typeof child === 'string') {
        const c = named(name, resolve(child))
        if (c) out.colours.push(c)
      }
    }
  }
  walk(root, [])
  return out
}

// ── Lines ────────────────────────────────────────────────────────────────

/** One CSV row, honouring "quoted, fields". */
function csvRow(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      cells.push(cell.trim())
      cell = ''
    } else cell += ch
  }
  cells.push(cell.trim())
  return cells
}

const NAME_HEADS = ['name', 'token', 'label']
const COLOUR_HEADS = ['hex', 'colour', 'color', 'value', 'rgb']

function fromCsv(lines: string[], nameAt: number, colourAt: number): ColourList {
  const out: ColourList = { colours: [], bad: [] }
  for (const line of lines) {
    if (line.trim() === '') continue
    const cells = csvRow(line)
    const name = cells[nameAt] ?? ''
    const value = cells[colourAt] ?? ''
    const c = name ? named(name, value) : undefined
    if (c) out.colours.push(c)
    else out.bad.push(line.trim())
  }
  return out
}

/** A line's name and colour, whichever way round and however separated. */
function fromLine(line: string): NamedColour | undefined {
  const s = line
    .replace(/^[-*•]\s+/, '')
    .replace(/[;,]$/, '')
    .trim()
  // Separators a person would use, the clearest first.
  for (const sep of ['\t', ':', '=', ',']) {
    const at = s.indexOf(sep)
    if (at <= 0) continue
    const c = named(s.slice(0, at).trim(), s.slice(at + 1).trim())
    if (c?.name) return c
  }
  // Spaces: the name is everything before the colour, or after it.
  const words = s.split(/\s+/)
  for (let i = 1; i < words.length; i++) {
    const c = named(words.slice(0, i).join(' '), words.slice(i).join(' '))
    if (c) return c
  }
  for (let i = words.length - 1; i >= 1; i--) {
    const c = named(words.slice(i).join(' '), words.slice(0, i).join(' '))
    if (c) return c
  }
  const alone = named('', s)
  return alone ? { ...alone, name: alone.hex } : undefined
}

function fromLines(lines: string[]): ColourList {
  const head = csvRow(lines[0] ?? '').map((h) => h.toLowerCase())
  const nameAt = head.findIndex((h) => NAME_HEADS.includes(h))
  const colourAt = head.findIndex((h) => COLOUR_HEADS.includes(h))
  if (head.length > 1 && nameAt !== -1 && colourAt !== -1) {
    return fromCsv(lines.slice(1), nameAt, colourAt)
  }
  // CSS: only the custom properties say anything; the rest is the rule around them.
  const css = lines.some((l) => /^\s*--[\w-]+\s*:/.test(l))
  const out: ColourList = { colours: [], bad: [] }
  let inComment = false
  for (const raw of lines) {
    let line = raw.replace(/\/\*.*?\*\//g, '')
    if (inComment) {
      const end = line.indexOf('*/')
      if (end === -1) continue
      line = line.slice(end + 2)
      inComment = false
    }
    const open = line.indexOf('/*')
    if (open !== -1) {
      line = line.slice(0, open)
      inComment = true
    }
    line = line.trim()
    if (line === '' || line.startsWith('//')) continue
    if (css) {
      const prop = /^--([\w-]+)\s*:\s*(.+?)\s*;?$/.exec(line)
      if (!prop) continue
      const c = named(prop[1] as string, prop[2] as string)
      if (c) out.colours.push(c)
      continue
    }
    // `# heading` is a comment; `#f8f1e6 …` is a colour.
    if (line.startsWith('#') && !parseColour(line.split(/\s+/)[0] as string)) continue
    const c = fromLine(line)
    if (c) out.colours.push(c)
    else out.bad.push(line)
  }
  return out
}
