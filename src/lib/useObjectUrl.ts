import { useEffect, useState } from 'react'

/** Macht aus einer Bilddatei (Blob) eine Adresse, die ein <img> anzeigen kann. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** Wie useObjectUrl, aber für mehrere Bilder auf einmal (zum Beispiel alle Seiten eines Körpers). */
export function useObjectUrls<K extends string>(blobs: Partial<Record<K, Blob | undefined>>): Partial<Record<K, string>> {
  const [urls, setUrls] = useState<Partial<Record<K, string>>>({})
  const [cache] = useState(() => new Map<Blob, string>())

  useEffect(() => {
    const next: Partial<Record<K, string>> = {}
    const used = new Set<Blob>()
    for (const key of Object.keys(blobs) as K[]) {
      const blob = blobs[key]
      if (!blob) continue
      used.add(blob)
      let url = cache.get(blob)
      if (!url) {
        url = URL.createObjectURL(blob)
        cache.set(blob, url)
      }
      next[key] = url
    }
    // Nicht mehr benötigte Adressen freigeben
    for (const [blob, url] of cache) {
      if (!used.has(blob)) {
        URL.revokeObjectURL(url)
        cache.delete(blob)
      }
    }
    setUrls(next)
  }, [blobs, cache])

  useEffect(
    () => () => {
      for (const url of cache.values()) URL.revokeObjectURL(url)
      cache.clear()
    },
    [cache],
  )

  return urls
}
