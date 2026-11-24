// Aus einem Video, bei dem man einmal um den Gegenstand herumgeht,
// je ein Standbild für Vorne, Rechts, Hinten und Links auswählen.
// Die App schlägt Zeitpunkte vor (bei 0, 1/4, 1/2 und 3/4 der Länge),
// mit dem Schieberegler kann man jedes Bild genau einstellen.
import { useEffect, useRef, useState } from 'react'
import { grabFrame, loadVideo, type LoadedVideo } from '../lib/video'
import { FACE_LABELS, type FaceKey } from '../types'

type Side = 'front' | 'right' | 'back' | 'left'
const SIDES: Side[] = ['front', 'right', 'back', 'left']

function suggest(duration: number, direction: 'right' | 'left'): Record<Side, number> {
  const at = (f: number) => Math.round(duration * f * 20) / 20
  return direction === 'right'
    ? { front: at(0.02), right: at(0.25), back: at(0.5), left: at(0.75) }
    : { front: at(0.02), left: at(0.25), back: at(0.5), right: at(0.75) }
}

interface Props {
  file: Blob
  onDone: (frames: Partial<Record<FaceKey, HTMLCanvasElement>>) => void
  onCancel: () => void
}

export function VideoAround({ file, onDone, onCancel }: Props) {
  const [vid, setVid] = useState<LoadedVideo | null>(null)
  const [error, setError] = useState('')
  const [direction, setDirection] = useState<'right' | 'left'>('right')
  const [times, setTimes] = useState<Record<Side, number> | null>(null)
  const [thumbs, setThumbs] = useState<Partial<Record<Side, string>>>({})
  const [busy, setBusy] = useState(false)
  const latest = useRef<Partial<Record<Side, number>>>({})

  useEffect(() => {
    let alive = true
    let loaded: LoadedVideo | null = null
    loadVideo(file)
      .then((v) => {
        loaded = v
        if (!alive) return v.dispose()
        setVid(v)
        setTimes(suggest(v.duration, 'right'))
      })
      .catch((err) => {
        console.error(err)
        setError('Dieses Video kann der Browser leider nicht öffnen. Versuch es mit einem anderen Video oder mit einzelnen Fotos.')
      })
    return () => {
      alive = false
      loaded?.dispose()
    }
  }, [file])

  // Vorschaubild aktualisieren, wenn sich ein Zeitpunkt ändert
  useEffect(() => {
    if (!vid || !times) return
    for (const side of SIDES) {
      const t = times[side]
      if (latest.current[side] === t) continue
      latest.current[side] = t
      grabFrame(vid, t, 360)
        .then((c) => {
          if (latest.current[side] === t) setThumbs((prev) => ({ ...prev, [side]: c.toDataURL('image/jpeg', 0.75) }))
        })
        .catch(() => {})
    }
  }, [vid, times])

  function changeDirection(d: 'right' | 'left') {
    setDirection(d)
    if (vid) setTimes(suggest(vid.duration, d))
  }

  async function apply() {
    if (!vid || !times) return
    setBusy(true)
    try {
      const frames: Partial<Record<FaceKey, HTMLCanvasElement>> = {}
      for (const side of SIDES) frames[side] = await grabFrame(vid, times[side])
      onDone(frames)
    } catch (err) {
      console.error(err)
      setError('Die Standbilder konnten nicht erstellt werden.')
      setBusy(false)
    }
  }

  if (error) {
    return (
      <section className="video">
        <p className="notice">{error}</p>
        <button className="btn" onClick={onCancel}>
          Zurück
        </button>
      </section>
    )
  }

  if (!vid || !times) {
    return (
      <section className="video working" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <p>Video wird geladen …</p>
      </section>
    )
  }

  return (
    <section className="video">
      <h3>Standbilder aus dem Video</h3>
      <p className="quiet small">
        Die App hat für jede Seite ein Bild vorgeschlagen. Schieb den Regler, bis die Seite möglichst gerade zu sehen ist.
      </p>

      <div className="segmented" role="radiogroup" aria-label="In welche Richtung bist du gelaufen?">
        <span className="seg-label">Gelaufen nach</span>
        <button type="button" role="radio" aria-checked={direction === 'right'} className={direction === 'right' ? 'on' : ''} onClick={() => changeDirection('right')}>
          rechts
        </button>
        <button type="button" role="radio" aria-checked={direction === 'left'} className={direction === 'left' ? 'on' : ''} onClick={() => changeDirection('left')}>
          links
        </button>
      </div>

      <div className="frames">
        {SIDES.map((side) => (
          <div key={side} className="frame">
            <div className="frame-img">{thumbs[side] ? <img src={thumbs[side]} alt={`Standbild ${FACE_LABELS[side]}`} /> : <div className="spinner small" />}</div>
            <label className="frame-label">
              <span>
                {FACE_LABELS[side]} <span className="quiet">bei {times[side].toFixed(1).replace('.', ',')} s</span>
              </span>
              <input
                type="range"
                min={0}
                max={vid.duration}
                step={0.05}
                value={times[side]}
                onChange={(e) => setTimes({ ...times, [side]: Number(e.target.value) })}
              />
            </label>
          </div>
        ))}
      </div>

      <p className="quiet small">Die Oberseite fotografierst du danach am besten einzeln von oben.</p>

      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
        <button type="button" className="btn primary" onClick={apply} disabled={busy}>
          {busy ? 'Übernimmt …' : 'Bilder übernehmen'}
        </button>
      </div>
    </section>
  )
}
