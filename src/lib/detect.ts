// Erkennt im Kamerabild den Gegenstand und legt ein Viereck um die sichtbare Seite.
//
// So funktioniert es, ähnlich wie bei Scanner-Apps für Dokumente:
// 1. Das Freistell-Modell liefert eine Maske (Gegenstand oder Hintergrund).
// 2. Von allen Pixeln des Gegenstands suchen wir die vier äußersten Ecken
//    (ganz oben links, oben rechts, unten rechts, unten links).
// 3. Wir prüfen, ob das Viereck die Seite gut abdeckt und ob man gerade davor steht.
import { MASK_SIZE } from './backgroundRemoval'
import type { Pt, Quad } from '../types'

export type Issue = 'none' | 'nothing' | 'too-close' | 'too-small' | 'not-frontal' | 'tilted'

export interface Detection {
  quad: Quad | null
  /** Anteil des Vierecks, der vom Gegenstand ausgefüllt ist (0 bis 1) */
  fill: number
  issue: Issue
}

export const ISSUE_TEXT: Record<Issue, string> = {
  none: 'Ruhig halten …',
  nothing: 'Kein Gegenstand erkannt. Richte die Kamera auf den Gegenstand.',
  'too-close': 'Etwas weiter weg gehen, der Gegenstand muss ganz ins Bild.',
  'too-small': 'Etwas näher herangehen.',
  'not-frontal': 'Stell dich gerader vor diese Seite.',
  tilted: 'Halte das Handy gerade.',
}

const THRESHOLD = 0.5

/**
 * @param mask Ausgabe von predictMask (MASK_SIZE × MASK_SIZE)
 * @param aspect Seitenverhältnis des Kamerabilds (Breite / Höhe)
 */
export function detectQuad(mask: Float32Array, aspect: number): Detection {
  const n = MASK_SIZE
  // Koordinaten in "echtem" Seitenverhältnis, damit Winkel stimmen
  const sx = aspect >= 1 ? aspect : 1
  const sy = aspect >= 1 ? 1 : 1 / aspect

  let count = 0
  let edgeTouch = 0
  let best = { tl: Infinity, br: -Infinity, tr: -Infinity, bl: Infinity }
  const pts: Record<'tl' | 'br' | 'tr' | 'bl', Pt> = { tl: [0, 0], br: [0, 0], tr: [0, 0], bl: [0, 0] }

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (mask[y * n + x] < THRESHOLD) continue
      count++
      if (x === 0 || y === 0 || x === n - 1 || y === n - 1) edgeTouch++
      const X = (x / n) * sx
      const Y = (y / n) * sy
      if (X + Y < best.tl) {
        best.tl = X + Y
        pts.tl = [x, y]
      }
      if (X + Y > best.br) {
        best.br = X + Y
        pts.br = [x, y]
      }
      if (X - Y > best.tr) {
        best.tr = X - Y
        pts.tr = [x, y]
      }
      if (X - Y < best.bl) {
        best.bl = X - Y
        pts.bl = [x, y]
      }
    }
  }
  const coverage = count / (n * n)
  if (coverage < 0.03) return { quad: null, fill: 0, issue: 'nothing' }

  // Ecken auf 0 bis 1 umrechnen (Pixelmitte)
  const norm = (p: Pt): Pt => [(p[0] + 0.5) / n, (p[1] + 0.5) / n]
  const quad: Quad = [norm(pts.tl), norm(pts.tr), norm(pts.br), norm(pts.bl)]

  // Wie gut füllt der Gegenstand das Viereck aus?
  const area = polygonArea(quad) * n * n
  let inside = 0
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (mask[y * n + x] >= THRESHOLD && pointInQuad([(x + 0.5) / n, (y + 0.5) / n], quad)) inside++
    }
  }
  const fill = area > 0 ? Math.min(1, inside / area) : 0

  if (edgeTouch > n * 0.6) return { quad, fill, issue: 'too-close' }
  if (coverage < 0.06) return { quad, fill, issue: 'too-small' }

  // Steht man gerade davor? Dann sind die Seitenkanten fast senkrecht
  // und gegenüberliegende Kanten ungefähr gleich lang.
  const real = quad.map(([x, y]) => [x * sx, y * sy] as Pt)
  const len = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])
  const tiltOf = (a: Pt, b: Pt) => Math.abs((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI)
  const leftTilt = tiltOf(real[0], real[3])
  const rightTilt = tiltOf(real[1], real[2])
  const top = len(real[0], real[1])
  const bottom = len(real[3], real[2])
  const left = len(real[0], real[3])
  const right = len(real[1], real[2])
  const ratioTB = Math.min(top, bottom) / Math.max(top, bottom)
  const ratioLR = Math.min(left, right) / Math.max(left, right)

  if (leftTilt > 12 && rightTilt > 12 && Math.sign(real[3][0] - real[0][0]) === Math.sign(real[2][0] - real[1][0])) {
    return { quad, fill, issue: 'tilted' }
  }
  if (fill < 0.8 || ratioTB < 0.78 || ratioLR < 0.78 || leftTilt > 14 || rightTilt > 14) {
    return { quad, fill, issue: 'not-frontal' }
  }
  return { quad, fill, issue: 'none' }
}

export function polygonArea(q: Pt[]): number {
  let a = 0
  for (let i = 0; i < q.length; i++) {
    const [x1, y1] = q[i]
    const [x2, y2] = q[(i + 1) % q.length]
    a += x1 * y2 - x2 * y1
  }
  return Math.abs(a) / 2
}

function pointInQuad(p: Pt, q: Quad): boolean {
  let inside = false
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = q[i]
    const [xj, yj] = q[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Größte Verschiebung einer Ecke zwischen zwei Vierecken (relativ zur Bildgröße). */
export function quadDistance(a: Quad, b: Quad): number {
  let m = 0
  for (let i = 0; i < 4; i++) m = Math.max(m, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1]))
  return m
}

/** Weiche Bewegung des angezeigten Rahmens, damit er nicht zittert. */
export function smoothQuad(prev: Quad | null, next: Quad, k = 0.5): Quad {
  if (!prev) return next
  return next.map((p, i) => [prev[i][0] + (p[0] - prev[i][0]) * k, prev[i][1] + (p[1] - prev[i][1]) * k]) as Quad
}
