// Speichert Gegenstände vorerst nur auf diesem Gerät (IndexedDB im Browser).
// In Etappe 3 kommt Supabase dazu, dann liegen die Daten auf einem Server.
// Wenn der Browser IndexedDB nicht erlaubt, merken wir uns die Daten nur im Arbeitsspeicher.
import type { Heap, Item } from '../types'

const DB_NAME = 'haufenweise'
const STORE = 'items'
const HEAPS = 'heaps'

let dbPromise: Promise<IDBDatabase> | null = null
const memory = new Map<string, Item>()
let useMemory = false

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        // Version 2: zusätzlich die Aufstellung der Haufen
        const req = indexedDB.open(DB_NAME, 2)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
          if (!db.objectStoreNames.contains(HEAPS)) db.createObjectStore(HEAPS, { keyPath: 'id' })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      } catch (err) {
        reject(err)
      }
    })
  }
  return dbPromise
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
  storeName = STORE,
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const req = run(tx.objectStore(storeName))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** true, wenn Daten nur bis zum Schließen der Seite erhalten bleiben. */
export function isTemporaryStorage() {
  return useMemory
}

export async function loadItems(): Promise<Item[]> {
  try {
    const items = await withStore<Item[]>('readonly', (s) => s.getAll())
    return items.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    useMemory = true
    return [...memory.values()].sort((a, b) => b.createdAt - a.createdAt)
  }
}

export async function saveItem(item: Item): Promise<void> {
  if (useMemory) {
    memory.set(item.id, item)
    return
  }
  try {
    await withStore('readwrite', (s) => s.put(item))
  } catch {
    useMemory = true
    memory.set(item.id, item)
  }
}

export async function deleteItem(id: string): Promise<void> {
  if (useMemory) {
    memory.delete(id)
    return
  }
  try {
    await withStore('readwrite', (s) => s.delete(id))
  } catch {
    memory.delete(id)
  }
}

export function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

// ---- Haufen ----------------------------------------------------------------

const memoryHeaps = new Map<string, Heap>()

export async function loadHeap(id: string): Promise<Heap> {
  const empty: Heap = { id, placements: [], updatedAt: 0 }
  if (useMemory) return memoryHeaps.get(id) ?? empty
  try {
    return (await withStore<Heap | undefined>('readonly', (s) => s.get(id), HEAPS)) ?? empty
  } catch {
    return memoryHeaps.get(id) ?? empty
  }
}

export async function saveHeap(heap: Heap): Promise<void> {
  memoryHeaps.set(heap.id, heap)
  if (useMemory) return
  try {
    await withStore('readwrite', (s) => s.put(heap), HEAPS)
  } catch {
    /* bleibt im Arbeitsspeicher */
  }
}
