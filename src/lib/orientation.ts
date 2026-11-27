// Liest Kompass und Neigung des Handys.
// Daraus erkennt der Scan-Modus, wie weit man schon um den Gegenstand herumgegangen ist
// und ob man von oben auf ihn herabschaut.
import type { FaceKey } from '../types'

export interface CameraDirection {
  /** Himmelsrichtung, in die die Kamera zeigt, in Grad (0 bis 360) */
  heading: number
  /** Wie stark die Kamera nach unten zeigt: 0 = waagerecht, 1 = senkrecht nach unten */
  down: number
}

/**
 * Rechnet die drei Drehwinkel des Handys in die Blickrichtung der Rückkamera um.
 * Einfach "alpha" zu nehmen klappt nicht, wenn man das Handy aufrecht hält.
 */
export function cameraDirection(alpha: number, beta: number, gamma: number): CameraDirection {
  const r = Math.PI / 180
  const cA = Math.cos(alpha * r)
  const sA = Math.sin(alpha * r)
  const cB = Math.cos(beta * r)
  const sB = Math.sin(beta * r)
  const cG = Math.cos(gamma * r)
  const sG = Math.sin(gamma * r)
  // Die Kamera schaut entgegen der Bildschirm-Normalen (Rückseite des Handys)
  const vx = -(cA * sG + cG * sA * sB) // Osten
  const vy = -(sA * sG - cA * cG * sB) // Norden
  const vz = -(cB * cG) // oben
  const heading = ((Math.atan2(vx, vy) * 180) / Math.PI + 360) % 360
  return { heading, down: Math.max(0, -vz) }
}

/** Unterschied zweier Himmelsrichtungen, von -180 bis 180 Grad */
export function headingDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

/**
 * Welche Seite man vermutlich gerade sieht, wenn man bei startHeading vor der Vorderseite stand.
 * Geht man nach rechts um den Gegenstand, dreht man sich gegen den Uhrzeigersinn (Richtung nimmt ab).
 */
export function faceFromHeading(startHeading: number, heading: number): FaceKey {
  const d = headingDelta(startHeading, heading)
  if (Math.abs(d) <= 45) return 'front'
  if (d < -45 && d >= -135) return 'right'
  if (d > 45 && d <= 135) return 'left'
  return 'back'
}

type Listener = (dir: CameraDirection, absolute: boolean) => void

/** Startet das Lesen der Sensoren. Gibt eine Funktion zum Beenden zurück. */
export function watchOrientation(listener: Listener): () => void {
  let gotAbsolute = false
  const onAbsolute = (e: DeviceOrientationEvent) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return
    gotAbsolute = true
    listener(cameraDirection(e.alpha, e.beta, e.gamma), true)
  }
  const onRelative = (e: DeviceOrientationEvent) => {
    if (gotAbsolute || e.alpha == null || e.beta == null || e.gamma == null) return
    // iPhone liefert die Kompassrichtung extra
    const ios = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading
    const dir = cameraDirection(e.alpha, e.beta, e.gamma)
    listener(ios != null ? { ...dir, heading: ios } : dir, ios != null || e.absolute)
  }
  window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener)
  window.addEventListener('deviceorientation', onRelative)
  return () => {
    window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener)
    window.removeEventListener('deviceorientation', onRelative)
  }
}

/** Auf dem iPhone muss man die Sensoren ausdrücklich erlauben (nur nach einem Tipp möglich). */
export async function requestOrientationPermission(): Promise<void> {
  const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
  if (typeof D.requestPermission === 'function') {
    try {
      await D.requestPermission()
    } catch {
      /* dann eben ohne Kompass */
    }
  }
}
