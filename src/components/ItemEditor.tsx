// Der Ablauf zum Erfassen oder Bearbeiten eines Gegenstands:
// Foto wählen, Hintergrund entfernen lassen, Angaben und Maße eintragen, speichern.
import { useEffect, useRef, useState } from 'react'
import { canvasToBlob, loadPhoto, preloadModel, removeBackground } from '../lib/backgroundRemoval'
import { cm } from '../lib/format'
import { useObjectUrl } from '../lib/useObjectUrl'
import { CONDITION_LABELS, type Condition, type Item, type ItemDraft } from '../types'
import { BodyPreview } from './BodyPreview'

type Phase = 'pick' | 'working' | 'form'

interface Props {
  initial?: Item
  onSave: (draft: ItemDraft) => Promise<void>
  onCancel: () => void
}

/** Liest eine Zahl, auch mit Komma ("45,5"). Gibt 0 zurück, wenn sie ungültig ist. */
function parseCm(value: string): number {
  const n = Number(value.replace(',', '.').trim())
  return Number.isFinite(n) && n > 0 && n <= 1000 ? Math.round(n * 10) / 10 : 0
}

export function ItemEditor({ initial, onSave, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>(initial ? 'form' : 'pick')
  const [workMsg, setWorkMsg] = useState('')
  const [notice, setNotice] = useState('')

  const [original, setOriginal] = useState<Blob | null>(null)
  const [cutout, setCutout] = useState<Blob | null>(null)
  const [existing, setExisting] = useState<Blob | null>(initial?.image ?? null)
  const [useCutout, setUseCutout] = useState(initial?.isCutout ?? true)

  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [condition, setCondition] = useState<Condition>(initial?.condition ?? 'gut')
  const [width, setWidth] = useState(initial ? cm(initial.widthCm) : '')
  const [height, setHeight] = useState(initial ? cm(initial.heightCm) : '')
  const [depth, setDepth] = useState(initial ? cm(initial.depthCm) : '')
  const [triedSave, setTriedSave] = useState(false)
  const [saving, setSaving] = useState(false)

  const cameraInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)

  // Das Modell schon laden, während man das Foto macht.
  useEffect(() => {
    preloadModel().catch(() => {})
  }, [])

  const chosen = existing ?? (useCutout && cutout ? cutout : original)
  const imageUrl = useObjectUrl(chosen)
  const originalUrl = useObjectUrl(original)
  const cutoutUrl = useObjectUrl(cutout)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setPhase('working')
    setNotice('')
    try {
      setWorkMsg('Foto wird vorbereitet …')
      const photo = await loadPhoto(file)
      setOriginal(await canvasToBlob(photo, false))
      setExisting(null)
      try {
        setWorkMsg('Hintergrund wird entfernt …')
        const cut = await removeBackground(photo)
        setCutout(await canvasToBlob(cut, true))
        setUseCutout(true)
      } catch (err) {
        console.error(err)
        setCutout(null)
        setUseCutout(false)
        setNotice('Das Freistellen hat nicht geklappt. Du kannst das Originalfoto verwenden oder es mit einem anderen Foto versuchen.')
      }
      setPhase('form')
    } catch (err) {
      console.error(err)
      setNotice('Dieses Foto konnte nicht geöffnet werden. Versuch es bitte mit einem anderen.')
      setPhase(initial || original ? 'form' : 'pick')
    }
  }

  const w = parseCm(width)
  const h = parseCm(height)
  const d = parseCm(depth)
  const errors = {
    title: title.trim() ? '' : 'Bitte gib dem Gegenstand einen Namen.',
    dims: w && h && d ? '' : 'Bitte trag alle drei Maße in Zentimetern ein (zwischen 1 und 1000).',
    image: chosen ? '' : 'Bitte füge ein Foto hinzu.',
  }
  const hasErrors = Object.values(errors).some(Boolean)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTriedSave(true)
    if (hasErrors || !chosen) return
    setSaving(true)
    try {
      await onSave({
        title: title.trim().slice(0, 60),
        description: description.trim().slice(0, 500),
        condition,
        widthCm: w,
        heightCm: h,
        depthCm: d,
        image: chosen,
        isCutout: existing ? (initial?.isCutout ?? false) : useCutout && !!cutout,
      })
    } finally {
      setSaving(false)
    }
  }

  const fileInputs = (
    <>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </>
  )

  if (phase === 'pick') {
    return (
      <section className="editor">
        {fileInputs}
        <h2>Neuer Gegenstand</h2>
        <p className="lead">
          Fotografiere den Gegenstand möglichst von vorne, vor einem ruhigen Hintergrund. Den Hintergrund entfernt die App
          danach automatisch.
        </p>
        {notice && <p className="notice">{notice}</p>}
        <div className="pick">
          <button className="btn primary big" onClick={() => cameraInput.current?.click()}>
            Foto aufnehmen
          </button>
          <button className="btn big" onClick={() => galleryInput.current?.click()}>
            Aus der Galerie wählen
          </button>
        </div>
        <button className="btn ghost" onClick={onCancel}>
          Abbrechen
        </button>
      </section>
    )
  }

  if (phase === 'working') {
    return (
      <section className="editor working" aria-live="polite">
        <div className="spinner" aria-hidden="true" />
        <p>{workMsg}</p>
        <p className="quiet">Beim ersten Mal dauert es etwas länger, weil die App das Freistell-Modell lädt.</p>
      </section>
    )
  }

  return (
    <form className="editor" onSubmit={submit} noValidate>
      {fileInputs}
      <h2>{initial ? 'Gegenstand bearbeiten' : 'Neuer Gegenstand'}</h2>

      {notice && <p className="notice">{notice}</p>}

      {!existing && cutout && original && (
        <div className="choice" role="radiogroup" aria-label="Welches Bild verwenden?">
          <button
            type="button"
            role="radio"
            aria-checked={useCutout}
            className={`choice-opt ${useCutout ? 'on' : ''}`}
            onClick={() => setUseCutout(true)}
          >
            <span className="checker">{cutoutUrl && <img src={cutoutUrl} alt="" />}</span>
            Freigestellt
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!useCutout}
            className={`choice-opt ${!useCutout ? 'on' : ''}`}
            onClick={() => setUseCutout(false)}
          >
            <span className="checker">{originalUrl && <img src={originalUrl} alt="" />}</span>
            Originalfoto
          </button>
        </div>
      )}

      <div className="photo-actions">
        <button type="button" className="btn small" onClick={() => cameraInput.current?.click()}>
          {chosen ? 'Neues Foto aufnehmen' : 'Foto aufnehmen'}
        </button>
        <button type="button" className="btn small" onClick={() => galleryInput.current?.click()}>
          Aus der Galerie
        </button>
      </div>
      {triedSave && errors.image && <p className="err">{errors.image}</p>}

      <label className="field">
        <span>Was ist es?</span>
        <input value={title} maxLength={60} placeholder="zum Beispiel Holzregal" onChange={(e) => setTitle(e.target.value)} />
      </label>
      {triedSave && errors.title && <p className="err">{errors.title}</p>}

      <fieldset className="dims">
        <legend>Maße in Zentimetern</legend>
        <label>
          <span>Breite</span>
          <input inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="80" />
        </label>
        <label>
          <span>Höhe</span>
          <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="120" />
        </label>
        <label>
          <span>Tiefe</span>
          <input inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} placeholder="30" />
        </label>
      </fieldset>
      {triedSave && errors.dims && <p className="err">{errors.dims}</p>}

      <BodyPreview imageUrl={imageUrl} widthCm={w} heightCm={h} depthCm={d} />

      <label className="field">
        <span>Zustand</span>
        <select value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
          {Object.entries(CONDITION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Beschreibung</span>
        <textarea
          value={description}
          maxLength={500}
          rows={3}
          placeholder="Was sollte man wissen? Zum Beispiel kleine Macken oder ob es zerlegbar ist."
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" className="btn primary" disabled={saving}>
          {saving ? 'Speichert …' : 'Speichern'}
        </button>
      </div>
    </form>
  )
}
