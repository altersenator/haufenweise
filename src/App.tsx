// Haufenweise · Etappe 1
// Gegenstände fotografieren, freistellen, mit Maßen versehen und auf dem Gerät speichern.
import { useEffect, useState } from 'react'
import { ItemDetail } from './components/ItemDetail'
import { ItemEditor } from './components/ItemEditor'
import { SizeComparison } from './components/SizeComparison'
import { deleteItem, isTemporaryStorage, loadItems, newId, saveItem } from './lib/storage'
import { dims } from './lib/format'
import { useObjectUrl } from './lib/useObjectUrl'
import type { Item, ItemDraft } from './types'

type View = { name: 'list' } | { name: 'add' } | { name: 'detail'; id: string } | { name: 'edit'; id: string }

function ItemCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const url = useObjectUrl(item.image)
  return (
    <li>
      <button className="card" onClick={onOpen}>
        <span className="checker thumb">{url && <img src={url} alt="" />}</span>
        <span className="card-text">
          <strong>{item.title}</strong>
          <span className="quiet">{dims(item.widthCm, item.heightCm, item.depthCm)}</span>
        </span>
      </button>
    </li>
  )
}

export default function App() {
  const [items, setItems] = useState<Item[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<View>({ name: 'list' })

  useEffect(() => {
    loadItems().then((list) => {
      setItems(list)
      setLoaded(true)
    })
  }, [])

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [view])

  async function addItem(draft: ItemDraft) {
    const item: Item = { ...draft, id: newId(), createdAt: Date.now() }
    await saveItem(item)
    setItems((prev) => [item, ...prev])
    setView({ name: 'list' })
  }

  async function updateItem(id: string, draft: ItemDraft) {
    const old = items.find((i) => i.id === id)
    if (!old) return
    const item: Item = { ...old, ...draft }
    await saveItem(item)
    setItems((prev) => prev.map((i) => (i.id === id ? item : i)))
    setView({ name: 'detail', id })
  }

  async function removeItem(id: string) {
    await deleteItem(id)
    setItems((prev) => prev.filter((i) => i.id !== id))
    setView({ name: 'list' })
  }

  const current = view.name === 'detail' || view.name === 'edit' ? items.find((i) => i.id === view.id) : undefined

  return (
    <div className="app">
      <header className="top">
        <button className="brand" onClick={() => setView({ name: 'list' })}>
          Haufenweise
        </button>
        <span className="stage">Testversion · Etappe 1</span>
      </header>

      <main className="main">
        {view.name === 'list' && (
          <section>
            <div className="hero">
              <h1>Mein Haufen</h1>
              <p className="lead">
                {items.length === 0
                  ? 'Hier sammelst du alles, was du verschenken möchtest.'
                  : `${items.length} ${items.length === 1 ? 'Gegenstand' : 'Gegenstände'} zum Verschenken`}
              </p>
            </div>

            {loaded && isTemporaryStorage() && (
              <p className="notice">
                Dieser Browser erlaubt kein dauerhaftes Speichern. Deine Gegenstände bleiben nur erhalten, solange die
                Seite geöffnet ist.
              </p>
            )}

            {items.length > 0 && (
              <>
                <h2 className="section-title">Größenvergleich</h2>
                <SizeComparison items={items} onOpen={(id) => setView({ name: 'detail', id })} />
                <h2 className="section-title">Alle Gegenstände</h2>
                <ul className="cards">
                  {items.map((item) => (
                    <ItemCard key={item.id} item={item} onOpen={() => setView({ name: 'detail', id: item.id })} />
                  ))}
                </ul>
              </>
            )}

            {loaded && items.length === 0 && (
              <div className="empty">
                <p>
                  Noch ist dein Haufen leer. Fotografiere den ersten Gegenstand, trag seine Maße ein, und er erscheint
                  hier in der richtigen Größe.
                </p>
              </div>
            )}

            <button className="btn primary big fab" onClick={() => setView({ name: 'add' })}>
              + Gegenstand hinzufügen
            </button>
          </section>
        )}

        {view.name === 'add' && <ItemEditor onSave={addItem} onCancel={() => setView({ name: 'list' })} />}

        {view.name === 'detail' && current && (
          <ItemDetail
            item={current}
            onBack={() => setView({ name: 'list' })}
            onEdit={() => setView({ name: 'edit', id: current.id })}
            onDelete={() => removeItem(current.id)}
          />
        )}

        {view.name === 'edit' && current && (
          <ItemEditor
            initial={current}
            onSave={(draft) => updateItem(current.id, draft)}
            onCancel={() => setView({ name: 'detail', id: current.id })}
          />
        )}
      </main>
    </div>
  )
}
