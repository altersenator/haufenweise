// Speichert Gegenstände vorerst nur auf diesem Gerät (IndexedDB im Browser).
// In Etappe 3 kommt Supabase dazu, dann liegen die Daten auf einem Server.
// Wenn der Browser IndexedDB nicht erlaubt, merken wir uns die Daten nur im Arbeitsspeicher.
import type { Item } from '../types'

const DB_NAME = 'haufenweise'
const STORE = 'items'

let dbPromise: Promise<IDBDatabase> | null = null
const memory = new Map<string, Item>()
let useMemory = false

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE, { keyPath: 'id' })
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
): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = run(tx.objectStore(STORE))
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
