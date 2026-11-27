// Der Ablauf zum Erfassen oder Bearbeiten eines Gegenstands:
// Fotos oder ein Rundum-Video aufnehmen, auf jeder Seite die Ecken markieren,
// Angaben und Maße eintragen, speichern.
import { useEffect, useRef, useState } from 'react'
import { loadPhoto, preloadModel } from '../lib/backgroundRemoval'
import { defaultCorners, draftIsCutout, draftSource, makeFaceDraft, rectifyFace, type FaceDraft } from '../lib/faces'
import { cm } from '../lib/format'
import { DEFAULT_CORNERS_CUTOUT, DEFAULT_CORNERS_PHOTO, quadRatio } from '../lib/perspective'
import { useObjectUrl, useObjectUrls } from '../lib/useObjectUrl'
import {
  CONDITION_LABELS,
  FACE_EDGES,
  FACE_KEYS,
  FACE_LABELS,
  type Condition,
  type Dim,
  type FaceData,
  type FaceKey,
  type Item,
  type ItemDraft,
} from '../types'
import { BodyPreview } from './BodyPreview'
import { CornerEditor } from './CornerEditor'
import { PhotoAxes } from './PhotoAxes'
import { prepareScan, ScanMode } from './ScanMode'
import { VideoAround } from './VideoAround'

type Phase = 'pick' | 'working' | 'video' | 'scan' | 'form'
type Faces = Partial<Record<FaceKey, FaceDraft>>

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

/** Gespeicherte Seiten wieder in bearbeitbare Entwürfe verwandeln. */
function facesFromItem(item?: Item): Faces {
  if (!item) return {}
  if (item.faces) {
    const out: Faces = {}
    for (const key of FACE_KEYS) {
      const f = item.faces[key]
      if (f) out[key] = { original: f.source, cutout: null, useCutout: false, corners: f.corners, originalIsCutout: f.isCutout }
    }
    return out
  }
  // Ältere Einträge haben nur ein Bild für die Vorderseite
  return {
    front: {
      original: item.image,
      cutout: null,
      useCutout: false,
      corners: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      originalIsCutout: item.isCutout,
    },
  }
}

/** Welche Achsen das Koordinatensystem für eine Seite zeigt */
const FACE_AXES: Record<FaceKey, { h: Dim; v: Dim; z?: Dim }> = {
  front: { h: 'width', v: 'height', z: 'depth' },
  back: { h: 'width', v: 'height', z: 'depth' },
  right: { h: 'depth', v: 'height', z: 'width' },
  left: { h: 'depth', v: 'height', z: 'width' },
  top: { h: 'width', v: 'depth' },
}

const FACE_TIPS: Record<FaceKey, string> = {
  front: 'Stell dich gerade vor den Gegenstand.',
  right: 'Geh nach rechts um den Gegenstand herum und fotografiere die Seite, die vorher rechts war.',
  back: 'Fotografiere die Rückseite.',
  left: 'Fotografiere die Seite, die von vorne gesehen links ist.',
  top: 'Stell dich vor den Gegenstand und fotografiere schräg von oben nach unten.',
}

export function ItemEditor({ initial, onSave, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>(initial ? 'form' : 'pick')
  const [workMsg, setWorkMsg] = useState('')
  const [notice, setNotice] = useState('')

  const [faces, setFaces] = useState<Faces>(() => facesFromItem(initial))
  const [active, setActive] = useState<FaceKey>('front')
  const [rectified, setRectified] = useState<Partial<Record<FaceKey, Blob>>>({})
  const [videoFile, setVideoFile] = useState<Blob | null>(null)

  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [condition, setCondition] = useState<Condition>(initial?.condition ?? 'gut')
  const [width, setWidth] = useState(initial ? cm(initial.widthCm) : '')
  const [height, setHeight] = useState(initial ? cm(initial.heightCm) : '')
  const [depth, setDepth] = useState(initial ? cm(initial.depthCm) : '')
  const [triedSave, setTriedSave] = useState(false)
  const [saving, setSaving] = useState(false)
  const [srcSize, setSrcSize] = useState<{ w: number; h: number } | null>(null)

  const photoCamera = useRef<HTMLInputElement>(null)
  const photoGallery = useRef<HTMLInputElement>(null)
  const videoCamera = useRef<HTMLInputElement>(null)
  const videoGallery = useRef<HTMLInputElement>(null)
  const target = useRef<FaceKey>('front')

  const w = parseCm(width)
  const h = parseCm(height)
  const d = parseCm(depth)

  // Das Freistell-Modell schon laden, während man fotografiert.
  useEffect(() => {
    preloadModel().catch(() => {})
  }, [])

  // Jede Seite neu entzerren, wenn sich Foto, Ecken oder Maße ändern
  const lastKeys = useRef<Partial<Record<FaceKey, string>>>({})
  const blobIds = useRef(new WeakMap<Blob, number>())
  const nextId = useRef(1)
  useEffect(() => {
    const idOf = (b: Blob) => {
      let id = blobIds.current.get(b)
      if (!id) {
        id = nextId.current++
        blobIds.current.set(b, id)
      }
      return id
    }
    const timer = setTimeout(() => {
      for (const key of FACE_KEYS) {
        const f = faces[key]
        if (!f) {
          if (lastKeys.current[key]) {
            delete lastKeys.current[key]
            setRectified((prev) => {
              const next = { ...prev }
              delete next[key]
              return next
            })
          }
          continue
        }
        const sig = `${idOf(draftSource(f))}|${f.corners.flat().join(',')}|${w}|${h}|${d}`
        if (lastKeys.current[key] === sig) continue
        lastKeys.current[key] = sig
        rectifyFace(key, f, { w, h, d })
          .then((blob) => {
            if (lastKeys.current[key] === sig) setRectified((prev) => ({ ...prev, [key]: blob }))
          })
          .catch((err) => console.error(err))
      }
    }, 120)
    return () => clearTimeout(timer)
  }, [faces, w, h, d])

  const rectifiedUrls = useObjectUrls(rectified)
  const activeDraft = faces[active]
  const activeSourceUrl = useObjectUrl(activeDraft ? draftSource(activeDraft) : null)
  const cutoutUrl = useObjectUrl(activeDraft?.cutout)
  const originalUrl = useObjectUrl(activeDraft?.cutout ? activeDraft.original : null)

  // Größe des aktiven Fotos, für den Hinweis zum Seitenverhältnis
  useEffect(() => {
    if (!activeSourceUrl) return setSrcSize(null)
    const img = new Image()
    img.onload = () => setSrcSize({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = activeSourceUrl
  }, [activeSourceUrl])

  function setFace(key: FaceKey, draft: FaceDraft | undefined) {
    setFaces((prev) => {
      const next = { ...prev }
      if (draft) next[key] = draft
      else delete next[key]
      return next
    })
  }

  async function handlePhoto(file: File | undefined) {
    if (!file) return
    const key = target.current
    setPhase('working')
    setNotice('')
    try {
      setWorkMsg('Foto wird vorbereitet …')
      const photo = await loadPhoto(file)
      setWorkMsg('Hintergrund wird entfernt …')
      const { draft, cutoutFailed } = await makeFaceDraft(photo)
      setFace(key, draft)
      setActive(key)
      if (cutoutFailed) setNotice('Das Freistellen hat nicht geklappt. Du kannst das Originalfoto verwenden.')
    } catch (err) {
      console.error(err)
      setNotice('Dieses Foto konnte nicht geöffnet werden. Versuch es bitte mit einem anderen.')
    }
    setPhase('form')
  }

  function handleVideo(file: File | undefined) {
    if (!file) return
    setNotice('')
    setVideoFile(file)
    setPhase('video')
  }

  async function handleFrames(frames: Partial<Record<FaceKey, HTMLCanvasElement>>) {
    setPhase('working')
    const keys = FACE_KEYS.filter((k) => frames[k])
    let failed = 0
    for (let i = 0; i < keys.length; i++) {
      setWorkMsg(`Seite ${i + 1} von ${keys.length} wird freigestellt …`)
      const { draft, cutoutFailed } = await makeFaceDraft(frames[keys[i]]!)
      if (cutoutFailed) failed++
      setFace(keys[i], draft)
    }
    if (failed) setNotice('Bei einigen Bildern hat das Freistellen nicht geklappt, dort wird das Original verwendet.')
    setVideoFile(null)
    setActive('front')
    setPhase('form')
  }

  async function startScan() {
    setNotice('')
    await prepareScan()
    setPhase('scan')
  }

  function handleScanned(drafts: Faces) {
    setFaces((prev) => ({ ...prev, ...drafts }))
    const first = FACE_KEYS.find((k) => drafts[k])
    if (first) setActive(first)
    setPhase('form')
  }

  function takePhoto(key: FaceKey, from: 'camera' | 'gallery') {
    target.current = key
    ;(from === 'camera' ? photoCamera : photoGallery).current?.click()
  }

  function toggleCutout(useCutout: boolean) {
    if (!activeDraft) return
    // Beim Scannen sind beide Bilder gleich groß, dann bleiben die Ecken, wo sie sind
    const corners = activeDraft.aligned ? activeDraft.corners : useCutout ? DEFAULT_CORNERS_CUTOUT : DEFAULT_CORNERS_PHOTO
    setFace(active, { ...activeDraft, useCutout, corners })
  }

  function resetCorners() {
    if (!activeDraft) return
    setFace(active, { ...activeDraft, corners: defaultCorners(activeDraft) })
  }

  const errors = {
    title: title.trim() ? '' : 'Bitte gib dem Gegenstand einen Namen.',
    dims: w && h && d ? '' : 'Bitte trag alle drei Maße in Zentimetern ein (zwischen 1 und 1000).',
    image: faces.front ? '' : 'Bitte füge mindestens ein Foto der Vorderseite hinzu.',
  }
  const hasErrors = Object.values(errors).some(Boolean)

  // Passt die markierte Fläche grob zu den Maßen dieser Seite?
  const [fw, fh] = active === 'top' ? [w, d] : active === 'left' || active === 'right' ? [d, h] : [w, h]
  const markedRatio = activeDraft && srcSize ? quadRatio(activeDraft.corners, srcSize.w, srcSize.h) : 0
  const ratioDiff = fw && fh && markedRatio ? markedRatio / (fw / fh) : 1
  const ratioHint =
    ratioDiff > 1.4
      ? 'Die markierte Fläche wirkt deutlich breiter, als es deine Maße für diese Seite erwarten lassen.'
      : ratioDiff < 1 / 1.4
        ? 'Die markierte Fläche wirkt deutlich schmaler, als es deine Maße für diese Seite erwarten lassen.'
        : ''

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setTriedSave(true)
    if (hasErrors) return
    setSaving(true)
    try {
      const out: Partial<Record<FaceKey, FaceData>> = {}
      for (const key of FACE_KEYS) {
        const f = faces[key]
        if (!f) continue
        // Zum Speichern frisch entzerren, damit garantiert die aktuellen Maße gelten
        const image = await rectifyFace(key, f, { w, h, d })
        out[key] = { source: draftSource(f), isCutout: draftIsCutout(f), corners: f.corners, image }
      }
      await onSave({
        title: title.trim().slice(0, 60),
        description: description.trim().slice(0, 500),
        condition,
        widthCm: w,
        heightCm: h,
        depthCm: d,
        image: out.front!.image,
        isCutout: out.front!.isCutout,
        faces: out,
      })
    } catch (err) {
      console.error(err)
      setNotice('Speichern hat nicht geklappt. Versuch es bitte noch einmal.')
    } finally {
      setSaving(false)
    }
  }

  const fileInputs = (
    <>
      <input ref={photoCamera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { handlePhoto(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={photoGallery} type="file" accept="image/*" hidden onChange={(e) => { handlePhoto(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={videoCamera} type="file" accept="video/*" capture="environment" hidden onChange={(e) => { handleVideo(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={videoGallery} type="file" accept="video/*" hidden onChange={(e) => { handleVideo(e.target.files?.[0]); e.target.value = '' }} />
    </>
  )

  if (phase === 'pick') {
    return (
      <section className="editor">
        {fileInputs}
        <h2>Neuer Gegenstand</h2>
        <p className="lead">
          Scanne den Gegenstand, indem du mit der Kamera einmal herumgehst. Die App erkennt jede Seite und fotografiert sie
          automatisch.
        </p>
        {notice && <p className="notice">{notice}</p>}
        <div className="pick">
          <button className="btn primary big" onClick={startScan}>
            Gegenstand scannen
          </button>
          <button className="btn big" onClick={() => videoCamera.current?.click()}>
            Einmal rundherum filmen
          </button>
          <button className="btn big" onClick={() => takePhoto('front', 'camera')}>
            Vorderseite fotografieren
          </button>
          <div className="row">
            <button className="btn small" onClick={() => videoGallery.current?.click()}>
              Video aus der Galerie
            </button>
            <button className="btn small" onClick={() => takePhoto('front', 'gallery')}>
              Foto aus der Galerie
            </button>
          </div>
        </div>
        <p className="quiet small">
          Tipp: Starte vorne, geh langsam und gleichmäßig einmal ganz herum und ende wieder vorne. Etwa 20 bis 30
          Sekunden reichen.
        </p>
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

  if (phase === 'scan') {
    return (
      <ScanMode
        already={FACE_KEYS.filter((k) => faces[k])}
        onDone={handleScanned}
        onCancel={(reason) => {
          if (reason) setNotice(reason)
          setPhase(faces.front || initial ? 'form' : 'pick')
        }}
      />
    )
  }

  if (phase === 'video' && videoFile) {
    return (
      <section className="editor">
        <VideoAround
          file={videoFile}
          onDone={handleFrames}
          onCancel={() => {
            setVideoFile(null)
            setPhase(faces.front ? 'form' : 'pick')
          }}
        />
      </section>
    )
  }

  const axes = FACE_AXES[active]
  const dimValue = (dim: Dim) => (dim === 'width' ? w : dim === 'height' ? h : dim === 'depth' ? d : 0)

  return (
    <form className="editor" onSubmit={submit} noValidate>
      {fileInputs}
      <h2>{initial ? 'Gegenstand bearbeiten' : 'Neuer Gegenstand'}</h2>
      {notice && <p className="notice">{notice}</p>}

      <label className="field">
        <span>Was ist es?</span>
        <input value={title} maxLength={60} placeholder="zum Beispiel Holzregal" onChange={(e) => setTitle(e.target.value)} />
      </label>
      {triedSave && errors.title && <p className="err">{errors.title}</p>}

      <fieldset className="dims">
        <legend>Maße in Zentimetern</legend>
        <label>
          <span className="dim-x">Breite</span>
          <input inputMode="decimal" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="80" />
        </label>
        <label>
          <span className="dim-y">Höhe</span>
          <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="120" />
        </label>
        <label>
          <span className="dim-z">Tiefe</span>
          <input inputMode="decimal" value={depth} onChange={(e) => setDepth(e.target.value)} placeholder="30" />
        </label>
      </fieldset>
      {triedSave && errors.dims && <p className="err">{errors.dims}</p>}

      <section className="faces">
        <h3>Seiten bebildern</h3>
        <p className="quiet small">
          Zieh die vier Punkte auf die Ecken der Seite. Die Farbe einer Kante zeigt ihr Maß, die Beschriftung, an welche
          Seite sie gepinnt wird. Die App entzerrt das Foto dann und setzt die Seiten zum Körper zusammen.
        </p>
        <div className="row">
          <button type="button" className="btn small" onClick={startScan}>
            Seiten scannen
          </button>
          <button type="button" className="btn small" onClick={() => videoCamera.current?.click()}>
            Rundherum filmen
          </button>
          <button type="button" className="btn small" onClick={() => videoGallery.current?.click()}>
            Video aus der Galerie
          </button>
        </div>

        <div className="tabs" role="tablist" aria-label="Seiten">
          {FACE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active === key}
              className={`tab ${active === key ? 'on' : ''}`}
              onClick={() => setActive(key)}
            >
              <span className={`tab-dot ${faces[key] ? 'has' : ''}`} aria-hidden="true" />
              {FACE_LABELS[key]}
              {faces[key] ? <span className="sr-only"> (bebildert)</span> : null}
            </button>
          ))}
        </div>

        <div className="face-panel" role="tabpanel">
          {activeDraft && activeSourceUrl ? (
            <>
              {activeDraft.cutout && (
                <div className="segmented" role="radiogroup" aria-label="Welches Foto verwenden?">
                  <span className="seg-label">Foto</span>
                  <button type="button" role="radio" aria-checked={activeDraft.useCutout} className={activeDraft.useCutout ? 'on' : ''} onClick={() => toggleCutout(true)}>
                    Freigestellt
                  </button>
                  <button type="button" role="radio" aria-checked={!activeDraft.useCutout} className={!activeDraft.useCutout ? 'on' : ''} onClick={() => toggleCutout(false)}>
                    Original
                  </button>
                  {/* Vorschaubilder vorladen, damit das Umschalten sofort geht */}
                  <span hidden>
                    {cutoutUrl && <img src={cutoutUrl} alt="" />}
                    {originalUrl && <img src={originalUrl} alt="" />}
                  </span>
                </div>
              )}
              <CornerEditor
                imageUrl={activeSourceUrl}
                corners={activeDraft.corners}
                edges={FACE_EDGES[active]}
                dimValues={{ width: w, height: h, depth: d }}
                onChange={(corners) => setFace(active, { ...activeDraft, corners })}
              />
              {ratioHint && (
                <p className="notice">
                  {ratioHint} Prüf die Ecken und Maße. Hast du schräg fotografiert, kann das auch täuschen.
                </p>
              )}
              <div className="row">
                <button type="button" className="btn small" onClick={resetCorners}>
                  Ecken zurücksetzen
                </button>
                <button type="button" className="btn small" onClick={() => takePhoto(active, 'camera')}>
                  Neues Foto
                </button>
                <button type="button" className="btn small" onClick={() => takePhoto(active, 'gallery')}>
                  Aus der Galerie
                </button>
                {active !== 'front' && (
                  <button type="button" className="btn small danger-ghost" onClick={() => setFace(active, undefined)}>
                    Foto entfernen
                  </button>
                )}
              </div>
              {rectifiedUrls[active] && (
                <>
                  <h4 className="result-title">So sieht die Seite entzerrt aus</h4>
                  <PhotoAxes
                    imageUrl={rectifiedUrls[active]!}
                    h={{ dim: axes.h, value: dimValue(axes.h) }}
                    v={{ dim: axes.v, value: dimValue(axes.v) }}
                    z={axes.z ? { dim: axes.z, value: dimValue(axes.z) } : undefined}
                  />
                </>
              )}
            </>
          ) : (
            <div className="empty">
              <p>Für die Seite „{FACE_LABELS[active]}“ gibt es noch kein Foto. {FACE_TIPS[active]}</p>
              <div className="row" style={{ marginTop: 12 }}>
                <button type="button" className="btn primary small" onClick={() => takePhoto(active, 'camera')}>
                  Foto aufnehmen
                </button>
                <button type="button" className="btn small" onClick={() => takePhoto(active, 'gallery')}>
                  Aus der Galerie
                </button>
              </div>
            </div>
          )}
        </div>
        {triedSave && errors.image && <p className="err">{errors.image}</p>}
      </section>

      <h3>So wird der Körper</h3>
      <BodyPreview faces={rectifiedUrls} widthCm={w} heightCm={h} depthCm={d} />

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
