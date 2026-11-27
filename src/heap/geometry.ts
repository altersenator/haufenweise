// Rechenhilfen für den 3D-Haufen: Maße, Drehungen und worauf ein Körper zu liegen kommt.
import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Item } from '../types'

export type Vec3 = [number, number, number]

/** Halbe Kantenlängen in Metern (Breite, Höhe, Tiefe). */
export function halfExtents(item: Item): Vec3 {
  return [item.widthCm / 200, item.heightCm / 200, item.depthCm / 200]
}

/** Halbe Ausdehnung eines gedrehten Quaders entlang der Weltachsen (x, y, z). */
export function worldHalf(q: Quaternion, half: Vec3): Vec3 {
  const e = new Matrix4().makeRotationFromQuaternion(q).elements
  const [hx, hy, hz] = half
  return [
    Math.abs(e[0]) * hx + Math.abs(e[4]) * hy + Math.abs(e[8]) * hz,
    Math.abs(e[1]) * hx + Math.abs(e[5]) * hy + Math.abs(e[9]) * hz,
    Math.abs(e[2]) * hx + Math.abs(e[6]) * hy + Math.abs(e[10]) * hz,
  ]
}

export interface BodyBox {
  center: Vec3
  half: Vec3 // bereits in Weltachsen
}

/**
 * Höhe, auf der ein Körper mit Grundfläche (x, z, halbe Breite hx, halbe Tiefe hz) zu liegen kommt:
 * die Oberkante des höchsten Körpers darunter, sonst der Boden.
 */
export function supportHeight(x: number, z: number, hx: number, hz: number, others: BodyBox[]): number {
  let top = 0
  const m = 0.01 // kleine Toleranz, damit Körper nebeneinander nicht als "darunter" zählen
  for (const o of others) {
    const overlapX = Math.abs(x - o.center[0]) < hx + o.half[0] - m
    const overlapZ = Math.abs(z - o.center[2]) < hz + o.half[2] - m
    if (overlapX && overlapZ) top = Math.max(top, o.center[1] + o.half[1])
  }
  return top
}

/** Dreht um 90 Grad um eine Achse in Weltkoordinaten. */
export function rotate90(q: Quaternion, axis: Vector3, sign = 1): Quaternion {
  const r = new Quaternion().setFromAxisAngle(axis.clone().normalize(), (sign * Math.PI) / 2)
  return r.multiply(q).normalize()
}

/** Rastet eine Drehung auf ganze 90-Grad-Schritte ein, damit Körper nach dem Kippen gerade stehen. */
export function snapQuaternion(q: Quaternion): Quaternion {
  const m = new Matrix4().makeRotationFromQuaternion(q)
  const e = m.elements
  const cols = [0, 1, 2].map((c) => new Vector3(e[c * 4], e[c * 4 + 1], e[c * 4 + 2]))
  const snapped = cols.map((v) => {
    const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)]
    const i = a.indexOf(Math.max(...a))
    const out = new Vector3()
    out.setComponent(i, Math.sign(v.getComponent(i)) || 1)
    return out
  })
  // Nur einrasten, wenn das Ergebnis eine gültige Drehung ist (jede Achse genau einmal)
  const used = new Set(snapped.map((v) => (v.x ? 0 : v.y ? 1 : 2)))
  if (used.size !== 3) return q
  const sm = new Matrix4().makeBasis(snapped[0], snapped[1], snapped[2])
  if (sm.determinant() < 0) return q
  return new Quaternion().setFromRotationMatrix(sm)
}

export const GROUND_HALF = 4.5 // die Fläche ist 9 × 9 Meter groß
