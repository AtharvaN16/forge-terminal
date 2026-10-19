import { describe, expect, it } from 'vitest'
import { AUMID, notifyCommand } from '../../src/menu/notify.js'

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
