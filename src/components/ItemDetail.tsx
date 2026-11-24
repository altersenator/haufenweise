import { useState } from 'react'
import { dims } from '../lib/format'
import { useObjectUrls } from '../lib/useObjectUrl'
import { CONDITION_LABELS, FACE_KEYS, FACE_LABELS, type FaceKey, type Item } from '../types'
import { useMemo } from 'react'
import { BodyPreview } from './BodyPreview'

interface Props {
  item: Item
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
}

export function ItemDetail({ item, onBack, onEdit, onDelete }: Props) {
  const blobs = useMemo(() => {
    const out: Partial<Record<FaceKey, Blob>> = {}
    if (item.faces) for (const k of FACE_KEYS) out[k] = item.faces[k]?.image
    else out.front = item.image
    return out
  }, [item])
  const urls = useObjectUrls(blobs)
  const shown = FACE_KEYS.filter((k) => blobs[k]).map((k) => FACE_LABELS[k])
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
      <BodyPreview faces={urls} widthCm={item.widthCm} heightCm={item.heightCm} depthCm={item.depthCm} maxPx={200} />
      <p className="quiet small">Bebilderte Seiten: {shown.join(', ')}</p>
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
