// Zeigt das (freigestellte) Foto mit einem Koordinatensystem darüber.
// So sieht man beim Eintragen, welche Richtung Breite, Höhe und Tiefe sind,
// und an den Skalenstrichen, ob die eingetragenen Maße zum Foto passen.
import { useEffect, useRef, useState } from 'react'
import { cm } from '../lib/format'
import { DIM_LABELS, type Dim } from '../types'

interface Axis {
  dim: Dim
  value: number
}

interface Props {
  imageUrl: string
  /** waagerechte Achse, senkrechte Achse und die schräge Achse nach hinten */
  h: Axis
  v: Axis
  z?: Axis
  /** Meldet das Seitenverhältnis des Fotos (Breite / Höhe), sobald es geladen ist. */
  onRatio?: (ratio: number) => void
}

// Platz rund um das Foto für Achsen und Beschriftungen
const L = 52
const R = 48
const T = 56
const B = 48
const MAX_H = 260

function niceStep(value: number) {
  if (value <= 30) return 5
  if (value <= 80) return 10
  if (value <= 200) return 20
  if (value <= 500) return 50
  return 100
}

function ticks(value: number) {
  if (!value) return []
  const step = niceStep(value)
  const list: number[] = []
  for (let t = step; t < value - step * 0.25; t += step) list.push(t)
  return list
}

export function PhotoAxes({ imageUrl, h, v, z, onRatio }: Props) {
  const widthCm = h.value
  const heightCm = v.value
  const depthCm = z?.value ?? 0
  const box = useRef<HTMLDivElement>(null)
  const [cw, setCw] = useState(320)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setCw(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nw = natural?.w ?? 1
  const nh = natural?.h ?? 1
  const scale = Math.min((cw - L - R) / nw, MAX_H / nh)
  const dw = Math.max(40, nw * scale)
  const dh = Math.max(40, nh * scale)
  const height = dh + T + B
  const x0 = L
  const y0 = T + dh // Ursprung unten links

  // Bei wenig Platz nur jede zweite (dritte …) Zahl beschriften
  const everyX = widthCm ? Math.max(1, Math.ceil(26 / (dw / (widthCm / niceStep(widthCm))))) : 1
  const everyY = heightCm ? Math.max(1, Math.ceil(18 / (dh / (heightCm / niceStep(heightCm))))) : 1

  const dz = 34 // Länge der Tiefen-Achse, schräg nach hinten
  const zx = x0 + dw + dz * 0.8
  const zy = T - dz * 0.6

  return (
    <div className="axes" ref={box} style={{ height }}>
      <img
        src={imageUrl}
        alt=""
        className="axes-img checker-bg"
        style={{ left: x0, top: T, width: dw, height: dh }}
        onLoad={(e) => {
          const img = e.currentTarget
          setNatural({ w: img.naturalWidth, h: img.naturalHeight })
          onRatio?.(img.naturalWidth / img.naturalHeight)
        }}
      />
      <svg width={cw} height={height} aria-hidden="true">
        <defs>
          {(['width', 'height', 'depth'] as const).map((a) => (
            <marker key={a} id={`ax-${a}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0 0L10 5L0 10z" className={`ax-fill-${a}`} />
            </marker>
          ))}
        </defs>

        {/* Raster und Skalenstriche für die Breite */}
        {ticks(widthCm).map((t, i) => {
          const x = x0 + (t / widthCm) * dw
          return (
            <g key={`x${t}`}>
              <line x1={x} x2={x} y1={T} y2={y0} className="ax-grid" />
              <line x1={x} x2={x} y1={y0} y2={y0 + 6} className={`ax-${h.dim}`} />
              {(i + 1) % everyX === 0 && (
                <text x={x} y={y0 + 18} textAnchor="middle" className="ax-num">
                  {t}
                </text>
              )}
            </g>
          )
        })}

        {/* Raster und Skalenstriche für die Höhe */}
        {ticks(heightCm).map((t, i) => {
          const y = y0 - (t / heightCm) * dh
          return (
            <g key={`y${t}`}>
              <line x1={x0} x2={x0 + dw} y1={y} y2={y} className="ax-grid" />
              <line x1={x0 - 6} x2={x0} y1={y} y2={y} className={`ax-${v.dim}`} />
              {(i + 1) % everyY === 0 && (
                <text x={x0 - 9} y={y + 4} textAnchor="end" className="ax-num">
                  {t}
                </text>
              )}
            </g>
          )
        })}

        {/* Rahmen um den Gegenstand */}
        <rect x={x0} y={T} width={dw} height={dh} className="ax-frame" />

        {/* Achsen */}
        <line x1={x0} y1={y0} x2={x0 + dw + 16} y2={y0} className={`ax-${h.dim} ax-main`} markerEnd={`url(#ax-${h.dim})`} />
        <line x1={x0} y1={y0} x2={x0} y2={T - 16} className={`ax-${v.dim} ax-main`} markerEnd={`url(#ax-${v.dim})`} />
        {z && (
          <>
            <line x1={x0 + dw} y1={T} x2={zx} y2={zy} className={`ax-${z.dim} ax-main`} markerEnd={`url(#ax-${z.dim})`} />
            <line x1={x0} y1={T} x2={x0 + dz * 0.8} y2={zy} className={`ax-${z.dim} ax-faint`} />
            <line x1={x0 + dz * 0.8} y1={zy} x2={zx} y2={zy} className={`ax-${z.dim} ax-faint`} />
          </>
        )}

        {/* Beschriftungen */}
        <text x={x0 + dw / 2} y={y0 + 38} textAnchor="middle" className={`ax-label ax-fill-${h.dim}`}>
          {DIM_LABELS[h.dim]} {widthCm ? `${cm(widthCm)} cm` : '?'}
        </text>
        <text
          x={16}
          y={T + dh / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${T + dh / 2})`}
          className={`ax-label ax-fill-${v.dim}`}
        >
          {DIM_LABELS[v.dim]} {heightCm ? `${cm(heightCm)} cm` : '?'}
        </text>
        {z && (
          <text x={Math.min(zx, cw - 4)} y={zy - 10} textAnchor="end" className={`ax-label ax-fill-${z.dim}`}>
            {DIM_LABELS[z.dim]} {depthCm ? `${cm(depthCm)} cm` : '?'}
          </text>
        )}
      </svg>
    </div>
  )
}
