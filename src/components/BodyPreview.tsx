// Zeigt einen Gegenstand als Quader in seinen echten Proportionen.
// Jede bebilderte Seite zeigt ihr entzerrtes Foto. Man kann den Körper
// mit dem Finger in alle Richtungen drehen. In Etappe 2 wird daraus ein echter 3D-Körper.
import { useRef, useState } from 'react'
import { cm } from '../lib/format'
import type { FaceKey } from '../types'

interface Props {
  faces: Partial<Record<FaceKey, string | null>>
  widthCm: number
  heightCm: number
  depthCm: number
  maxPx?: number
}

export function BodyPreview({ faces, widthCm, heightCm, depthCm, maxPx = 170 }: Props) {
  const [rot, setRot] = useState({ x: -18, y: -32 })
  const drag = useRef<{ x: number; y: number; start: { x: number; y: number } } | null>(null)

  const valid = widthCm > 0 && heightCm > 0 && depthCm > 0
  const w = valid ? widthCm : 1
  const h = valid ? heightCm : 1
  const d = valid ? depthCm : 1
  const s = maxPx / Math.max(w, h, d)
  const W = w * s
  const H = h * s
  const D = d * s

  const img = (key: FaceKey) => (faces[key] ? <img src={faces[key]!} alt="" draggable={false} /> : null)

  return (
    <div
      className="body-stage"
      style={{ height: maxPx + 150 }}
      aria-label={valid ? `Körper ${cm(widthCm)} mal ${cm(heightCm)} mal ${cm(depthCm)} Zentimeter` : 'Noch keine Maße'}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, start: rot }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const g = drag.current
        if (!g) return
        setRot({
          y: g.start.y + (e.clientX - g.x) * 0.6,
          x: Math.max(-80, Math.min(25, g.start.x - (e.clientY - g.y) * 0.5)),
        })
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {valid ? (
        <div className="cuboid" style={{ width: W, height: H, transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg)` }}>
          <div className="face front" style={{ width: W, height: H, transform: `translateZ(${D / 2}px)` }}>
            {img('front')}
          </div>
          <div className="face back" style={{ width: W, height: H, transform: `rotateY(180deg) translateZ(${D / 2}px)` }}>
            {img('back')}
          </div>
          <div
            className="face side"
            style={{ width: D, height: H, left: (W - D) / 2, transform: `rotateY(90deg) translateZ(${W / 2}px)` }}
          >
            {img('right')}
          </div>
          <div
            className="face side"
            style={{ width: D, height: H, left: (W - D) / 2, transform: `rotateY(-90deg) translateZ(${W / 2}px)` }}
          >
            {img('left')}
          </div>
          <div
            className="face top"
            style={{ width: W, height: D, top: (H - D) / 2, transform: `rotateX(90deg) translateZ(${H / 2}px)` }}
          >
            {img('top')}
          </div>
        </div>
      ) : (
        <p className="body-empty">Gib Breite, Höhe und Tiefe ein, dann erscheint hier der Körper.</p>
      )}
      {valid && <span className="body-hint">Zum Drehen in alle Richtungen wischen</span>}
    </div>
  )
}
