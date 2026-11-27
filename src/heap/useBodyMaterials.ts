// Erstellt für einen Gegenstand die sechs Materialien seines Quaders, mit den Fotos der Seiten.
import { useEffect, useState } from 'react'
import { MeshStandardMaterial, SRGBColorSpace, TextureLoader, type Material, type Texture } from 'three'
import type { FaceKey, Item } from '../types'

// Reihenfolge der Seiten bei einem Three.js-Quader: +x, -x, +y, -y, +z, -z
const ORDER: (FaceKey | null)[] = ['right', 'left', 'top', null, 'front', 'back']
const NEUTRAL = '#cfc8bb' // Seiten ohne Foto
const loader = new TextureLoader()

function blankMaterials(): Material[] {
  return ORDER.map(() => new MeshStandardMaterial({ color: NEUTRAL, roughness: 0.9 }))
}

export function useBodyMaterials(item: Item): Material[] {
  const [materials, setMaterials] = useState<Material[]>(blankMaterials)

  useEffect(() => {
    const blobs: Partial<Record<FaceKey, Blob>> = {}
    if (item.faces) for (const [k, f] of Object.entries(item.faces)) blobs[k as FaceKey] = f?.image
    else blobs.front = item.image

    const urls: string[] = []
    const textures: Texture[] = []
    const mats = ORDER.map((key) => {
      const blob = key ? blobs[key] : undefined
      if (!blob) return new MeshStandardMaterial({ color: NEUTRAL, roughness: 0.9 })
      const url = URL.createObjectURL(blob)
      urls.push(url)
      const tex = loader.load(url)
      tex.colorSpace = SRGBColorSpace
      tex.anisotropy = 4
      textures.push(tex)
      // Durchsichtige Stellen (vom Freistellen) bleiben durchsichtig
      return new MeshStandardMaterial({ map: tex, alphaTest: 0.4, roughness: 0.85 })
    })
    setMaterials(mats)

    return () => {
      mats.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [item])

  return materials
}
