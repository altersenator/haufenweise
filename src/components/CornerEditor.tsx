// Auf dem Foto die vier Ecken einer Seite markieren.
// Jede Kante ist in der Farbe ihres Maßes eingefärbt (Breite, Höhe, Tiefe)
// und zeigt an, an welche Nachbarseite sie gepinnt wird.
import { useEffect, useRef, useState } from 'react'
import { cm } from '../lib/format'
import { DIM_LABELS, type EdgeInfo, type Pt, type Quad } from '../types'

interface Props {
  imageUrl: string
  corners: Quad
  edges: [EdgeInfo, EdgeInfo, EdgeInfo, EdgeInfo]
  dimValues: { width: number; height: number; depth: number }
  onChange: (corners: Quad) => void
}

const PAD = 34 // Platz rund ums Foto für Griffe und Beschriftungen
const MAX_H = 340
const CORNER_NAMES = ['oben links', 'oben rechts', 'unten rechts', 'unten links']

/** Bildausschnitt rund um die Ecken, mit Rand. Werte relativ zur Bildgröße. */
function viewAround(q: Quad) {
  const xs = q.map((p) => p[0])
  const ys = q.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const w = Math.min(1, Math.max(0.35, (maxX - minX) * 1.6))
  const h = Math.min(1, Math.max(0.35, (maxY - minY) * 1.6))
  const x = Math.min(1 - w, Math.max(0, (minX + maxX) / 2 - w / 2))
  const y = Math.min(1 - h, Math.max(0, (minY + maxY) / 2 - h / 2))
  return { x, y, w, h }
}

export function CornerEditor({ imageUrl, corners, edges, dimValues, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(320)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [local, setLocal] = useState<Quad>(corners)
  const dragging = useRef<number | null>(null)

  useEffect(() => setLocal(corners), [corners])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setCw(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nw = natural?.w ?? 4
  const nh = natural?.h ?? 3

  // Ausschnitt: Ist die Seite im Foto klein (zum Beispiel beim Scannen), wird auf sie gezoomt.
  // Der Ausschnitt richtet sich nach den gespeicherten Ecken und bleibt beim Ziehen stehen.
  const view = viewAround(corners)
  const scale = Math.min((cw - PAD * 2) / (nw * view.w), MAX_H / (nh * view.h))
  const dw = nw * view.w * scale // sichtbarer Ausschnitt in Bildschirmpunkten
  const dh = nh * view.h * scale
  const ox = (cw - dw) / 2
  const oy = PAD
  const height = dh + PAD * 2
  const fullW = dw / view.w
  const fullH = dh / view.h

  const toPx = ([x, y]: Pt): Pt => [ox + ((x - view.x) / view.w) * dw, oy + ((y - view.y) / view.h) * dh]
  const pts = local.map(toPx)

  function pointFromEvent(e: React.PointerEvent): Pt {
    const rect = box.current!.getBoundingClientRect()
    const x = view.x + ((e.clientX - rect.left - ox) / dw) * view.w
    const y = view.y + ((e.clientY - rect.top - oy) / dh) * view.h
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]
  }

  function move(e: React.PointerEvent) {
    const i = dragging.current
    if (i === null) return
    const next = [...local] as Quad
    next[i] = pointFromEvent(e)
    setLocal(next)
  }

  function end() {
    if (dragging.current === null) return
    dragging.current = null
    onChange(local)
  }

  /** Mit den Pfeiltasten eine Ecke fein verschieben (für Tastatur-Nutzer). */
  function nudge(i: number, e: React.KeyboardEvent) {
    const step = e.shiftKey ? 0.02 : 0.005
    const d: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const v = d[e.key]
    if (!v) return
    e.preventDefault()
    const next = [...local] as Quad
    next[i] = [Math.min(1, Math.max(0, local[i][0] + v[0])), Math.min(1, Math.max(0, local[i][1] + v[1]))]
    setLocal(next)
    onChange(next)
  }

  return (
    <div className="corners" ref={box} style={{ height }}>
      <div className="corners-view" style={{ left: ox, top: oy, width: dw, height: dh }}>
        <img
          src={imageUrl}
          alt=""
          className="checker-bg"
          style={{ left: -view.x * fullW, top: -view.y * fullH, width: fullW, height: fullH }}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      </div>
      <svg width={cw} height={height} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
        {/* Außerhalb der markierten Fläche abdunkeln */}
        <path
          d={`M0 0H${cw}V${height}H0Z M${pts.map((p) => p.join(' ')).join(' L')}Z`}
          fillRule="evenodd"
          className="corners-shade"
        />
        {edges.map((edge, i) => {
          const a = pts[i]
          const b = pts[(i + 1) % 4]
          const mx = (a[0] + b[0]) / 2
          const my = (a[1] + b[1]) / 2
          // Beschriftung nach außen versetzen
          const cx = pts.reduce((s, p) => s + p[0], 0) / 4
          const cy = pts.reduce((s, p) => s + p[1], 0) / 4
          const len = Math.hypot(mx - cx, my - cy) || 1
          const off = 16
          const lx = mx + ((mx - cx) / len) * off
          const ly = my + ((my - cy) / len) * off
          // Senkrechte Kanten: Text entlang der Kante drehen, damit er nicht ins Bild ragt
          let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
          if (angle > 90) angle -= 180
          if (angle < -90) angle += 180
          const value = edge.dim === 'none' ? 0 : dimValues[edge.dim]
          const tx = Math.min(cw - 10, Math.max(10, lx))
          const ty = Math.min(height - 8, Math.max(12, ly))
          return (
            <g key={i}>
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={`edge edge-${edge.dim}`} />
              <text
                x={tx}
                y={ty}
                dy="0.35em"
                textAnchor="middle"
                transform={`rotate(${angle} ${tx} ${ty})`}
                className={`edge-label edge-text-${edge.dim}`}
              >
                {DIM_LABELS[edge.dim]}
                {value ? ` ${cm(value)}` : ''} · an {edge.neighbor}
              </text>
            </g>
          )
        })}
        {pts.map((p, i) => (
          <g
            key={i}
            className="handle"
            role="slider"
            tabIndex={0}
            aria-label={`Ecke ${CORNER_NAMES[i]}, mit Pfeiltasten verschieben`}
            aria-valuenow={Math.round(local[i][0] * 100)}
            onKeyDown={(e) => nudge(i, e)}
            onPointerDown={(e) => {
              dragging.current = i
              ;(e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId)
              move(e)
            }}
          >
            <circle cx={p[0]} cy={p[1]} r={24} className="handle-hit" />
            <circle cx={p[0]} cy={p[1]} r={11} className="handle-dot" />
            <circle cx={p[0]} cy={p[1]} r={3} className="handle-center" />
          </g>
        ))}
      </svg>
    </div>
  )
}
