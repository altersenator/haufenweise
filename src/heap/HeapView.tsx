// Etappe 2: den eigenen Sperrmüllhaufen in 3D bauen.
// Gegenstände und Deko-Bausteine auf die Fläche legen, verschieben, drehen, kippen, stapeln,
// in Regalfächer stellen oder aufhängen. Dazu verschiedene Hintergründe, teils in Bewegung.
// Die Physik sorgt dafür, dass alles realistisch aufeinander liegt.
import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Physics, useRapier, type RapierRigidBody } from '@react-three/rapier'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Quaternion, Vector3, type Camera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { dims } from '../lib/format'
import { loadHeap, newId, saveHeap } from '../lib/storage'
import { useObjectUrl } from '../lib/useObjectUrl'
import type { DecoKind, DecoPlacement, Hang, Heap, Item, Placement, SceneKind, SceneOptions } from '../types'
import { DecoBody } from './DecoBody'
import { DECO_KINDS, DECOS, decoMeters } from './decos'
import { halfExtents, rotate90, snapQuaternion, worldHalf, type BodyBox, type Vec3 } from './geometry'
import { HeapBody, type BodyEntry } from './HeapBody'
import { Rope } from './Rope'
import { CAMERA_PRESETS, CAMERA_TARGET_BOUNDS, MugshotScene, SCENES, Stage, STAGE, STAGE_CENTER_Z, TurntableScene } from './scenes'

const HEAP_ID = 'private'
// Bereich, in dem Körper liegen dürfen (etwas Abstand zu Wand und Rändern)
const BOUNDS = { x: STAGE.halfW, zMin: STAGE.back + 0.02, zMax: STAGE.front }
const DEFAULT_OPTIONS: SceneOptions = { speed: 0.4, running: true }
const DECO_PREFIX = 'deco:'
const isDeco = (id: string) => id.startsWith(DECO_PREFIX)

type PhysicsApi = ReturnType<typeof useRapier>

interface DragState {
  id: string
  sx: number
  sy: number
  started: boolean
}

/** Sucht in Ringen um die Mitte der Bühne einen Platz, an dem der neue Körper niemanden berührt. */
function freeSpot(half: Vec3, others: BodyBox[]): [number, number] {
  for (let r = 0; r <= 3; r += 0.25) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round(r * 12))
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + 0.4
      const x = Math.cos(a) * r
      const z = STAGE_CENTER_Z + Math.sin(a) * r
      if (Math.abs(x) + half[0] > BOUNDS.x || z - half[2] < BOUNDS.zMin || z + half[2] > BOUNDS.zMax) continue
      const clear = others.every(
        (o) => Math.abs(x - o.center[0]) >= half[0] + o.half[0] + 0.05 || Math.abs(z - o.center[2]) >= half[2] + o.half[2] + 0.05,
      )
      if (clear) return [x, z]
    }
  }
  return [0, STAGE_CENTER_Z] // alles voll: dann oben drauf
}

/** Bringt Körper aus älteren, größeren Haufen auf die Bühne */
function onStage<T extends { pos: Vec3 }>(p: T): T {
  const [x, y, z] = p.pos
  const nx = Math.max(-BOUNDS.x + 0.3, Math.min(BOUNDS.x - 0.3, x))
  const nz = Math.max(BOUNDS.zMin + 0.3, Math.min(BOUNDS.zMax - 0.3, z))
  return nx === x && nz === z ? p : { ...p, pos: [nx, y + 0.3, nz] }
}

/** Alle Collider eines Körpers durchlässig machen (beim Ziehen) oder wieder fest */
function setSensor(body: RapierRigidBody, sensor: boolean) {
  for (let i = 0; i < body.numColliders(); i++) body.collider(i).setSensor(sensor)
}

/** Gehört ein Collider zu den unsichtbaren Rändern? Dann ignorieren ihn die Zielstrahlen. */
function isBoundary(c: { parent(): { userData?: unknown } | null }) {
  return !!(c.parent()?.userData as { boundary?: boolean } | undefined)?.boundary
}

function CameraGrab({ target }: { target: React.RefObject<Camera | null> }) {
  const { camera } = useThree()
  useEffect(() => {
    target.current = camera
  }, [camera, target])
  return null
}

/** Gibt der Ansicht Zugriff auf die Physik-Welt (für Zielstrahlen). */
function PhysicsGrab({ target }: { target: React.RefObject<PhysicsApi | null> }) {
  const api = useRapier()
  useEffect(() => {
    target.current = api
  }, [api, target])
  return null
}

/** Setzt beim Wechsel des Hintergrunds eine passende Kameraposition. */
function CameraRig({ scene, controls }: { scene: SceneKind; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()
  useEffect(() => {
    const p = CAMERA_PRESETS[scene]
    camera.position.set(...p.position)
    const c = controls.current
    if (c) {
      c.target.set(...p.target)
      c.update()
      c.saveState()
    }
  }, [scene, camera, controls])
  return null
}

/**
 * Sicherheitsnetz: Rutscht doch einmal etwas unter den Boden, wird es sofort wieder daraufgestellt.
 */
function Rescue({ bodies }: { bodies: React.RefObject<Map<string, BodyEntry>> }) {
  const acc = useRef(0)
  useFrame((_, delta) => {
    acc.current += delta
    if (acc.current < 0.25) return
    acc.current = 0
    for (const e of bodies.current.values()) {
      try {
        const t = e.body.translation()
        if (t.y > -0.3 && Number.isFinite(t.y)) continue
        const x = Number.isFinite(t.x) ? Math.max(-BOUNDS.x, Math.min(BOUNDS.x, t.x)) : 0
        const z = Number.isFinite(t.z) ? Math.max(BOUNDS.zMin + 0.5, Math.min(BOUNDS.zMax, t.z)) : 0.5
        e.body.setTranslation({ x, y: Math.max(...e.half) + 0.1, z }, true)
        e.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        e.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      } catch {
        /* Körper wird gerade entfernt */
      }
    }
  })
  return null
}

const targetMin = new Vector3(...CAMERA_TARGET_BOUNDS.min)
const targetMax = new Vector3(...CAMERA_TARGET_BOUNDS.max)

function TrayItem({ item, onAdd }: { item: Item; onAdd: () => void }) {
  const url = useObjectUrl(item.image)
  return (
    <button className="tray-item" onClick={onAdd} aria-label={`${item.title} in den Haufen legen`}>
      <span className="checker tray-thumb">{url && <img src={url} alt="" />}</span>
      <span className="tray-title">{item.title}</span>
      <span className="tray-plus" aria-hidden="true">
        +
      </span>
    </button>
  )
}

/** Kleine Piktogramme für die Deko-Ablage */
function DecoIcon({ kind }: { kind: DecoKind }) {
  const stroke = { stroke: 'currentColor', strokeWidth: 3, fill: 'none', strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true">
      {kind === 'shelf' && (
        <g {...stroke}>
          <rect x="10" y="8" width="44" height="48" />
          <path d="M21 8v48M32 8v48M43 8v48M10 20h44M10 32h44M10 44h44" strokeWidth="2" />
        </g>
      )}
      {kind === 'podium' && (
        <g {...stroke}>
          <path d="M6 56V36h17V20h18v26h17v10z" />
          <text x="32" y="36" textAnchor="middle" fontSize="12" fill="currentColor" stroke="none" fontWeight="700">
            1
          </text>
        </g>
      )}
      {kind === 'swing' && (
        <g {...stroke}>
          <path d="M8 10h48M14 10 6 56M14 10l8 46M50 10l-8 46M50 10l8 46M27 10v30M37 10v30" strokeWidth="2.5" />
          <rect x="24" y="40" width="16" height="4" />
        </g>
      )}
      {kind === 'etagere' && (
        <g {...stroke}>
          <path d="M32 6v48M18 54h28" />
          <ellipse cx="32" cy="46" rx="24" ry="4" />
          <ellipse cx="32" cy="30" rx="17" ry="3" />
          <ellipse cx="32" cy="16" rx="11" ry="2.5" />
          <circle cx="32" cy="6" r="3" />
        </g>
      )}
    </svg>
  )
}

interface Props {
  items: Item[]
  onBack: () => void
  onOpen: (id: string) => void
}

export default function HeapView({ items, onBack, onOpen }: Props) {
  const [heap, setHeap] = useState<Heap | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [pressing, setPressing] = useState(false)
  const [notice, setNotice] = useState('')
  const [, setRegVersion] = useState(0)
  const [pendingDims, setPendingDims] = useState<[number, number, number] | null>(null)

  const bodies = useRef(new Map<string, BodyEntry>())
  const seats = useRef(new Map<string, RapierRigidBody>())
  const physics = useRef<PhysicsApi | null>(null)
  const camera = useRef<Camera | null>(null)
  const controls = useRef<OrbitControlsImpl>(null)
  const drag = useRef<DragState | null>(null)
  const heapRef = useRef<Heap | null>(null)
  heapRef.current = heap
  const saveTimer = useRef<number | undefined>(undefined)
  const dimsTimer = useRef<number | undefined>(undefined)

  const scene: SceneKind = heap?.scene ?? 'plain'
  const options = heap?.sceneOptions ?? DEFAULT_OPTIONS

  // Gespeicherten Haufen laden. Gelöschte Gegenstände fallen heraus.
  useEffect(() => {
    loadHeap(HEAP_ID).then((h) => {
      const ids = new Set(items.map((i) => i.id))
      setHeap({
        ...h,
        placements: h.placements.filter((p) => ids.has(p.itemId)).map(onStage),
        decos: (h.decos ?? []).map(onStage),
        hangs: (h.hangs ?? []).filter((x) => ids.has(x.itemId)),
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Nur in der Entwicklungsversion: Zugriff für automatische Tests
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__heapDebug = { bodies: bodies.current, camera, seats: seats.current }
  })

  // ---- Speichern -------------------------------------------------------------------

  /** Aktuelle Lage aller Körper aus der Physik in den Haufen übernehmen */
  const snapshot = useCallback((h: Heap): Heap => {
    const read = (id: string) => {
      const e = bodies.current.get(id)
      if (!e) return null
      try {
        const t = e.body.translation()
        const r = e.body.rotation()
        return { pos: [t.x, t.y, t.z] as Vec3, rot: [r.x, r.y, r.z, r.w] as [number, number, number, number] }
      } catch {
        return null
      }
    }
    return {
      ...h,
      placements: h.placements.map((p): Placement => ({ ...p, ...(read(p.itemId) ?? {}) })),
      decos: (h.decos ?? []).map((d): DecoPlacement => ({ ...d, ...(read(d.id) ?? {}) })),
    }
  }, [])

  const persist = useCallback(() => {
    const h = heapRef.current
    if (h) saveHeap({ ...snapshot(h), updatedAt: Date.now() })
  }, [snapshot])

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(persist, 1800) // warten, bis die Physik zur Ruhe kommt
  }, [persist])

  useEffect(() => {
    const onHide = () => persist()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    const autosave = window.setInterval(persist, 8000) // Drehteller und Schaukel bewegen sich laufend
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
      window.clearInterval(autosave)
      window.clearTimeout(saveTimer.current)
      persist()
    }
  }, [persist])

  // ---- Körper-Verzeichnis --------------------------------------------------------

  const register = useCallback((id: string, entry: BodyEntry | null) => {
    if (entry) bodies.current.set(id, entry)
    else bodies.current.delete(id)
    setRegVersion((v) => v + 1) // Seile neu verbinden
  }, [])

  const registerSeat = useCallback((id: string, seat: RapierRigidBody | null) => {
    if (seat) seats.current.set(id, seat)
    else seats.current.delete(id)
  }, [])

  const others = useCallback((exclude?: string): BodyBox[] => {
    const out: BodyBox[] = []
    for (const [id, e] of bodies.current) {
      if (id === exclude) continue
      const t = e.body.translation()
      const r = e.body.rotation()
      out.push({ center: [t.x, t.y, t.z], half: worldHalf(new Quaternion(r.x, r.y, r.z, r.w), e.half) })
    }
    return out
  }, [])

  const quatOf = (id: string) => {
    const r = bodies.current.get(id)!.body.rotation()
    return new Quaternion(r.x, r.y, r.z, r.w)
  }

  /** Körper, die ein Zielstrahl ignorieren soll: der gezogene selbst und Teile davon (Schaukelsitz) */
  const excludedHandles = (id: string) => {
    const set = new Set<number>()
    const e = bodies.current.get(id)
    if (e) set.add(e.body.handle)
    const seat = seats.current.get(id)
    if (seat) set.add(seat.handle)
    return set
  }

  /** Höchste Oberfläche unter einer Grundfläche, per Zielstrahlen von oben nach unten */
  const surfaceBelow = useCallback((x: number, z: number, hx: number, hz: number, fromY: number, skip: Set<number>) => {
    const api = physics.current
    if (!api) return 0
    const { world, rapier } = api
    let top = 0
    for (const [dx, dz] of [
      [0, 0],
      [0.9, 0.9],
      [-0.9, 0.9],
      [0.9, -0.9],
      [-0.9, -0.9],
    ]) {
      const ray = new rapier.Ray({ x: x + dx * hx, y: fromY, z: z + dz * hz }, { x: 0, y: -1, z: 0 })
      const hit = world.castRay(ray, fromY + 1, true, undefined, undefined, undefined, undefined, (c) => !skip.has(c.parent()?.handle ?? -1) && !isBoundary(c))
      if (hit) top = Math.max(top, fromY - hit.timeOfImpact)
    }
    return top
  }, [])

  // ---- Hinzufügen, Entfernen, Festsetzen ------------------------------------------

  function addItem(item: Item) {
    if (!heap) return
    const half = halfExtents(item)
    const [x, z] = freeSpot(half, others())
    const y = surfaceBelow(x, z, half[0], half[2], 6, new Set()) + half[1] + 0.02
    setHeap({ ...snapshot(heap), placements: [...heap.placements, { itemId: item.id, pos: [x, y, z], rot: [0, 0, 0, 1], locked: false }] })
    setSelected(item.id)
    scheduleSave()
  }

  function addDeco(kind: DecoKind) {
    if (!heap) return
    const dimsCm = [...DECOS[kind].defaults] as [number, number, number]
    const m = decoMeters(kind, dimsCm)
    const half: Vec3 = [m[0] / 2, m[1] / 2, m[2] / 2]
    const [x, z] = freeSpot(half, others())
    const y = surfaceBelow(x, z, half[0], half[2], 6, new Set()) + half[1] + 0.02
    const deco: DecoPlacement = { id: DECO_PREFIX + newId(), kind, dims: dimsCm, pos: [x, y, z], rot: [0, 0, 0, 1], locked: false }
    setHeap({ ...snapshot(heap), decos: [...(heap.decos ?? []), deco] })
    setSelected(deco.id)
    scheduleSave()
  }

  function removeSelected() {
    if (!heap || !selected) return
    const h = snapshot(heap)
    setHeap({
      ...h,
      placements: h.placements.filter((p) => p.itemId !== selected),
      decos: (h.decos ?? []).filter((d) => d.id !== selected),
      hangs: (h.hangs ?? []).filter((x) => x.itemId !== selected && x.decoId !== selected),
    })
    setSelected(null)
    scheduleSave()
  }

  function toggleLock() {
    if (!heap || !selected) return
    const h = snapshot(heap)
    setHeap({
      ...h,
      placements: h.placements.map((p) => (p.itemId === selected ? { ...p, locked: !p.locked } : p)),
      decos: (h.decos ?? []).map((d) => (d.id === selected ? { ...d, locked: !d.locked } : d)),
    })
    scheduleSave()
  }

  // ---- Drehen und Kippen ---------------------------------------------------------

  /** Neue Drehung setzen und so anheben, dass die Unterseite auf gleicher Höhe bleibt */
  function placeWith(id: string, q: Quaternion) {
    const e = bodies.current.get(id)
    if (!e) return
    const t = e.body.translation()
    const before = worldHalf(quatOf(id), e.half)
    const after = worldHalf(q, e.half)
    e.body.setRotation(q, true)
    e.body.setTranslation({ x: t.x, y: t.y - before[1] + after[1] + 0.01, z: t.z }, true)
    e.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    e.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    scheduleSave()
  }

  function turn() {
    if (!selected || !bodies.current.has(selected)) return
    placeWith(selected, snapQuaternion(rotate90(quatOf(selected), new Vector3(0, 1, 0))))
  }

  function tip() {
    if (!selected || !bodies.current.has(selected)) return
    // Zur Kamera hin kippen: Achse ist die waagerechte Querachse aus Sicht der Kamera
    const right = new Vector3(1, 0, 0)
    if (camera.current) right.setFromMatrixColumn(camera.current.matrixWorld, 0)
    const axis = Math.abs(right.x) > Math.abs(right.z) ? new Vector3(Math.sign(right.x), 0, 0) : new Vector3(0, 0, Math.sign(right.z))
    placeWith(selected, snapQuaternion(rotate90(quatOf(selected), axis)))
  }

  // ---- Aufhängen --------------------------------------------------------------------

  function hookWorld(deco: DecoPlacement, index: number): Vector3 | null {
    const e = bodies.current.get(deco.id)
    if (!e) return null
    const [w, h, d] = decoMeters(deco.kind, deco.dims)
    const local = DECOS[deco.kind].hooks(w, h, d)[index]
    if (!local) return null
    const t = e.body.translation()
    return new Vector3(...local).applyQuaternion(quatOf(deco.id)).add(new Vector3(t.x, t.y, t.z))
  }

  function hangSelected() {
    if (!heap || !selected || isDeco(selected)) return
    const item = bodies.current.get(selected)
    if (!item) return
    const used = new Set((heap.hangs ?? []).map((x) => `${x.decoId}#${x.hook}`))
    const t = item.body.translation()
    let best: { deco: DecoPlacement; hook: number; pos: Vector3; dist: number } | null = null
    for (const deco of heap.decos ?? []) {
      const [w, h, d] = decoMeters(deco.kind, deco.dims)
      DECOS[deco.kind].hooks(w, h, d).forEach((_, i) => {
        if (used.has(`${deco.id}#${i}`)) return
        const pos = hookWorld(deco, i)
        if (!pos) return
        const dist = Math.hypot(pos.x - t.x, pos.z - t.z)
        if (!best || dist < best.dist) best = { deco, hook: i, pos, dist }
      })
    }
    if (!best) {
      setNotice('Kein freier Haken gefunden. Haken haben die Schaukel, die Etagere und das Regal an den Seiten.')
      return
    }
    const b = best as { deco: DecoPlacement; hook: number; pos: Vector3 }
    const length = 0.25
    // Gegenstand aufrecht unter den Haken hängen
    item.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
    item.body.setTranslation({ x: b.pos.x, y: b.pos.y - length - item.half[1], z: b.pos.z }, true)
    item.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    item.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    setNotice('')
    setHeap({ ...snapshot(heap), hangs: [...(heap.hangs ?? []), { itemId: selected, decoId: b.deco.id, hook: b.hook, length }] })
    scheduleSave()
  }

  function unhangSelected() {
    if (!heap || !selected) return
    setHeap({ ...snapshot(heap), hangs: (heap.hangs ?? []).filter((x) => x.itemId !== selected) })
    scheduleSave()
  }

  function pushSwing() {
    if (!selected) return
    const seat = seats.current.get(selected)
    if (!seat) return
    const dir = new Vector3(0, 0, 1).applyQuaternion(quatOf(selected))
    const m = seat.mass() * 1.4
    seat.applyImpulse({ x: dir.x * m, y: 0, z: dir.z * m }, true)
  }

  // ---- Größe von Deko-Bausteinen --------------------------------------------------

  function changeDims(next: [number, number, number]) {
    setPendingDims(next)
    window.clearTimeout(dimsTimer.current)
    dimsTimer.current = window.setTimeout(() => commitDims(next), 350)
  }

  function commitDims(next: [number, number, number]) {
    const h0 = heapRef.current
    const id = selected
    if (!h0 || !id) return
    const h = snapshot(h0)
    setHeap({
      ...h,
      decos: (h.decos ?? []).map((d) => {
        if (d.id !== id) return d
        const oldH = decoMeters(d.kind, d.dims)[1]
        const newH = decoMeters(d.kind, next)[1]
        // Unterseite bleibt, wo sie war
        return { ...d, dims: next, pos: [d.pos[0], d.pos[1] + (newH - oldH) / 2 + 0.005, d.pos[2]] }
      }),
    })
    setPendingDims(null)
    scheduleSave()
  }

  // ---- Hintergrund -------------------------------------------------------------------

  function setScene(kind: SceneKind) {
    if (!heap || kind === scene) return
    setHeap({ ...snapshot(heap), scene: kind })
    setSelected(null)
    scheduleSave()
  }

  function setOptions(next: Partial<SceneOptions>) {
    if (!heap) return
    setHeap({ ...heap, sceneOptions: { ...options, ...next } })
    scheduleSave()
  }

  // ---- Ziehen mit dem Finger -------------------------------------------------------

  const isLocked = (id: string) => {
    const h = heapRef.current
    if (!h) return false
    return isDeco(id) ? !!h.decos?.find((d) => d.id === id)?.locked : !!h.placements.find((p) => p.itemId === id)?.locked
  }

  const onDown = useCallback((id: string, e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setSelected(id)
    setNotice('')
    if (!bodies.current.get(id) || isLocked(id)) return
    setPressing(true) // Kamera nicht drehen, solange man einen Körper festhält
    ;(e.target as unknown as Element).setPointerCapture?.(e.pointerId)
    drag.current = { id, sx: e.nativeEvent.clientX, sy: e.nativeEvent.clientY, started: false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onMove = useCallback((id: string, e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d || d.id !== id) return
    e.stopPropagation()
    const entry = bodies.current.get(id)
    const api = physics.current
    if (!entry || !api) return
    const { world, rapier } = api
    if (!d.started) {
      if (Math.hypot(e.nativeEvent.clientX - d.sx, e.nativeEvent.clientY - d.sy) < 6) return
      d.started = true
      // Sofort umschalten (nicht erst beim nächsten Neuzeichnen): sonst fällt der durchlässige
      // Körper für einen Moment der Schwerkraft zum Opfer und rutscht durch den Boden.
      entry.body.setBodyType(rapier.RigidBodyType.KinematicPositionBased, true)
      setSensor(entry.body, true)
      setDragging(id)
    }
    // Dorthin, wo der Finger zeigt: Zielstrahl von der Kamera durch den Finger
    const o = e.ray.origin
    const dir = e.ray.direction
    const ray = new rapier.Ray({ x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z })
    const skip = excludedHandles(id)
    const hit = world.castRayAndGetNormal(ray, 60, true, undefined, undefined, undefined, undefined, (c) => !skip.has(c.parent()?.handle ?? -1) && !isBoundary(c))
    if (!hit) return
    const p = ray.pointAt(hit.timeOfImpact)
    const n = hit.normal
    const wh = worldHalf(quatOf(id), entry.half)
    let x: number
    let y: number
    let z: number
    if (n.y > 0.5) {
      // Auf eine Oberfläche stellen (Boden, Regalbrett, Etagere, anderer Gegenstand …)
      x = p.x
      z = p.z
      y = Math.max(p.y, 0) + wh[1] + 0.01
    } else {
      // An eine Wand oder Seite heranschieben; beim Loslassen fällt er herunter
      const push = Math.abs(n.x) * wh[0] + Math.abs(n.z) * wh[2] + 0.01
      x = p.x + n.x * push
      z = p.z + n.z * push
      y = Math.max(p.y, wh[1] + 0.01)
    }
    x = Math.max(-BOUNDS.x + wh[0], Math.min(BOUNDS.x - wh[0], x))
    z = Math.max(BOUNDS.zMin + wh[2], Math.min(BOUNDS.zMax - wh[2], z))
    entry.body.setNextKinematicTranslation({ x, y, z })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const endDrag = useCallback(() => {
    const d = drag.current
    drag.current = null
    setPressing(false)
    if (d?.started) {
      const entry = bodies.current.get(d.id)
      const api = physics.current
      if (entry && api) {
        // Wieder fest und ohne Schwung loslassen, damit nichts weggeschleudert wird oder durchrutscht
        const locked = isLocked(d.id)
        entry.body.setBodyType(locked ? api.rapier.RigidBodyType.Fixed : api.rapier.RigidBodyType.Dynamic, true)
        setSensor(entry.body, false)
        entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
        entry.body.wakeUp()
      }
      setDragging(null)
      scheduleSave()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSave])

  const onUp = useCallback(
    (id: string, e: ThreeEvent<PointerEvent>) => {
      if (drag.current?.id !== id) return
      e.stopPropagation()
      ;(e.target as unknown as Element).releasePointerCapture?.(e.pointerId)
      endDrag()
    },
    [endDrag],
  )

  useEffect(() => {
    const up = () => drag.current && endDrag()
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [endDrag])

  // ---- Anzeige -------------------------------------------------------------------------

  const placedIds = new Set(heap?.placements.map((p) => p.itemId))
  const tray = items.filter((i) => !placedIds.has(i.id))
  const selItem = selected && !isDeco(selected) ? items.find((i) => i.id === selected) : undefined
  const selDeco = selected && isDeco(selected) ? heap?.decos?.find((d) => d.id === selected) : undefined
  const selLocked = selItem ? !!heap?.placements.find((p) => p.itemId === selected)?.locked : !!selDeco?.locked
  const selHang = selItem ? heap?.hangs?.find((x) => x.itemId === selected) : undefined
  const hasHooks = (heap?.decos ?? []).some((d) => DECOS[d.kind].hooks(1, 1, 1).length > 0)
  const shownDims = selDeco ? (pendingDims ?? selDeco.dims) : null

  return (
    <section className="heap">
      <div className="heap-head">
        <button className="btn ghost back" onClick={onBack}>
          ← Zurück
        </button>
        <h2>Mein Haufen</h2>
      </div>

      <div className="segmented heap-scenes" role="radiogroup" aria-label="Hintergrund">
        {SCENES.map((s) => (
          <button key={s.kind} type="button" role="radio" aria-checked={scene === s.kind} className={scene === s.kind ? 'on' : ''} onClick={() => setScene(s.kind)}>
            {s.label}
          </button>
        ))}
      </div>
      {scene === 'turntable' && (
        <div className="turntable-controls">
          <button className="btn small" onClick={() => setOptions({ running: !options.running })}>
            {options.running ? 'Anhalten' : 'Drehen lassen'}
          </button>
          <label className="slider">
            <span>Tempo</span>
            <input
              type="range"
              min={0.1}
              max={1.5}
              step={0.05}
              value={options.speed}
              onChange={(e) => setOptions({ speed: Number(e.target.value) })}
              aria-label="Tempo des Drehtellers"
            />
          </label>
        </div>
      )}

      <div className="heap-stage">
        {heap && (
          <Canvas
            shadows
            dpr={[1, 2]}
            resize={{ scroll: false, debounce: { scroll: 0, resize: 50 } }}
            camera={{ position: CAMERA_PRESETS.plain.position, fov: 40, near: 0.05, far: 300 }}
            onPointerMissed={() => setSelected(null)}
          >
            <color attach="background" args={[scene === 'mugshot' ? '#d7dcdc' : '#e9eeed']} />
            <fog attach="fog" args={[scene === 'mugshot' ? '#d7dcdc' : '#e9eeed', 16, 60]} />
            <hemisphereLight intensity={0.9} groundColor="#b8b0a2" />
            <directionalLight
              castShadow
              position={[4, 7, 3]}
              intensity={1.7}
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
              shadow-camera-left={-9}
              shadow-camera-right={9}
              shadow-camera-top={9}
              shadow-camera-bottom={-9}
            />
            <CameraGrab target={camera} />
            <CameraRig scene={scene} controls={controls} />
            <Suspense fallback={null}>
              <Physics gravity={[0, -9.81, 0]}>
                <PhysicsGrab target={physics} />
                <Rescue bodies={bodies} />
                {scene === 'plain' && <Stage />}
                {scene === 'mugshot' && <MugshotScene />}
                {scene === 'turntable' && <TurntableScene options={options} />}

                {(heap.decos ?? []).map((d) => (
                  <DecoBody
                    key={`${d.id}|${d.dims.join('x')}`}
                    deco={d}
                    selected={selected === d.id}
                    dragging={dragging === d.id}
                    onRegister={register}
                    onSeat={registerSeat}
                    onDown={onDown}
                    onMove={onMove}
                    onUp={onUp}
                  />
                ))}

                {heap.placements.map((p) => {
                  const item = items.find((i) => i.id === p.itemId)
                  if (!item) return null
                  return (
                    <HeapBody
                      key={p.itemId}
                      item={item}
                      initial={p}
                      locked={p.locked}
                      selected={selected === p.itemId}
                      dragging={dragging === p.itemId}
                      onRegister={register}
                      onDown={onDown}
                      onMove={onMove}
                      onUp={onUp}
                    />
                  )
                })}

                {(heap.hangs ?? []).map((hang: Hang) => {
                  const a = bodies.current.get(hang.decoId)
                  const b = bodies.current.get(hang.itemId)
                  const deco = heap.decos?.find((d) => d.id === hang.decoId)
                  if (!a || !b || !deco) return null
                  const [w, h, d] = decoMeters(deco.kind, deco.dims)
                  const hook = DECOS[deco.kind].hooks(w, h, d)[hang.hook]
                  if (!hook) return null
                  return (
                    <Rope
                      key={`${hang.itemId}|${a.body.handle}|${b.body.handle}`}
                      a={a.body}
                      b={b.body}
                      anchorA={hook}
                      anchorB={[0, b.half[1], 0]}
                      length={hang.length}
                    />
                  )
                })}
              </Physics>
            </Suspense>
            {/* Die Kamera bleibt vor der Wand: seitlich nur begrenzt drehbar, nicht unter den Boden */}
            <OrbitControls
              ref={controls}
              makeDefault
              enabled={!pressing}
              target={CAMERA_PRESETS.plain.target}
              minDistance={1.2}
              maxDistance={14}
              minAzimuthAngle={-0.65}
              maxAzimuthAngle={0.65}
              minPolarAngle={0.95}
              maxPolarAngle={1.52}
              onChange={() => controls.current?.target.clamp(targetMin, targetMax)}
            />
          </Canvas>
        )}
        <button className="heap-reset" onClick={() => controls.current?.reset()}>
          Ansicht zurücksetzen
        </button>
        {heap && heap.placements.length === 0 && !(heap.decos ?? []).length && (
          <p className="heap-empty">Tippe unten auf einen Gegenstand oder einen Deko-Baustein, um ihn auf deinen Haufen zu legen.</p>
        )}
      </div>

      <div className="heap-tools" aria-live="polite">
        {notice && <p className="notice">{notice}</p>}
        {selItem && (
          <>
            <div className="heap-sel">
              <strong>{selItem.title}</strong>
              <span className="quiet small">
                {dims(selItem.widthCm, selItem.heightCm, selItem.depthCm)}
                {selLocked ? ' · festgesetzt' : ''}
                {selHang ? ' · hängt' : ''}
              </span>
            </div>
            <div className="row">
              <button className="btn small" onClick={turn} disabled={selLocked}>
                ↻ Drehen
              </button>
              <button className="btn small" onClick={tip} disabled={selLocked}>
                Kippen
              </button>
              {selHang ? (
                <button className="btn small" onClick={unhangSelected}>
                  Abhängen
                </button>
              ) : (
                hasHooks && (
                  <button className="btn small" onClick={hangSelected} disabled={selLocked}>
                    Aufhängen
                  </button>
                )
              )}
              <button className="btn small" onClick={toggleLock}>
                {selLocked ? 'Lösen' : 'Festsetzen'}
              </button>
              <button className="btn small" onClick={() => onOpen(selItem.id)}>
                Details
              </button>
              <button className="btn small danger-ghost" onClick={removeSelected} disabled={selLocked}>
                Herausnehmen
              </button>
            </div>
          </>
        )}
        {selDeco && shownDims && (
          <>
            <div className="heap-sel">
              <strong>
                {DECOS[selDeco.kind].label} <span className="tag">Deko</span>
              </strong>
              <span className="quiet small">Nicht zum Verschenken{selDeco.locked ? ' · festgesetzt' : ''}</span>
            </div>
            <div className="dims-sliders">
              {[0, 1, 2].map((i) => {
                const range = DECOS[selDeco.kind].ranges[i]
                if (!range) return null
                return (
                  <label key={i} className="slider">
                    <span>
                      {DECOS[selDeco.kind].dimLabels[i]} <strong>{shownDims[i]} cm</strong>
                    </span>
                    <input
                      type="range"
                      min={range[0]}
                      max={range[1]}
                      step={5}
                      value={shownDims[i]}
                      disabled={selDeco.locked}
                      onChange={(e) => {
                        const next = [...shownDims] as [number, number, number]
                        next[i] = Number(e.target.value)
                        changeDims(next)
                      }}
                    />
                  </label>
                )
              })}
            </div>
            <div className="row">
              {selDeco.kind === 'swing' && (
                <button className="btn small" onClick={pushSwing}>
                  Anschubsen
                </button>
              )}
              <button className="btn small" onClick={turn} disabled={selDeco.locked}>
                ↻ Drehen
              </button>
              <button className="btn small" onClick={toggleLock}>
                {selDeco.locked ? 'Lösen' : 'Festsetzen'}
              </button>
              <button className="btn small danger-ghost" onClick={removeSelected} disabled={selDeco.locked}>
                Entfernen
              </button>
            </div>
          </>
        )}
        {!selItem && !selDeco && !notice && (
          <p className="quiet small">
            Tippe etwas an, um es zu bearbeiten. Halt es mit dem Finger fest und zeig dorthin, wo es hin soll, zum Beispiel in
            ein Regalfach oder auf eine Etage. Wischen auf einer freien Stelle schwenkt die Ansicht nach links und rechts, zwei
            Finger zoomen und verschieben.
          </p>
        )}
      </div>

      <h3 className="section-title">Ablage</h3>
      {tray.length ? (
        <div className="tray scroll">
          {tray.map((item) => (
            <TrayItem key={item.id} item={item} onAdd={() => addItem(item)} />
          ))}
        </div>
      ) : (
        <p className="quiet small">
          {items.length ? 'Alle Gegenstände liegen auf dem Haufen.' : 'Du hast noch keine Gegenstände erfasst.'}
        </p>
      )}

      <h3 className="section-title">Deko hinzufügen</h3>
      <p className="quiet small">Deko-Bausteine sind nicht zum Verschenken da. Sie helfen dir, deinen Haufen schön zu arrangieren.</p>
      <div className="tray scroll">
        {DECO_KINDS.map((kind) => (
          <button key={kind} className="tray-item deco-item" onClick={() => addDeco(kind)} aria-label={`${DECOS[kind].label} hinzufügen`}>
            <span className="deco-icon">
              <DecoIcon kind={kind} />
            </span>
            <span className="tray-title">{DECOS[kind].label}</span>
            <span className="tray-plus" aria-hidden="true">
              +
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
