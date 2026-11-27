// Deko-Bausteine für den Haufen. Sie sind nicht zum Verschenken da, sondern fürs Arrangement:
// Man kann Gegenstände daraufstellen, hineinlegen oder daran aufhängen.
//
// Jeder Baustein besteht aus einfachen Teilen (Quader, Zylinder). Dieselben Teile werden
// gezeichnet und für die Physik benutzt, so passt das Aussehen immer zum Verhalten.
import type { DecoKind } from '../types'
import type { Vec3 } from './geometry'

export type Part =
  | { shape: 'box'; half: Vec3; pos: Vec3; rot?: Vec3; color: string; label?: string; visualOnly?: boolean }
  | { shape: 'cyl'; halfH: number; r: number; pos: Vec3; rot?: Vec3; color: string; visualOnly?: boolean }
  | { shape: 'torus'; radius: number; tube: number; pos: Vec3; rot?: Vec3; color: string; visualOnly: true }

export interface SeatDef {
  half: Vec3
  /** Mittelpunkt des Sitzes relativ zur Mitte des Gestells */
  offset: Vec3
  /** Drehpunkt am Gestell und am Sitz (für das Gelenk) */
  anchorFrame: Vec3
  anchorSeat: Vec3
  color: string
}

export interface DecoDef {
  label: string
  description: string
  /** Breite, Höhe, Tiefe in cm */
  defaults: [number, number, number]
  ranges: [[number, number], [number, number], [number, number] | null]
  dimLabels: [string, string, string]
  /** Teile in Metern, Ursprung in der Mitte des umgebenden Quaders */
  parts: (w: number, h: number, d: number) => Part[]
  /** Haken zum Aufhängen von Gegenständen (lokale Koordinaten) */
  hooks: (w: number, h: number, d: number) => Vec3[]
  seat?: (w: number, h: number, d: number) => SeatDef
}

const WOOD = '#c99e6e'
const WOOD_DARK = '#a77c4f'
const WHITE = '#f4f2ee'
const METAL = '#5b7a86'

export const DECOS: Record<DecoKind, DecoDef> = {
  shelf: {
    label: 'Regal 4 × 4',
    description: 'Regal mit 16 Fächern zum Hineinstellen',
    defaults: [120, 120, 35],
    ranges: [
      [60, 300],
      [60, 300],
      [20, 80],
    ],
    dimLabels: ['Breite', 'Höhe', 'Tiefe'],
    parts: (w, h, d) => {
      const t = 0.02 // Brettstärke
      const parts: Part[] = [
        { shape: 'box', half: [t / 2, h / 2, d / 2], pos: [-w / 2 + t / 2, 0, 0], color: WOOD },
        { shape: 'box', half: [t / 2, h / 2, d / 2], pos: [w / 2 - t / 2, 0, 0], color: WOOD },
        { shape: 'box', half: [w / 2, t / 2, d / 2], pos: [0, h / 2 - t / 2, 0], color: WOOD },
        { shape: 'box', half: [w / 2, t / 2, d / 2], pos: [0, -h / 2 + t / 2, 0], color: WOOD },
        { shape: 'box', half: [w / 2, h / 2, 0.005], pos: [0, 0, -d / 2 + 0.005], color: WOOD_DARK },
      ]
      for (let i = 1; i < 4; i++) {
        parts.push({ shape: 'box', half: [w / 2 - t, t / 2, d / 2], pos: [0, -h / 2 + t / 2 + (i * (h - t)) / 4, 0], color: WOOD })
        parts.push({ shape: 'box', half: [t / 2, h / 2 - t, d / 2], pos: [-w / 2 + t / 2 + (i * (w - t)) / 4, 0, 0], color: WOOD })
      }
      return parts
    },
    hooks: (w, h) => [
      [-w / 2 - 0.03, h / 2 - 0.02, 0],
      [w / 2 + 0.03, h / 2 - 0.02, 0],
    ],
  },

  podium: {
    label: 'Siegertreppchen',
    description: 'Drei Stufen für Platz 1, 2 und 3',
    defaults: [120, 60, 45],
    ranges: [
      [60, 300],
      [20, 150],
      [20, 120],
    ],
    dimLabels: ['Breite', 'Höhe', 'Tiefe'],
    parts: (w, h, d) => {
      const bw = w / 3
      const h2 = h * 0.66
      const h3 = h * 0.45
      const top = 0.012
      return [
        { shape: 'box', half: [bw / 2, h / 2, d / 2], pos: [0, 0, 0], color: WHITE, label: '1' },
        { shape: 'box', half: [bw / 2, h2 / 2, d / 2], pos: [-bw, -h / 2 + h2 / 2, 0], color: WHITE, label: '2' },
        { shape: 'box', half: [bw / 2, h3 / 2, d / 2], pos: [bw, -h / 2 + h3 / 2, 0], color: WHITE, label: '3' },
        { shape: 'box', half: [bw / 2, top / 2, d / 2], pos: [0, h / 2 + top / 2 - 0.001, 0], color: '#d4a72c', visualOnly: true },
        { shape: 'box', half: [bw / 2, top / 2, d / 2], pos: [-bw, -h / 2 + h2 + top / 2 - 0.001, 0], color: '#b8c0c6', visualOnly: true },
        { shape: 'box', half: [bw / 2, top / 2, d / 2], pos: [bw, -h / 2 + h3 + top / 2 - 0.001, 0], color: '#b87a45', visualOnly: true },
      ]
    },
    hooks: () => [],
  },

  swing: {
    label: 'Schaukel',
    description: 'Schaukelt wirklich, mit Haken zum Aufhängen',
    defaults: [160, 180, 120],
    ranges: [
      [100, 300],
      [120, 300],
      [80, 220],
    ],
    dimLabels: ['Breite', 'Höhe', 'Standbreite'],
    parts: (w, h, d) => {
      const r = 0.035
      const beamY = h / 2 - r
      const len = Math.hypot(h - r, d / 2)
      const ang = Math.atan2(d / 2, h - r)
      const parts: Part[] = [{ shape: 'cyl', halfH: w / 2 + 0.06, r, pos: [0, beamY, 0], rot: [0, 0, Math.PI / 2], color: METAL }]
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          parts.push({
            shape: 'box',
            half: [r, len / 2, r],
            pos: [sx * (w / 2), beamY - (h - r) / 2, sz * (d / 4)],
            rot: [-sz * ang, 0, 0],
            color: METAL,
          })
        }
      }
      return parts
    },
    hooks: (w, h) => [
      [-w * 0.38, h / 2 - 0.07, 0],
      [w * 0.38, h / 2 - 0.07, 0],
    ],
    seat: (w, h) => {
      const sw = Math.min(0.6, w * 0.32)
      const seatY = -h / 2 + 0.45
      const beamY = h / 2 - 0.035
      return {
        half: [sw / 2, 0.02, 0.15],
        offset: [0, seatY, 0],
        anchorFrame: [0, beamY, 0],
        anchorSeat: [0, beamY - seatY, 0],
        color: WOOD,
      }
    },
  },

  etagere: {
    label: 'Etagere',
    description: 'Drei runde Etagen übereinander',
    defaults: [40, 50, 40],
    ranges: [[20, 120], [20, 150], null],
    dimLabels: ['Durchmesser', 'Höhe', ''],
    parts: (w, h) => {
      const R = w / 2
      const plate = 0.006
      const levels: [number, number][] = [
        [-h / 2 + 0.06 * h, R],
        [-h / 2 + 0.42 * h, R * 0.75],
        [-h / 2 + 0.76 * h, R * 0.5],
      ]
      const parts: Part[] = [
        { shape: 'cyl', halfH: 0.03 * h, r: R * 0.28, pos: [0, -h / 2 + 0.03 * h, 0], color: WHITE },
        { shape: 'cyl', halfH: h * 0.44, r: 0.008, pos: [0, -h / 2 + h * 0.44, 0], color: '#c9a646' },
        { shape: 'torus', radius: Math.max(0.025, h * 0.06), tube: 0.005, pos: [0, h / 2 - Math.max(0.025, h * 0.06), 0], color: '#c9a646', visualOnly: true },
      ]
      for (const [y, r] of levels) parts.push({ shape: 'cyl', halfH: plate, r, pos: [0, y, 0], color: WHITE })
      return parts
    },
    hooks: (_w, h) => [[0, h / 2, 0]],
  },
}

export const DECO_KINDS: DecoKind[] = ['shelf', 'podium', 'swing', 'etagere']

/** Maße in Metern, die Tiefe der Etagere entspricht dem Durchmesser */
export function decoMeters(kind: DecoKind, dims: [number, number, number]): Vec3 {
  const [w, h, d] = dims
  return [w / 100, h / 100, (kind === 'etagere' ? w : d) / 100]
}
