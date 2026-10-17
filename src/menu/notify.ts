import { execFile } from 'node:child_process'

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
 */

/** The app ID Forge's toasts are sent under, registered by install (windows.ts). */
export const AUMID = 'ForgeTerminal.Forge'

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** A PowerShell single-quoted string's contents: a quote is written twice. */
const ps = (s: string) => s.replace(/'/g, "''")

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

/** Posts it. Never throws: a notification that could not be shown is not worth failing over. */
export function notify(title: string, body: string, platform: NodeJS.Platform = process.platform) {
  const [cmd, args] = notifyCommand(title, body, platform)
  return new Promise<void>((resolve) => {
    execFile(cmd, args, { timeout: 10_000, windowsHide: true }, () => resolve())
  })
}
