import { render } from 'ink'
import { App } from './App.js'

/** Renders the shell and resolves when the user exits it. */
export async function launchShell(): Promise<void> {
  const instance = render(<App />)
  await instance.waitUntilExit()
}
