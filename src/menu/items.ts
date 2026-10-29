/**
 * What Forge puts in the right-click menu: Finder's Quick Actions on a Mac,
 * Explorer's menu on Windows (mockups/finder-2026-10.html, decided).
 *
 * An image gets Open Forge, Convert in Forge, Compress in Forge and Sharpen
 * in Forge; a folder the first three; a video or a sound file Open in Forge,
 * Convert in Forge and Compress in Forge; a PDF only Open in Forge, which
 * opens it in PDF mode. Video and sound have no quiet item: converting and
 * compressing them takes a target, so those two open the window.
 *
 * Then each preset turned on in /right-click, as "<name> in Forge"
 * (mockups/quick-actions-presets-2026-10.html, round one): images only, run
 * with no window as Sharpen is, in Forge's own mark.
 */

/** What a menu item does when clicked. */
export type MenuAction = 'open' | 'convert' | 'compress' | 'sharpen' | 'open-file' | 'preset'

/** The file kinds an item is offered for. The system hides it for anything else. */
export type MenuKind = 'image' | 'folder' | 'pdf' | 'video' | 'audio'

/** The colour of the slashes in the item's icon: a mode's, or Forge's own gradient. */
export type MenuPaint = 'forge' | 'convert' | 'compress' | 'edit' | 'pdf'

export interface MenuItem {
  action: MenuAction
  label: string
  kinds: MenuKind[]
  /** Opens Forge in a terminal window; false runs and says how it went in a notification. */
  window: boolean
  paint: MenuPaint
  /** The preset a `preset` item runs, by name. */
  preset?: string
}

/**
 * The items, in menu order. Sharpen needs the Boost extension, so it is
 * only offered once that is installed.
 */
export function menuItems(o: {
  sharpen: boolean
  /** The presets turned on in /right-click, by name, in the order they are saved. */
  presets?: readonly string[]
}): MenuItem[] {
  const items: MenuItem[] = [
    {
      action: 'open',
      label: 'Open Forge',
      kinds: ['image', 'folder'],
      window: true,
      paint: 'forge',
    },
    {
      action: 'open-file',
      label: 'Open in Forge',
      kinds: ['pdf', 'video', 'audio'],
      window: true,
      paint: 'pdf',
    },
    {
      action: 'convert',
      label: 'Convert in Forge',
      kinds: ['image', 'folder', 'video', 'audio'],
      window: true,
      paint: 'convert',
    },
    {
      action: 'compress',
      label: 'Compress in Forge',
      kinds: ['image', 'folder', 'video', 'audio'],
      window: true,
      paint: 'compress',
    },
    {
      action: 'sharpen',
      label: 'Sharpen in Forge',
      kinds: ['image'],
      window: false,
      paint: 'edit',
    },
  ]
  const presets = (o.presets ?? []).map(
    (name): MenuItem => ({
      action: 'preset',
      preset: name,
      label: `${name} in Forge`,
      kinds: ['image'],
      window: false,
      paint: 'forge',
    }),
  )
  return [...(o.sharpen ? items : items.filter((i) => i.action !== 'sharpen')), ...presets]
}
