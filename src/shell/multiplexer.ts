const set = (v: string | undefined): boolean => v !== undefined && v !== ''

/**
 * Whether this process runs inside tmux, screen or Zellij. A sequence meant
 * for the terminal — an inline image, a background colour — either never
 * reaches it there, or reaches it behind the multiplexer's back and lands on
 * every pane at once. The outer terminal's own variables leak in, so they
 * cannot be trusted here; these can.
 */
export function insideMultiplexer(env: NodeJS.ProcessEnv): boolean {
  const term = env.TERM ?? ''
  return (
    set(env.TMUX) ||
    set(env.STY) ||
    set(env.ZELLIJ) ||
    env.TERM_PROGRAM === 'tmux' ||
    term.startsWith('screen') ||
    term.startsWith('tmux')
  )
}
