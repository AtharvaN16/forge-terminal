import { describe, expect, it } from 'vitest'
import {
  AUMID,
  gvariantString,
  linuxNotifyCommand,
  notify,
  notifyCommand,
} from '../../src/menu/notify.js'

describe('notifyCommand', () => {
  it('posts a Mac notification through osascript, the text as arguments', () => {
    const [cmd, args] = notifyCommand('photo-sharp.png', 'Sharpened', 'darwin')
    expect(cmd).toBe('/usr/bin/osascript')
    expect(args.slice(-2)).toEqual(['photo-sharp.png', 'Sharpened'])
    expect(args.join(' ')).toContain(
      'display notification (item 2 of argv) with title (item 1 of argv)',
    )
  })

  it('posts a Windows toast through PowerShell under Forge’s own app ID', () => {
    const [cmd, args] = notifyCommand('photo-sharp.png', 'Sharpened', 'win32')
    expect(cmd).toBe('powershell.exe')
    const script = args[args.length - 1] as string
    expect(script).toContain(`CreateToastNotifier('${AUMID}')`)
    expect(script).toContain('ToastText02')
  })

  it('doubles a curly quote in a file name, which PowerShell also reads as a quote', () => {
    const [, args] = notifyCommand('John’s photo.png', 'Sharpened', 'win32')
    expect(args.at(-1)).toContain('John’’s photo.png')
  })

  it('escapes the text for the toast’s XML and PowerShell’s quotes', () => {
    const [, args] = notifyCommand("Tom's <photo> & co.png", 'Sharpened', 'win32')
    const script = args[args.length - 1] as string
    expect(script).toContain("Tom''s &lt;photo&gt; &amp; co.png")
  })
})

describe('Linux notifications', () => {
  const has =
    (...installed: string[]) =>
    (cmd: string) =>
      installed.includes(cmd)

  it('uses notify-send, under Forge’s name and logo, the text as arguments', () => {
    expect(
      linuxNotifyCommand('photo-sharp.png', 'Sharpened', {
        has: has('notify-send', 'gdbus'),
        icon: '/m/forge.png',
      }),
    ).toEqual([
      'notify-send',
      ['--app-name=Forge', '--icon=/m/forge.png', '--', 'photo-sharp.png', 'Sharpened'],
    ])
  })

  it('goes straight to the notification service through gdbus when notify-send is missing', () => {
    const [cmd, args] = linuxNotifyCommand('a "b".png', 'Sharpened', { has: has('gdbus') }) ?? [
      '',
      [],
    ]
    expect(cmd).toBe('gdbus')
    expect(args).toContain('org.freedesktop.Notifications.Notify')
    expect(args.slice(-8)).toEqual([
      '"Forge"',
      '0',
      '""',
      '"a \\"b\\".png"',
      '"Sharpened"',
      '[]',
      '{}',
      '-1',
    ])
  })

  it('has nothing to run when neither is installed', () => {
    expect(linuxNotifyCommand('t', 'b', { has: has() })).toBeUndefined()
  })

  it('never throws or hangs, whatever is or is not installed', async () => {
    await expect(notify('t', 'b', 'linux', { has: has() })).resolves.toBeUndefined()
    await expect(
      notify('t', 'b', 'linux', { has: has('notify-send', 'gdbus') }),
    ).resolves.toBeUndefined()
  })

  it('writes a GVariant string gdbus reads as one, whatever is in it', () => {
    expect(gvariantString("it's a\\b\nc")).toBe('"it\'s a\\\\b\\nc"')
  })
})
