// Alles rund um die bebilderten Seiten eines Körpers:
// Foto vorbereiten, freistellen, Ecken setzen und zur fertigen Seite entzerren.
import { canvasToBlob, loadPhoto, removeBackground } from './backgroundRemoval'
import { DEFAULT_CORNERS_CUTOUT, DEFAULT_CORNERS_PHOTO, outputSize, quadRatio, warpQuad } from './perspective'
import { faceSize, type FaceKey, type Quad } from '../types'

/** Eine Seite, während sie bearbeitet wird. */
export interface FaceDraft {
  original: Blob
  cutout: Blob | null
  useCutout: boolean
  corners: Quad
  /** Bei bereits gespeicherten Seiten: war das gespeicherte Foto freigestellt? */
  originalIsCutout?: boolean
  /** true, wenn Original und freigestelltes Bild gleich groß sind (Ecken passen zu beiden) */
  aligned?: boolean
  /** Vom Scan-Modus automatisch erkannte Ecken, für „Ecken zurücksetzen“ */
  autoCorners?: Quad
}

export function draftSource(f: FaceDraft): Blob {
  return f.useCutout && f.cutout ? f.cutout : f.original
}

export function draftIsCutout(f: FaceDraft): boolean {
  return f.useCutout && f.cutout ? true : !!f.originalIsCutout
}

/** Macht aus einem Foto (oder Videobild) eine neue Seite, möglichst freigestellt. */
export async function makeFaceDraft(photo: HTMLCanvasElement): Promise<{ draft: FaceDraft; cutoutFailed: boolean }> {
  const original = await canvasToBlob(photo, false)
  try {
    const cut = await removeBackground(photo)
    const cutout = await canvasToBlob(cut, true)
    return { draft: { original, cutout, useCutout: true, corners: DEFAULT_CORNERS_CUTOUT }, cutoutFailed: false }
  } catch (err) {
    console.error(err)
    return { draft: { original, cutout: null, useCutout: false, corners: DEFAULT_CORNERS_PHOTO }, cutoutFailed: true }
  }
}

// Bereits geöffnete Fotos merken, damit sie nicht ständig neu geladen werden
const decoded = new WeakMap<Blob, Promise<HTMLCanvasElement>>()
function decode(blob: Blob): Promise<HTMLCanvasElement> {
  let p = decoded.get(blob)
  if (!p) {
    p = loadPhoto(blob)
    decoded.set(blob, p)
  }
  return p
}

/**
 * Entzerrt eine Seite. Sind die Maße bekannt, bekommt das Bild genau deren Seitenverhältnis,
 * sonst das der markierten Fläche.
 */
export async function rectifyFace(
  key: FaceKey,
  f: FaceDraft,
  dims: { w: number; h: number; d: number },
): Promise<Blob> {
  const src = await decode(draftSource(f))
  const [fw, fh] = faceSize(key, dims.w, dims.h, dims.d)
  const ratio = fw > 0 && fh > 0 ? fw / fh : quadRatio(f.corners, src.width, src.height)
  const [ow, oh] = outputSize(ratio)
  const out = warpQuad(src, f.corners, ow, oh)
  return canvasToBlob(out, true)
}

/**
 * Seite aus dem Scan-Modus: Die Ecken wurden schon automatisch erkannt.
 * Das freigestellte Bild bleibt so groß wie das Foto, damit die Ecken zu beiden passen.
 */
export async function makeScannedDraft(frame: HTMLCanvasElement, corners: Quad): Promise<FaceDraft> {
  const original = await canvasToBlob(frame, false)
  let cutout: Blob | null = null
  try {
    cutout = await canvasToBlob(await removeBackground(frame, false), true)
  } catch (err) {
    console.error(err)
  }
  return { original, cutout, useCutout: !!cutout, corners, aligned: true, autoCorners: corners }
}

/** Ecken, auf die „Ecken zurücksetzen“ springt */
export function defaultCorners(f: FaceDraft): Quad {
  if (f.autoCorners) return f.autoCorners
  return draftIsCutout(f) ? DEFAULT_CORNERS_CUTOUT : DEFAULT_CORNERS_PHOTO
}
