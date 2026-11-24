import { useState } from 'react'
import { dims } from '../lib/format'
import { useObjectUrl } from '../lib/useObjectUrl'
import { CONDITION_LABELS, type Item } from '../types'
import { BodyPreview } from './BodyPreview'

interface Props {
  item: Item
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
}

export function ItemDetail({ item, onBack, onEdit, onDelete }: Props) {
  const url = useObjectUrl(item.image)
  const [confirming, setConfirming] = useState(false)

  return (
    <section className="detail">
      <button className="btn ghost back" onClick={onBack}>
        ← Zurück zum Haufen
      </button>
      <h2>{item.title}</h2>
      <p className="dims-line">
        {dims(item.widthCm, item.heightCm, item.depthCm)} <span className="tag">{CONDITION_LABELS[item.condition]}</span>
      </p>
      <BodyPreview imageUrl={url} widthCm={item.widthCm} heightCm={item.heightCm} depthCm={item.depthCm} maxPx={200} />
      {item.description && <p className="desc">{item.description}</p>}
      <p className="quiet small">
        Breite × Höhe × Tiefe. Erfasst am {new Date(item.createdAt).toLocaleDateString('de-DE')}.
      </p>
      <div className="form-actions">
        <button className="btn danger-ghost" onClick={() => setConfirming(true)}>
          Löschen
        </button>
        <button className="btn primary" onClick={onEdit}>
          Bearbeiten
        </button>
      </div>

      {confirming && (
        <div className="dialog-backdrop" role="presentation" onClick={() => setConfirming(false)}>
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="del-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="del-title">„{item.title}“ löschen?</h3>
            <p>Der Gegenstand verschwindet aus deinem Haufen. Das lässt sich nicht rückgängig machen.</p>
            <div className="form-actions">
              <button className="btn ghost" onClick={() => setConfirming(false)} autoFocus>
                Behalten
              </button>
              <button className="btn danger" onClick={onDelete}>
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
