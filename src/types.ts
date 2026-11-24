// Ein Gegenstand, den jemand verschenken möchte.
export type Condition = 'wie-neu' | 'gut' | 'gebraucht' | 'bastler'

export const CONDITION_LABELS: Record<Condition, string> = {
  'wie-neu': 'Wie neu',
  gut: 'Gut',
  gebraucht: 'Gebraucht',
  bastler: 'Für Bastler',
}

export interface Item {
  id: string
  createdAt: number
  title: string
  description: string
  condition: Condition
  // Maße in Zentimetern. Daraus entsteht später der Körper im 3D-Haufen.
  widthCm: number
  heightCm: number
  depthCm: number
  // Das Bild, das auf der Vorderseite des Körpers liegt (freigestellt oder Original).
  image: Blob
  isCutout: boolean
}

export type ItemDraft = Omit<Item, 'id' | 'createdAt'>
