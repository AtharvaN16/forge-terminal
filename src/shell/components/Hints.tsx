import { Text } from 'ink'

/** Each key is paired with a word, so the line reads in monochrome. */
export function Hints({ pairs }: { pairs: Array<[string, string]> }) {
  return <Text dimColor>{pairs.map(([key, what]) => `${key} ${what}`).join(' · ')}</Text>
}
