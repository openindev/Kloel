import { useMemo } from 'react'

/** Hash FNV-1a (determinístico) para gerar o padrão visual. */
function fnv(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Desenho de QR code gerado localmente (SVG). É um padrão visual com marcadores de posição e módulos
 * derivados do código — NÃO é um QR code decodificável (a verificação é simulada nesta demonstração).
 */
export function QrCode({ value, size = 148 }: { value: string; size?: number }) {
  const n = 29
  const cells = useMemo(() => {
    const grid: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false))
    const reserved: boolean[][] = Array.from({ length: n }, () => Array<boolean>(n).fill(false))
    const finder = (r0: number, c0: number) => {
      for (let r = -1; r <= 7; r++)
        for (let c = -1; c <= 7; c++) {
          const rr = r0 + r
          const cc = c0 + c
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue
          reserved[rr]![cc] = true
          const on = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4))
          grid[rr]![cc] = on
        }
    }
    finder(0, 0)
    finder(0, n - 7)
    finder(n - 7, 0)
    // alinhamento
    for (let r = -2; r <= 2; r++)
      for (let c = -2; c <= 2; c++) {
        const rr = n - 9 + r
        const cc = n - 9 + c
        reserved[rr]![cc] = true
        grid[rr]![cc] = Math.max(Math.abs(r), Math.abs(c)) !== 1
      }
    // padrões de temporização
    for (let i = 8; i < n - 8; i++) {
      reserved[6]![i] = true
      reserved[i]![6] = true
      grid[6]![i] = i % 2 === 0
      grid[i]![6] = i % 2 === 0
    }
    let seed = fnv(value)
    const rnd = () => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) / 0xffffffff
    }
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (!reserved[r]![c]) grid[r]![c] = rnd() > 0.52
    return grid
  }, [value])
  const m = size / (n + 2)
  return (
    <svg role="img" aria-label="QR code de verificação" width={size} height={size} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      {cells.flatMap((row, r) => row.map((on, c) => (on ? <rect key={`${r}-${c}`} x={(c + 1) * m} y={(r + 1) * m} width={m + 0.2} height={m + 0.2} fill="#111" /> : null)))}
    </svg>
  )
}
