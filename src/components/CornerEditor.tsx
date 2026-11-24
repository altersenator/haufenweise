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
  const scale = Math.min((cw - PAD * 2) / nw, MAX_H / nh)
  const dw = nw * scale
  const dh = nh * scale
  const ox = (cw - dw) / 2
  const oy = PAD
  const height = dh + PAD * 2

  const toPx = ([x, y]: Pt): Pt => [ox + x * dw, oy + y * dh]
  const pts = local.map(toPx)

  function pointFromEvent(e: React.PointerEvent): Pt {
    const rect = box.current!.getBoundingClientRect()
    const x = (e.clientX - rect.left - ox) / dw
    const y = (e.clientY - rect.top - oy) / dh
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
      <img
        src={imageUrl}
        alt=""
        className="corners-img checker-bg"
        style={{ left: ox, top: oy, width: dw, height: dh }}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
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
