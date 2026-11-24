// Entzerrt einen schräg fotografierten Bereich zu einem geraden Rechteck.
//
// Man markiert die vier Ecken einer Seite auf dem Foto. Daraus berechnen wir eine
// sogenannte Homographie: eine Formel, die jeden Punkt des Rechtecks einem Punkt
// im Foto zuordnet. So wird aus einem Trapez wieder eine gerade Fläche.
import type { Pt, Quad } from '../types'

type Mat = number[] // 3 × 3, zeilenweise, letzter Wert 1

/** Löst ein lineares Gleichungssystem A·x = b (Gauß-Verfahren). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let pivot = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r
    ;[M[c], M[pivot]] = [M[pivot], M[c]]
    const p = M[c][c] || 1e-12
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / p
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12))
}

/** Berechnet die Abbildung, die die Punkte from[i] auf to[i] legt. */
export function homography(from: Pt[], to: Pt[]): Mat {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i]
    const [u, v] = to[i]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  return [...solve(A, b), 1]
}

/**
 * Schneidet die markierte Seite aus dem Foto und bringt sie auf outW × outH Pixel.
 * Durchsichtige Bereiche (vom Freistellen) bleiben durchsichtig.
 */
export function warpQuad(src: HTMLCanvasElement, corners: Quad, outW: number, outH: number): HTMLCanvasElement {
  const sw = src.width
  const sh = src.height
  const srcPts = corners.map(([x, y]) => [x * sw, y * sh] as Pt)
  const dstPts: Pt[] = [
    [0, 0],
    [outW, 0],
    [outW, outH],
    [0, outH],
  ]
  // Wir gehen jeden Zielpixel durch und schauen nach, woher er im Foto kommt.
  const H = homography(dstPts, srcPts)
  const sdata = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, sw, sh).data

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const octx = out.getContext('2d')!
  const img = octx.createImageData(outW, outH)
  const o = img.data

  for (let y = 0; y < outH; y++) {
    const py = y + 0.5
    for (let x = 0; x < outW; x++) {
      const px = x + 0.5
      const w = H[6] * px + H[7] * py + H[8]
      const sx = (H[0] * px + H[1] * py + H[2]) / w - 0.5
      const sy = (H[3] * px + H[4] * py + H[5]) / w - 0.5
      const i = (y * outW + x) * 4
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) continue // außerhalb: durchsichtig
      // Bilinear: Mittelwert der vier Nachbarpixel, damit es nicht pixelig wird
      const x0 = Math.max(0, Math.floor(sx))
      const y0 = Math.max(0, Math.floor(sy))
      const x1 = Math.min(sw - 1, x0 + 1)
      const y1 = Math.min(sh - 1, y0 + 1)
      const fx = Math.min(1, Math.max(0, sx - x0))
      const fy = Math.min(1, Math.max(0, sy - y0))
      const a = (y0 * sw + x0) * 4
      const b = (y0 * sw + x1) * 4
      const c = (y1 * sw + x0) * 4
      const d = (y1 * sw + x1) * 4
      for (let k = 0; k < 4; k++) {
        const top = sdata[a + k] + (sdata[b + k] - sdata[a + k]) * fx
        const bot = sdata[c + k] + (sdata[d + k] - sdata[c + k]) * fx
        o[i + k] = top + (bot - top) * fy
      }
    }
  }
  octx.putImageData(img, 0, 0)
  return out
}

/** Grobes Seitenverhältnis (Breite / Höhe) der markierten Fläche im Foto. */
export function quadRatio(corners: Quad, imgW: number, imgH: number): number {
  const p = corners.map(([x, y]) => [x * imgW, y * imgH])
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const w = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2
  const h = (dist(p[0], p[3]) + dist(p[1], p[2])) / 2
  return h > 0 ? w / h : 1
}

/** Ausgabegröße in Pixeln für eine Seite mit dem Seitenverhältnis ratio (Breite / Höhe). */
export function outputSize(ratio: number, longSide = 640): [number, number] {
  return ratio >= 1
    ? [longSide, Math.max(8, Math.round(longSide / ratio))]
    : [Math.max(8, Math.round(longSide * ratio)), longSide]
}

export const DEFAULT_CORNERS_CUTOUT: Quad = [
  [0.01, 0.01],
  [0.99, 0.01],
  [0.99, 0.99],
  [0.01, 0.99],
]
export const DEFAULT_CORNERS_PHOTO: Quad = [
  [0.12, 0.12],
  [0.88, 0.12],
  [0.88, 0.88],
  [0.12, 0.88],
]
