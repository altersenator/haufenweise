// Zeigt einen Gegenstand als Quader in seinen echten Proportionen.
// Das Foto liegt auf der Vorderseite. In Etappe 2 wird daraus ein echter 3D-Körper.
import { useRef, useState } from 'react'

interface Props {
  imageUrl: string | null
  widthCm: number
  heightCm: number
  depthCm: number
  maxPx?: number
}

export function BodyPreview({ imageUrl, widthCm, heightCm, depthCm, maxPx = 170 }: Props) {
  const [angle, setAngle] = useState(-32)
  const drag = useRef<{ x: number; start: number } | null>(null)

  const valid = widthCm > 0 && heightCm > 0 && depthCm > 0
  const w = valid ? widthCm : 1
  const h = valid ? heightCm : 1
  const d = valid ? depthCm : 1
  const s = maxPx / Math.max(w, h, d)
  const W = w * s
  const H = h * s
  const D = d * s

  return (
    <div
      className="body-stage"
      style={{ height: maxPx + 130 }}
      aria-label={valid ? `Körper ${widthCm} mal ${heightCm} mal ${depthCm} Zentimeter` : 'Noch keine Maße'}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, start: angle }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (drag.current) setAngle(drag.current.start + (e.clientX - drag.current.x) * 0.6)
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {valid ? (
        <div className="cuboid" style={{ width: W, height: H, transform: `rotateX(-16deg) rotateY(${angle}deg)` }}>
          <div className="face front" style={{ width: W, height: H, transform: `translateZ(${D / 2}px)` }}>
            {imageUrl && <img src={imageUrl} alt="" draggable={false} />}
          </div>
          <div className="face back" style={{ width: W, height: H, transform: `rotateY(180deg) translateZ(${D / 2}px)` }} />
          <div
            className="face side"
            style={{ width: D, height: H, left: (W - D) / 2, transform: `rotateY(90deg) translateZ(${W / 2}px)` }}
          />
          <div
            className="face side"
            style={{ width: D, height: H, left: (W - D) / 2, transform: `rotateY(-90deg) translateZ(${W / 2}px)` }}
          />
          <div
            className="face top"
            style={{ width: W, height: D, top: (H - D) / 2, transform: `rotateX(90deg) translateZ(${H / 2}px)` }}
          />
        </div>
      ) : (
        <p className="body-empty">Gib Breite, Höhe und Tiefe ein, dann erscheint hier der Körper.</p>
      )}
      {valid && <span className="body-hint">Zum Drehen wischen</span>}
    </div>
  )
}
