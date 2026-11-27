// Ein Gegenstand, den jemand verschenken möchte.
export type Condition = 'wie-neu' | 'gut' | 'gebraucht' | 'bastler'

export const CONDITION_LABELS: Record<Condition, string> = {
  'wie-neu': 'Wie neu',
  gut: 'Gut',
  gebraucht: 'Gebraucht',
  bastler: 'Für Bastler',
}

// Die Seiten eines Körpers, so benannt, wie man vor dem Gegenstand steht.
// Die Unterseite fehlt bewusst, die sieht man im Haufen nicht.
export type FaceKey = 'front' | 'right' | 'back' | 'left' | 'top'
export const FACE_KEYS: FaceKey[] = ['front', 'right', 'back', 'left', 'top']
export const FACE_LABELS: Record<FaceKey, string> = {
  front: 'Vorne',
  right: 'Rechts',
  back: 'Hinten',
  left: 'Links',
  top: 'Oben',
}

/** Ein Punkt, relativ zur Bildgröße (0 bis 1). */
export type Pt = [number, number]
/** Die vier Ecken einer Seite auf dem Foto: oben links, oben rechts, unten rechts, unten links. */
export type Quad = [Pt, Pt, Pt, Pt]

export interface FaceData {
  /** Das Foto, auf dem die Ecken markiert wurden (freigestellt oder Original). */
  source: Blob
  isCutout: boolean
  corners: Quad
  /** Das entzerrte Bild, genau so groß wie die Seite des Körpers. */
  image: Blob
}

export interface Item {
  id: string
  createdAt: number
  title: string
  description: string
  condition: Condition
  // Maße in Zentimetern. Daraus entsteht der Körper im 3D-Haufen.
  widthCm: number
  heightCm: number
  depthCm: number
  /** Vorschaubild für Listen, in der Regel die entzerrte Vorderseite. */
  image: Blob
  isCutout: boolean
  /** Die bebilderten Seiten. Ältere Einträge haben nur image. */
  faces?: Partial<Record<FaceKey, FaceData>>
}

export type ItemDraft = Omit<Item, 'id' | 'createdAt'>

/** Welche Maße eine Seite hat: [waagerecht, senkrecht] in Zentimetern. */
export function faceSize(face: FaceKey, w: number, h: number, d: number): [number, number] {
  switch (face) {
    case 'front':
    case 'back':
      return [w, h]
    case 'left':
    case 'right':
      return [d, h]
    case 'top':
      return [w, d]
  }
}

export type Dim = 'width' | 'height' | 'depth' | 'none'

export interface EdgeInfo {
  /** An welche Seite diese Kante gepinnt wird */
  neighbor: string
  dim: Dim
}

/**
 * Für jede Seite: welche Kante auf dem Foto (oben, rechts, unten, links)
 * an welche andere Seite stößt und welches Maß sie hat.
 * Die Oberseite fotografiert man von vorne nach unten schauend.
 */
export const FACE_EDGES: Record<FaceKey, [EdgeInfo, EdgeInfo, EdgeInfo, EdgeInfo]> = {
  front: [
    { neighbor: 'Oben', dim: 'width' },
    { neighbor: 'Rechts', dim: 'height' },
    { neighbor: 'Boden', dim: 'width' },
    { neighbor: 'Links', dim: 'height' },
  ],
  right: [
    { neighbor: 'Oben', dim: 'depth' },
    { neighbor: 'Hinten', dim: 'height' },
    { neighbor: 'Boden', dim: 'depth' },
    { neighbor: 'Vorne', dim: 'height' },
  ],
  back: [
    { neighbor: 'Oben', dim: 'width' },
    { neighbor: 'Links', dim: 'height' },
    { neighbor: 'Boden', dim: 'width' },
    { neighbor: 'Rechts', dim: 'height' },
  ],
  left: [
    { neighbor: 'Oben', dim: 'depth' },
    { neighbor: 'Vorne', dim: 'height' },
    { neighbor: 'Boden', dim: 'depth' },
    { neighbor: 'Hinten', dim: 'height' },
  ],
  top: [
    { neighbor: 'Hinten', dim: 'width' },
    { neighbor: 'Rechts', dim: 'depth' },
    { neighbor: 'Vorne', dim: 'width' },
    { neighbor: 'Links', dim: 'depth' },
  ],
}

export const DIM_LABELS: Record<Dim, string> = { width: 'Breite', height: 'Höhe', depth: 'Tiefe', none: '' }

// ---- Haufen ----------------------------------------------------------------

/** Wo ein Gegenstand im 3D-Haufen liegt. Position in Metern, Drehung als Quaternion. */
export interface Placement {
  itemId: string
  pos: [number, number, number]
  rot: [number, number, number, number]
  /** Festgesetzt: bleibt, wo er ist, und lässt sich nicht verschieben */
  locked: boolean
}

export interface Heap {
  /** 'private' für den eigenen Haufen, später auch Community-Haufen */
  id: string
  placements: Placement[]
  updatedAt: number
}
