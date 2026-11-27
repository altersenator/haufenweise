// Scan-Modus: Man richtet die Kamera auf den Gegenstand und geht einmal herum.
// Die App legt live einen Rahmen um die sichtbare Seite und macht automatisch ein Foto,
// sobald das Bild ruhig ist und man gerade davor steht. Kompass und Neigung verraten,
// welche Seite man gerade vor sich hat.
import { useCallback, useEffect, useRef, useState } from 'react'
import { predictMask, preloadModel } from '../lib/backgroundRemoval'
import { detectQuad, ISSUE_TEXT, quadDistance, smoothQuad, type Issue } from '../lib/detect'
import { makeScannedDraft, type FaceDraft } from '../lib/faces'
import { faceFromHeading, requestOrientationPermission, watchOrientation, type CameraDirection } from '../lib/orientation'
import { FACE_KEYS, FACE_LABELS, type FaceKey, type Quad } from '../types'

const STEADY_MS = 1100 // so lange muss der Rahmen ruhig stehen
const STEADY_TOLERANCE = 0.025 // erlaubte Bewegung der Ecken (Anteil der Bildgröße)
const MAX_SIDE = 1280
const ORDER: FaceKey[] = ['front', 'right', 'back', 'left', 'top']

const NEXT_HINT: Record<FaceKey, string> = {
  front: 'Geh jetzt nach rechts um den Gegenstand herum.',
  right: 'Weiter zur Rückseite.',
  back: 'Weiter zur linken Seite.',
  left: 'Zum Schluss von oben auf den Gegenstand schauen.',
  top: 'Fertig? Dann tipp oben auf „Fertig“.',
}

interface Props {
  already: FaceKey[]
  onDone: (drafts: Partial<Record<FaceKey, FaceDraft>>) => void
  onCancel: (reason?: string) => void
}

export function ScanMode({ already, onDone, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'starting' | 'running' | 'error'>('starting')
  const [error, setError] = useState('')
  const [quad, setQuad] = useState<Quad | null>(null)
  const [issue, setIssue] = useState<Issue>('nothing')
  const [progress, setProgress] = useState(0)
  const [flash, setFlash] = useState(false)
  const [busy, setBusy] = useState(false)
  const [captured, setCaptured] = useState<Partial<Record<FaceKey, FaceDraft>>>({})
  const [manual, setManual] = useState<FaceKey | null>(null)
  const [hint, setHint] = useState('Richte die Kamera auf die Vorderseite.')
  const [dir, setDir] = useState<CameraDirection | null>(null)
  const [stage, setStage] = useState({ w: 360, h: 640 })

  const running = useRef(true)
  const busyRef = useRef(false)
  const history = useRef<{ t: number; quad: Quad }[]>([])
  const lastRaw = useRef<Quad | null>(null)
  // Nach einem Foto muss sich das Bild erst deutlich ändern, bevor die nächste Seite ausgelöst wird
  const needsChange = useRef<Quad | null>(null)
  const startHeading = useRef<number | null>(null)
  const dirRef = useRef<CameraDirection | null>(null)
  const capturedRef = useRef(captured)
  capturedRef.current = captured
  const manualRef = useRef(manual)
  manualRef.current = manual

  // Welche Seite ist gerade dran?
  const targetFace = useCallback((): FaceKey => {
    if (manualRef.current) return manualRef.current
    const d = dirRef.current
    if (d && d.down > 0.72) return 'top'
    const done = capturedRef.current
    if (d && startHeading.current != null) return faceFromHeading(startHeading.current, d.heading)
    return ORDER.find((k) => !done[k] && k !== 'top') ?? 'top'
  }, [])

  const target = (() => {
    void dir // neu berechnen, wenn sich die Richtung ändert
    return targetFace()
  })()

  // Kamera starten
  useEffect(() => {
    let stream: MediaStream | null = null
    running.current = true
    preloadModel().catch(() => {})
    ;(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera-api')
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } },
        })
        const v = videoRef.current!
        v.srcObject = stream
        await v.play()
        setStatus('running')
        loop()
      } catch (err) {
        console.error(err)
        const name = (err as Error)?.name
        setError(
          name === 'NotAllowedError'
            ? 'Die App darf die Kamera nicht benutzen. Erlaube den Kamerazugriff in den Browser-Einstellungen, oder nimm einzelne Fotos.'
            : 'Die Live-Kamera ist hier nicht verfügbar. In der Testumgebung bei Claude geht das nicht, in der richtigen App-Version schon. Bis dahin kannst du Fotos oder ein Video nehmen.',
        )
        setStatus('error')
      }
    })()
    const stop = watchOrientation((d) => {
      dirRef.current = d
      setDir(d)
    })
    return () => {
      running.current = false
      stop()
      stream?.getTracks().forEach((t) => t.stop())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Größe der Anzeigefläche für die Umrechnung des Rahmens
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function grabFrame(): HTMLCanvasElement {
    const v = videoRef.current!
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * scale)
    c.height = Math.round(v.videoHeight * scale)
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)
    return c
  }

  async function capture(face: FaceKey, corners: Quad, frameIn?: HTMLCanvasElement) {
    busyRef.current = true
    setBusy(true)
    setFlash(true)
    setTimeout(() => setFlash(false), 180)
    try {
      // Möglichst genau das Bild nehmen, auf dem der Rahmen erkannt wurde
      const frame = frameIn ?? grabFrame()
      if (face === 'front' && dirRef.current) startHeading.current = dirRef.current.heading
      needsChange.current = corners
      const draft = await makeScannedDraft(frame, corners)
      setCaptured((prev) => ({ ...prev, [face]: draft }))
      setManual(null)
      setHint(`${FACE_LABELS[face]} erfasst. ${NEXT_HINT[face]}`)
      try {
        navigator.vibrate?.(60)
      } catch {
        /* egal */
      }
    } catch (err) {
      console.error(err)
      setHint('Das Foto hat nicht geklappt. Versuch es noch einmal.')
    } finally {
      history.current = []
      setProgress(0)
      busyRef.current = false
      setBusy(false)
    }
  }

  async function loop() {
    const v = videoRef.current
    while (running.current && v) {
      if (busyRef.current || v.readyState < 2 || !v.videoWidth) {
        await new Promise((r) => setTimeout(r, 120))
        continue
      }
      try {
        const t0 = performance.now()
        const frame = grabFrame()
        const mask = await predictMask(frame)
        ;(window as unknown as { __scanMs?: number }).__scanMs = performance.now() - t0
        if (!running.current) break
        const det = detectQuad(mask, v.videoWidth / v.videoHeight)
        setIssue(det.issue)
        lastRaw.current = det.quad
        setQuad((prev) => (det.quad ? smoothQuad(prev, det.quad, 0.6) : null))

        if (needsChange.current && (det.issue !== 'none' || !det.quad || clearlyDifferent(det.quad, needsChange.current))) {
          needsChange.current = null
        }
        const face = targetFace()
        // Die Oberseite nur automatisch, wenn das Handy wirklich nach unten zeigt (oder man sie angetippt hat)
        const topBlocked = face === 'top' && !manualRef.current && !(dirRef.current && dirRef.current.down > 0.72)
        const already = ((!!capturedRef.current[face] || !!needsChange.current) && !manualRef.current) || topBlocked
        const now = performance.now()
        if (det.quad && det.issue === 'none' && !already) {
          // Alle bisherigen Rahmen müssen nah am aktuellen liegen, sonst beginnt die Zählung neu
          const h = history.current
          const stable = h.every((e) => quadDistance(e.quad, det.quad!) < STEADY_TOLERANCE) ? h : []
          stable.push({ t: now, quad: det.quad })
          history.current = stable
          const span = stable.length > 1 ? now - stable[0].t : 0
          setProgress(Math.min(1, span / STEADY_MS))
          if (span >= STEADY_MS) await capture(face, det.quad, frame)
        } else {
          history.current = []
          setProgress(0)
        }
      } catch (err) {
        console.error(err)
        await new Promise((r) => setTimeout(r, 300))
      }
      await new Promise((r) => setTimeout(r, 30))
    }
  }

  // Rahmen von Bildkoordinaten (0 bis 1) in Bildschirmpunkte umrechnen (Video füllt die Fläche)
  const v = videoRef.current
  const vw = v?.videoWidth || 4
  const vh = v?.videoHeight || 3
  const s = Math.max(stage.w / vw, stage.h / vh)
  const ox = (stage.w - vw * s) / 2
  const oy = (stage.h - vh * s) / 2
  const toScreen = ([x, y]: [number, number]) => `${ox + x * vw * s},${oy + y * vh * s}`

  const done = Object.keys(captured).length
  const targetDone = !!captured[target] && !manual
  const message =
    status !== 'running'
      ? ''
      : busy
        ? 'Foto wird verarbeitet …'
        : target === 'top' && !manual && !(dir && dir.down > 0.72) && !captured.top
          ? 'Für die Oberseite das Handy schräg nach unten richten oder unten auf „Oben“ tippen.'
          : targetDone
            ? `${FACE_LABELS[target]} ist schon erfasst. ${NEXT_HINT[target]}`
            : issue === 'none'
              ? `${FACE_LABELS[target]}: ${ISSUE_TEXT.none}`
              : ISSUE_TEXT[issue]
  const frameClass = issue === 'none' && !targetDone ? (progress > 0 ? 'ok' : 'seen') : quad ? 'warn' : ''

  return (
    <div className="scan" role="dialog" aria-modal="true" aria-label="Gegenstand scannen">
      <div className="scan-top">
        <button className="scan-btn" onClick={() => onCancel()}>
          Abbrechen
        </button>
        <span className="scan-title">Scannen</span>
        <button className="scan-btn strong" onClick={() => onDone(captured)} disabled={!done || busy}>
          Fertig{done ? ` (${done})` : ''}
        </button>
      </div>

      <div className="scan-stage" ref={stageRef}>
        <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
        {status === 'running' && quad && (
          <svg className="scan-overlay" width={stage.w} height={stage.h} aria-hidden="true">
            <polygon points={quad.map(toScreen).join(' ')} className={`scan-quad ${frameClass}`} />
            {quad.map((p, i) => {
              const [x, y] = toScreen(p).split(',').map(Number)
              return <circle key={i} cx={x} cy={y} r={7} className={`scan-corner ${frameClass}`} />
            })}
          </svg>
        )}
        {flash && <div className="scan-flash" />}
        {status === 'starting' && <p className="scan-center">Kamera wird gestartet …</p>}
        {status === 'error' && (
          <div className="scan-center scan-error">
            <p>{error}</p>
            <button className="btn primary" onClick={() => onCancel(error)}>
              Zurück
            </button>
          </div>
        )}
      </div>

      {status === 'running' && (
        <div className="scan-bottom">
          <div className="scan-msg" aria-live="polite">
            <span className="scan-ring" style={{ ['--p' as string]: progress }} aria-hidden="true" />
            <span>{message}</span>
          </div>
          {hint && !busy && <p className="scan-hint">{hint}</p>}
          <div className="scan-chips" role="group" aria-label="Seiten">
            {FACE_KEYS.map((k) => (
              <button
                key={k}
                className={`scan-chip ${k === target ? 'target' : ''} ${captured[k] ? 'done' : already.includes(k) ? 'had' : ''}`}
                onClick={() => setManual(manual === k ? null : k)}
                aria-pressed={manual === k}
              >
                {captured[k] ? '✓ ' : ''}
                {FACE_LABELS[k]}
              </button>
            ))}
          </div>
          <button
            className="btn small scan-shutter"
            disabled={busy}
            onClick={() =>
              capture(
                target,
                lastRaw.current ?? [
                  [0.15, 0.15],
                  [0.85, 0.15],
                  [0.85, 0.85],
                  [0.15, 0.85],
                ],
              )
            }
          >
            {FACE_LABELS[target]} jetzt fotografieren
          </button>
        </div>
      )}
    </div>
  )
}

/** Hat sich der Rahmen so verändert, dass man wohl eine andere Seite sieht? */
function clearlyDifferent(a: Quad, b: Quad): boolean {
  const size = (q: Quad) => {
    const w = (Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) / 2
    const h = (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2
    return { w, h }
  }
  const sa = size(a)
  const sb = size(b)
  const ratio = sa.w / sa.h / (sb.w / sb.h)
  const area = (sa.w * sa.h) / (sb.w * sb.h)
  return quadDistance(a, b) > 0.12 || ratio < 0.78 || ratio > 1.28 || area < 0.7 || area > 1.43
}

/** Vor dem Start einmal aufrufen (nach einem Tipp), damit das iPhone den Kompass freigibt. */
export const prepareScan = requestOrientationPermission
