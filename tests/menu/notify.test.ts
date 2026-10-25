import { describe, expect, it } from 'vitest'
import {
  AUMID,
  gvariantString,
  linuxNotifyCommand,
  notify,
  notifyCommand,
  postFinishNotice,
  terminalInFront,
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

describe('a long run’s notification', () => {
  const FRONT = 'ASN:0x0-0x78078:'
  /** lsappinfo as macOS answers: the front app's ASN, then its bundle ID. */
  const lsappinfo =
    (bundle: string) =>
    async (_cmd: string, args: string[]): Promise<string> =>
      args[0] === 'front'
        ? `${FRONT}\n`
        : `[ NULL ]  ${FRONT} (in front) \n    bundleID="${bundle}"\n    bundle path=[ NULL ] \n`
  const notice = { title: 'Convert finished', body: 'holiday.mov → holiday.mp4' }

  const run = async (o: {
    elapsed?: number
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    front?: string
  }) => {
    const posted: string[] = []
    await postFinishNotice(notice, o.elapsed ?? 25_000, {
      platform: o.platform ?? 'darwin',
      env: o.env ?? { __CFBundleIdentifier: 'com.apple.Terminal' },
      ask: lsappinfo(o.front ?? 'com.google.Chrome'),
      post: async (title, body) => {
        posted.push(`${title} | ${body}`)
      },
    })
    return posted
  }

  it('is posted when the terminal is not the app in front', async () => {
    expect(await run({})).toEqual(['Convert finished | holiday.mov → holiday.mp4'])
  })

  it('is not posted while the terminal it runs in is in front', async () => {
    expect(await run({ front: 'com.apple.Terminal' })).toEqual([])
  })

  it('is not posted for a run shorter than 20 seconds', async () => {
    expect(await run({ elapsed: 19_000 })).toEqual([])
  })

  it('is not posted over SSH, where it would land on the other machine', async () => {
    expect(await run({ env: { SSH_CONNECTION: '1 2 3 4' }, platform: 'linux' })).toEqual([])
    expect(
      await run({ env: { SSH_TTY: '/dev/ttys001', __CFBundleIdentifier: 'com.apple.Terminal' } }),
    ).toEqual([])
  })

  it('is posted on Windows and Linux, which have no cheap way to ask what is in front', async () => {
    expect(await run({ platform: 'win32', env: {} })).toHaveLength(1)
    expect(await run({ platform: 'linux', env: {} })).toHaveLength(1)
  })

  it('is posted when a Mac cannot say which app the terminal is, or which is in front', async () => {
    expect(await run({ env: {} })).toHaveLength(1)
    const posted: string[] = []
    await postFinishNotice(notice, 25_000, {
      platform: 'darwin',
      env: { __CFBundleIdentifier: 'com.apple.Terminal' },
      ask: async () => {
        throw new Error('no lsappinfo')
      },
      post: async (title) => {
        posted.push(title)
      },
    })
    expect(posted).toEqual(['Convert finished'])
  })

  it('is never posted with FORGE_NO_NOTIFY set, as under the test suite', async () => {
    expect(await run({ env: { FORGE_NO_NOTIFY: '1' }, platform: 'win32' })).toEqual([])
  })

  it('has nothing to post for a run that did nothing', async () => {
    const posted: string[] = []
    await postFinishNotice(undefined, 25_000, {
      platform: 'win32',
      env: {},
      post: async (title) => {
        posted.push(title)
      },
    })
    expect(posted).toEqual([])
  })

  it('reads the front app from lsappinfo', async () => {
    expect(await terminalInFront('com.mitchellh.ghostty', lsappinfo('com.mitchellh.ghostty'))).toBe(
      true,
    )
    expect(await terminalInFront('com.mitchellh.ghostty', lsappinfo('com.apple.Safari'))).toBe(
      false,
    )
  })
})
