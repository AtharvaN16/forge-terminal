/**
 * What `/cli` lists (mockups/cli-2026-10.html): every flag and subcommand,
 * one tab per category, a line each and one real use. The README stays the
 * full reference; this is the names and what they do.
 *
 * Data only. tests/core/cli-reference.test.ts holds it to `forge --help`, so a
 * flag or subcommand added there and not here fails a test.
 */

export interface CliItem {
  /** The flag or subcommand as typed, with its arguments. */
  name: string
  /** What it does, one short line. */
  does: string
  /** One real use of it, copied by ↵. */
  ex: string
}

export interface CliTab {
  name: string
  items: CliItem[]
}

export const CLI_TABS: CliTab[] = [
  {
    name: 'Convert',
    items: [
      {
        name: '-t, --to <format>',
        does: 'convert to another format',
        ex: 'forge photo.heic --to jpg',
      },
      {
        name: '-o, --output <path>',
        does: 'where to save',
        ex: 'forge scan.png --to pdf -o ~/Desktop',
      },
      {
        name: '-q, --quality <1-100>',
        does: 'quality for lossy formats',
        ex: 'forge photo.png --to webp -q 80',
      },
      {
        name: '--max-size <size>',
        does: 'compress until the file fits',
        ex: 'forge photo.jpg --to jpg --max-size 500kb',
      },
      {
        name: '--background <colour>',
        does: 'fill where transparency goes',
        ex: 'forge logo.png --to jpg --background "#ffffff"',
      },
      {
        name: '--keep-metadata',
        does: 'keep EXIF and GPS data',
        ex: 'forge photo.jpg --to webp --keep-metadata',
      },
      {
        name: '--recursive',
        does: 'go into subfolders',
        ex: 'forge photos/ --to webp --recursive',
      },
      {
        name: '--force',
        does: 'overwrite files that exist',
        ex: 'forge photo.png --to jpg --force',
      },
      {
        name: '--concurrency <n>',
        does: 'how many files at once',
        ex: 'forge photos/ --to webp --concurrency 4',
      },
      {
        name: '--preset <name>',
        does: 'run a preset saved from Done',
        ex: 'forge photo.png --preset blog',
      },
      { name: '--formats', does: 'list every supported format', ex: 'forge --formats' },
      { name: '--json', does: 'print JSON instead of text', ex: 'forge photo.png --to jpg --json' },
      {
        name: '--debug',
        does: 'show the underlying errors',
        ex: 'forge photo.png --to jpg --debug',
      },
    ],
  },
  {
    name: 'Edit',
    items: [
      {
        name: '--resize <percent>',
        does: 'a percent of the size, 1–200',
        ex: 'forge photo.jpg --resize 50%',
      },
      {
        name: '--width <px>',
        does: 'a width; the height follows',
        ex: 'forge photo.jpg --width 1200',
      },
      {
        name: '--height <px>',
        does: 'a height; the width follows',
        ex: 'forge photo.jpg --height 800',
      },
      {
        name: '--crop <W:H>',
        does: 'cut to a shape, keeping the subject',
        ex: 'forge photo.jpg --crop 4:5',
      },
      { name: '--trim', does: 'cut transparent or plain edges', ex: 'forge logo.png --trim' },
      {
        name: '--boost [2|3|4]',
        does: 'sharpen and enlarge · boost',
        ex: 'forge photo.jpg --boost 3',
      },
      {
        name: '--sharpen',
        does: 'sharpen at the same size · boost',
        ex: 'forge photo.jpg --sharpen',
      },
      {
        name: '--remove-bg',
        does: 'cut out the subject · remove-background',
        ex: 'forge portrait.jpg --remove-bg',
      },
    ],
  },
  {
    name: 'PDF',
    items: [
      { name: '--merge', does: 'combine PDFs into one', ex: 'forge a.pdf b.pdf --merge' },
      {
        name: '--split <mode>',
        does: 'every-page, every=N or at=N,N',
        ex: 'forge book.pdf --split every=10',
      },
      {
        name: '--extract <pages>',
        does: 'keep only these pages',
        ex: 'forge book.pdf --extract 3-7,12',
      },
      { name: '--delete <pages>', does: 'drop these pages', ex: 'forge book.pdf --delete 2' },
      { name: '--rotate <degrees>', does: '90, 180 or 270', ex: 'forge scan.pdf --rotate 90' },
      {
        name: '--separate',
        does: 'with --extract, one file per page',
        ex: 'forge book.pdf --extract 1-3 --separate',
      },
      {
        name: '--pages <ranges>',
        does: 'which pages to turn into images',
        ex: 'forge book.pdf --to png --pages 3-7',
      },
      {
        name: '--dpi <n>',
        does: 'image resolution, 36–600',
        ex: 'forge book.pdf --to png --dpi 300',
      },
      {
        name: '--password-stdin',
        does: "read an encrypted PDF's password",
        ex: 'echo "$PW" | forge locked.pdf --to png --password-stdin',
      },
    ],
  },
  {
    name: 'Media',
    items: [
      {
        name: '--cut <start-end>',
        does: 'keep from start to end',
        ex: 'forge talk.mp4 --cut 0:03.2-0:41',
      },
      { name: '--mute', does: 'take the sound out of a video', ex: 'forge clip.mp4 --mute' },
      { name: '--speed <x>', does: 'faster or slower, 0.25–4', ex: 'forge talk.mp4 --speed 1.5' },
      {
        name: '--fps <n>',
        does: 'frames per second of a video',
        ex: 'forge clip.mov --to mp4 --fps 30',
      },
      {
        name: '--bitrate <kbps>',
        does: 'bitrate of an audio file',
        ex: 'forge song.wav --to mp3 --bitrate 128k',
      },
      {
        name: '--loudness <LUFS>',
        does: 'even out the loudness',
        ex: 'forge talk.mp3 --loudness -16',
      },
    ],
  },
  {
    name: 'Tools',
    items: [
      {
        name: 'probe <files>',
        does: 'what a file is and what Forge can do with it',
        ex: 'forge probe scan.pdf --json',
      },
      {
        name: 'palette <image>',
        does: "an image's main colours · --svg, --inside",
        ex: 'forge palette photo.jpg --svg',
      },
      {
        name: 'scale <colour>',
        does: '50–950 from one colour · --svg',
        ex: 'forge scale "#3b82f6" --json',
      },
      {
        name: 'clip',
        does: 'compress the copied image · --save, --undo',
        ex: 'forge clip --to webp',
      },
      {
        name: 'watch <folder>',
        does: 'a folder, then each new file · --new-only',
        ex: 'forge watch ~/Downloads --to webp',
      },
      {
        name: 'transcribe <file | link>',
        does: 'video, audio or link · --detail, --language',
        ex: 'forge transcribe talk.mp4 --detail brief',
      },
    ],
  },
  {
    name: 'Setup',
    items: [
      {
        name: 'config [list | path | set]',
        does: "read or change Forge's settings",
        ex: 'forge config set output ~/Desktop',
      },
      { name: 'config set theme', does: 'dark or light', ex: 'forge config set theme light' },
      {
        name: 'extensions [add | remove]',
        does: 'optional extras, such as boost',
        ex: 'forge extensions add boost',
      },
      {
        name: 'menu [install | remove]',
        does: 'the right-click menu, by hand',
        ex: 'forge menu install',
      },
      { name: 'update', does: 'install a newer Forge', ex: 'forge update' },
      { name: 'uninstall', does: 'remove right-click, then remove Forge', ex: 'forge uninstall' },
      {
        name: 'mcp',
        does: 'run as a local MCP server for AI agents',
        ex: 'claude mcp add forge -- forge mcp',
      },
    ],
  },
]
