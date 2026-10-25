import { execFile } from 'node:child_process'
import { type Notice, noticeWorthy } from '../core/finish-notice.js'
import { onPath } from './linux.js'

/**
 * One notification, for a menu item that runs with no window (Sharpen) and
 * for the menu clearing itself away once Forge is gone.
 *
 * Mac: osascript's `display notification`. macOS files it under the script
 * runner rather than Forge; giving it Forge's name and click-through would
 * take a signed helper app, which Forge, as an npm tool, does not have.
 *
 * Windows: a toast through PowerShell, sent under Forge's own app ID, which
 * install registers in the current user's hive with Forge's name and logo.
 * Without one Windows may drop the toast silently. Windows PowerShell 5.1,
 * not pwsh: the WinRT types are reachable from it with no extra modules.
 *
 * Linux: notify-send, libnotify's own tool, where it is installed; else
 * gdbus, which comes with GLib, straight to the desktop's notification
 * service (org.freedesktop.Notifications); else nothing at all.
 */

/** The app ID Forge's toasts are sent under, registered by install (windows.ts). */
export const AUMID = 'ForgeTerminal.Forge'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/**
 * A PowerShell single-quoted string's contents: a quote is written twice.
 * PowerShell takes the curly ones (‘ ’ ‚ ‛) as quotes too, so a name like
 * D’Angelo would otherwise end the string early.
 */
export const psEscape = (s: string) => s.replace(/['‘’‚‛]/g, '$&$&')
const ps = psEscape

/** The PowerShell that shows a two-line toast: `title` in bold, `body` under it. */
export function toastScript(title: string, body: string): string {
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null',
    '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$x.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">${ps(xml(title))}</text><text id="2">${ps(xml(body))}</text></binding></visual></toast>')`,
    `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${AUMID}').Show([Windows.UI.Notifications.ToastNotification]::new($x))`,
  ].join('; ')
}

/** The program and arguments that post the notification on `platform`. */
export function notifyCommand(
  title: string,
  body: string,
  platform: NodeJS.Platform = process.platform,
): [string, string[]] {
  if (platform === 'win32')
    return [
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        toastScript(title, body),
      ],
    ]
  return [
    '/usr/bin/osascript',
    [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e',
      'end run',
      title,
      body,
    ],
  ]
}

/**
 * The GVariant text for a string, as gdbus reads each argument: unquoted, a
 * title such as `42` or `true` would be read as some other type.
 */
export const gvariantString = (s: string) =>
  `"${s.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n')}"`

export interface LinuxNotify {
  /** Whether a program is on PATH; the real PATH when absent. */
  has?: (cmd: string) => boolean
  /** The logo shown beside the notification. */
  icon?: string
}

/** The program and arguments that post the notification on Linux; undefined when nothing can. */
export function linuxNotifyCommand(
  title: string,
  body: string,
  o: LinuxNotify = {},
): [string, string[]] | undefined {
  const has = o.has ?? ((cmd: string) => onPath(cmd))
  if (has('notify-send'))
    return [
      'notify-send',
      ['--app-name=Forge', ...(o.icon ? [`--icon=${o.icon}`] : []), '--', title, body],
    ]
  if (has('gdbus'))
    return [
      'gdbus',
      [
        'call',
        '--session',
        '--dest',
        'org.freedesktop.Notifications',
        '--object-path',
        '/org/freedesktop/Notifications',
        '--method',
        'org.freedesktop.Notifications.Notify',
        gvariantString('Forge'),
        '0',
        gvariantString(o.icon ?? ''),
        gvariantString(title),
        gvariantString(body),
        '[]',
        '{}',
        '-1',
      ],
    ]
  return undefined
}

/** Posts it. Never throws: a notification that could not be shown is not worth failing over. */
export function notify(
  title: string,
  body: string,
  platform: NodeJS.Platform = process.platform,
  linux: LinuxNotify = {},
) {
  const command =
    platform === 'linux'
      ? linuxNotifyCommand(title, body, linux)
      : notifyCommand(title, body, platform)
  return new Promise<void>((resolve) => {
    if (command === undefined) return resolve()
    try {
      execFile(command[0], command[1], { timeout: 10_000, windowsHide: true }, () => resolve())
    } catch {
      resolve()
    }
  })
}

type Ask = (cmd: string, args: string[]) => Promise<string>

const lsappinfo: Ask = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 2_000 }, (e, out) => (e ? reject(e) : resolve(out))),
  )

/**
 * Whether the app `bundle` names is the Mac's front app: `lsappinfo`, which
 * needs no permission, unlike asking System Events. `bundle` is the
 * terminal's, from `__CFBundleIdentifier`, which macOS gives every process an
 * app starts — Terminal's shells, iTerm2's and Ghostty's alike.
 */
export async function terminalInFront(bundle: string, ask: Ask = lsappinfo): Promise<boolean> {
  const asn = (await ask('lsappinfo', ['front'])).trim()
  const info = await ask('lsappinfo', ['info', '-only', 'bundleid', asn])
  return info.match(/bundleID="([^"]*)"/)?.[1] === bundle
}

/**
 * Posts a finished run's notice (`core/finish-notice.ts`) if it ran long
 * enough to need one and the person is somewhere else: never over SSH, where
 * it would show on the other machine; on a Mac only when the terminal is not
 * the front app; on Windows and Linux always, having no cheap way to ask.
 * Never throws, like `notify`.
 */
export async function postFinishNotice(
  notice: Notice | undefined,
  elapsedMs: number,
  d: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    ask?: Ask
    post?: (title: string, body: string) => Promise<void>
  } = {},
): Promise<void> {
  if (notice === undefined || !noticeWorthy(elapsedMs)) return
  const platform = d.platform ?? process.platform
  const env = d.env ?? process.env
  // FORGE_NO_NOTIFY: off for the test suite, which runs real flows (vitest.config.ts).
  if (env.FORGE_NO_NOTIFY || env.SSH_CONNECTION || env.SSH_TTY) return
  const bundle = env.__CFBundleIdentifier
  if (platform === 'darwin' && bundle) {
    const inFront = await terminalInFront(bundle, d.ask).catch(() => false)
    if (inFront) return
  }
  await (d.post ?? ((title, body) => notify(title, body, platform)))(notice.title, notice.body)
}
