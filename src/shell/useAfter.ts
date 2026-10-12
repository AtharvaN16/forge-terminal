import { useEffect, useState } from 'react'

/**
 * Whether `active` has held for `ms` without a break. False the moment it
 * stops, so the next time starts the wait again.
 *
 * Working (W5) waits this way: most jobs finish in a blink, and a screen
 * shown for a fraction of a second only flickers. There is deliberately no
 * minimum time on screen once it shows — holding a finished result back to
 * avoid a flicker would add real delay.
 */
export function useAfter(active: boolean, ms: number): boolean {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    setHeld(false)
    if (!active) return
    const id = setTimeout(() => setHeld(true), ms)
    return () => clearTimeout(id)
  }, [active, ms])
  return active && held
}
