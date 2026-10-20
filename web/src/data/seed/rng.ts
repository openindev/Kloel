/** PRNG determinístico (mulberry32) para fixtures reproduzíveis. */
export function createRng(seed = 20261018) {
  let a = seed >>> 0
  const next = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T,>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length)]!,
    chance: (p: number) => next() < p,
    id: (prefix: string) => `${prefix}_${Math.floor(next() * 1e10).toString(36)}`,
  }
}
export type Rng = ReturnType<typeof createRng>
