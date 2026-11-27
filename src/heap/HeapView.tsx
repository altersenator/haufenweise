// Etappe 2: den eigenen Sperrmüllhaufen in 3D bauen.
// Gegenstände aus der Ablage auf die Fläche legen, verschieben, drehen, kippen, stapeln.
// Die Physik sorgt dafür, dass alles realistisch aufeinander liegt.
import { Grid, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { CuboidCollider, Physics, RigidBody } from '@react-three/rapier'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Plane, Quaternion, Vector3, type Camera } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { dims } from '../lib/format'
import { loadHeap, saveHeap } from '../lib/storage'
import { useObjectUrl } from '../lib/useObjectUrl'
import type { Heap, Item, Placement } from '../types'
import { GROUND_HALF, halfExtents, rotate90, snapQuaternion, supportHeight, worldHalf, type BodyBox } from './geometry'
import { HeapBody, type BodyEntry } from './HeapBody'

const HEAP_ID = 'private'

/** Sucht in Ringen um die Mitte einen Platz, an dem der neue Körper niemanden berührt. */
function freeSpot(half: [number, number, number], others: BodyBox[]): [number, number] {
  for (let r = 0; r <= 3.6; r += 0.3) {
    const steps = r === 0 ? 1 : Math.max(8, Math.round(r * 12))
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2 + 0.4
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (Math.abs(x) + half[0] > LIMIT || Math.abs(z) + half[2] > LIMIT) continue
      const clear = others.every(
        (o) => Math.abs(x - o.center[0]) >= half[0] + o.half[0] + 0.05 || Math.abs(z - o.center[2]) >= half[2] + o.half[2] + 0.05,
      )
      if (clear) return [x, z]
    }
  }
  return [0, 0] // alles voll: dann oben drauf
}
const LIMIT = GROUND_HALF - 0.2

interface DragState {
  id: string
  sx: number
  sy: number
  started: boolean
  planeY: number
  offX: number
  offZ: number
  y: number
}

function CameraGrab({ target }: { target: React.RefObject<Camera | null> }) {
  const { camera } = useThree()
  useEffect(() => {
    target.current = camera
  }, [camera, target])
  return null
}

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

  const bodies = useRef(new Map<string, BodyEntry>())
  const camera = useRef<Camera | null>(null)
  const controls = useRef<OrbitControlsImpl>(null)
  const drag = useRef<DragState | null>(null)
  const heapRef = useRef<Heap | null>(null)
  heapRef.current = heap
  const saveTimer = useRef<number | undefined>(undefined)

  // Gespeicherten Haufen laden. Gelöschte Gegenstände fallen heraus.
  useEffect(() => {
    loadHeap(HEAP_ID).then((h) => {
      const ids = new Set(items.map((i) => i.id))
      setHeap({ ...h, placements: h.placements.filter((p) => ids.has(p.itemId)) })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Aktuelle Lage aller Körper aus der Physik auslesen und speichern
  const persist = useCallback(() => {
    const h = heapRef.current
    if (!h) return
    const placements = h.placements.map((p): Placement => {
      const e = bodies.current.get(p.itemId)
      if (!e) return p
      try {
        const t = e.body.translation()
        const r = e.body.rotation()
        return { ...p, pos: [t.x, t.y, t.z], rot: [r.x, r.y, r.z, r.w] }
      } catch {
        return p
      }
    })
    saveHeap({ id: HEAP_ID, placements, updatedAt: Date.now() })
  }, [])

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    // Kurz warten, bis die Physik zur Ruhe gekommen ist
    saveTimer.current = window.setTimeout(persist, 1800)
  }, [persist])

  useEffect(() => {
    const onHide = () => persist()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onHide)
      window.clearTimeout(saveTimer.current)
      persist()
    }
  }, [persist])

  const register = useCallback((id: string, entry: BodyEntry | null) => {
    if (entry) bodies.current.set(id, entry)
    else bodies.current.delete(id)
  }, [])

  /** Alle anderen Körper als Kisten in Weltkoordinaten */
  const others = useCallback((exclude: string): BodyBox[] => {
    const out: BodyBox[] = []
    for (const [id, e] of bodies.current) {
      if (id === exclude) continue
      const t = e.body.translation()
      const r = e.body.rotation()
      out.push({ center: [t.x, t.y, t.z], half: worldHalf(new Quaternion(r.x, r.y, r.z, r.w), e.half) })
    }
    return out
  }, [])

  const placementOf = (id: string | null) => heap?.placements.find((p) => p.itemId === id)

  // ---- Ablage → Haufen -------------------------------------------------------

  function addItem(item: Item) {
    if (!heap) return
    const half = halfExtents(item)
    const [x, z] = freeSpot(half, others(item.id))
    // Sanft absetzen: knapp über dem, worauf er steht, damit hohe Dinge nicht umkippen
    const y = supportHeight(x, z, half[0], half[2], others(item.id)) + half[1] + 0.02
    setHeap({ ...heap, placements: [...heap.placements, { itemId: item.id, pos: [x, y, z], rot: [0, 0, 0, 1], locked: false }] })
    setSelected(item.id)
    scheduleSave()
  }

  function removeSelected() {
    if (!heap || !selected) return
    setHeap({ ...heap, placements: heap.placements.filter((p) => p.itemId !== selected) })
    setSelected(null)
    scheduleSave()
  }

  function toggleLock() {
    if (!heap || !selected) return
    persist() // aktuelle Lage sichern, bevor sich der Körpertyp ändert
    setHeap({
      ...heap,
      placements: heap.placements.map((p) => (p.itemId === selected ? { ...p, locked: !p.locked } : p)),
    })
    scheduleSave()
  }

  // ---- Drehen und Kippen -----------------------------------------------------

  /** Körper mit neuer Drehung so ablegen, dass er auf dem steht, was unter ihm ist. */
  function placeWith(id: string, q: Quaternion) {
    const e = bodies.current.get(id)
    if (!e) return
    const t = e.body.translation()
    const wh = worldHalf(q, e.half)
    const y = supportHeight(t.x, t.z, wh[0], wh[2], others(id)) + wh[1] + 0.02
    e.body.setRotation(q, true)
    e.body.setTranslation({ x: t.x, y, z: t.z }, true)
    e.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    e.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    scheduleSave()
  }

  function currentQuat(id: string) {
    const r = bodies.current.get(id)!.body.rotation()
    return new Quaternion(r.x, r.y, r.z, r.w)
  }

  function turn() {
    if (!selected || !bodies.current.has(selected)) return
    placeWith(selected, snapQuaternion(rotate90(currentQuat(selected), new Vector3(0, 1, 0))))
  }

  function tip() {
    if (!selected || !bodies.current.has(selected)) return
    // Zur Kamera hin kippen: Achse ist die waagerechte Querachse aus Sicht der Kamera
    const right = new Vector3(1, 0, 0)
    if (camera.current) right.setFromMatrixColumn(camera.current.matrixWorld, 0)
    const axis = Math.abs(right.x) > Math.abs(right.z) ? new Vector3(Math.sign(right.x), 0, 0) : new Vector3(0, 0, Math.sign(right.z))
    placeWith(selected, snapQuaternion(rotate90(currentQuat(selected), axis)))
  }

  // ---- Ziehen mit dem Finger ---------------------------------------------------

  const plane = useRef(new Plane(new Vector3(0, 1, 0), 0))
  const hitPoint = useRef(new Vector3())

  function intersect(e: ThreeEvent<PointerEvent>, y: number): Vector3 | null {
    plane.current.constant = -y
    return e.ray.intersectPlane(plane.current, hitPoint.current)
  }

  const onDown = useCallback(
    (id: string, e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setSelected(id)
      const p = heapRef.current?.placements.find((x) => x.itemId === id)
      const entry = bodies.current.get(id)
      if (!entry || p?.locked) return
      setPressing(true) // Kamera nicht drehen, solange man einen Körper festhält
      ;(e.target as unknown as Element).setPointerCapture?.(e.pointerId)
      const t = entry.body.translation()
      const hit = intersect(e, t.y)
      drag.current = {
        id,
        sx: e.nativeEvent.clientX,
        sy: e.nativeEvent.clientY,
        started: false,
        planeY: t.y,
        offX: hit ? t.x - hit.x : 0,
        offZ: hit ? t.z - hit.z : 0,
        y: t.y,
      }
    },
    [],
  )

  const onMove = useCallback(
    (id: string, e: ThreeEvent<PointerEvent>) => {
      const d = drag.current
      if (!d || d.id !== id) return
      e.stopPropagation()
      if (!d.started) {
        if (Math.hypot(e.nativeEvent.clientX - d.sx, e.nativeEvent.clientY - d.sy) < 6) return
        d.started = true
        setDragging(id)
      }
      const hit = intersect(e, d.planeY)
      const entry = bodies.current.get(id)
      if (!hit || !entry) return
      const x = Math.max(-LIMIT, Math.min(LIMIT, hit.x + d.offX))
      const z = Math.max(-LIMIT, Math.min(LIMIT, hit.z + d.offZ))
      const r = entry.body.rotation()
      const wh = worldHalf(new Quaternion(r.x, r.y, r.z, r.w), entry.half)
      const target = supportHeight(x, z, wh[0], wh[2], others(id)) + wh[1] + 0.04
      // Nach oben sofort (nicht in andere Körper hinein), nach unten sanft
      d.y = target > d.y ? target : d.y + (target - d.y) * 0.4
      entry.body.setNextKinematicTranslation({ x, y: d.y, z })
    },
    [others],
  )

  const endDrag = useCallback(() => {
    const d = drag.current
    drag.current = null
    setPressing(false)
    if (d?.started) {
      setDragging(null)
      requestAnimationFrame(() => bodies.current.get(d.id)?.body.wakeUp())
      scheduleSave()
    }
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

  // Sicherheitsnetz, falls das Loslassen außerhalb passiert
  useEffect(() => {
    const up = () => drag.current && endDrag()
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [endDrag])

  // ---- Anzeige -------------------------------------------------------------------

  const placedIds = new Set(heap?.placements.map((p) => p.itemId))
  const tray = items.filter((i) => !placedIds.has(i.id))
  const selItem = items.find((i) => i.id === selected)
  const selPlacement = placementOf(selected)
  const locked = !!selPlacement?.locked

  return (
    <section className="heap">
      <div className="heap-head">
        <button className="btn ghost back" onClick={onBack}>
          ← Zurück
        </button>
        <h2>Mein Haufen</h2>
      </div>

      <div className="heap-stage">
        {heap && (
          <Canvas
            shadows
            dpr={[1, 2]}
            resize={{ scroll: false, debounce: { scroll: 0, resize: 50 } }}
            camera={{ position: [3.4, 3.4, 4.4], fov: 42, near: 0.05, far: 80 }}
            onPointerMissed={() => setSelected(null)}
          >
            <color attach="background" args={['#e9eeed']} />
            <fog attach="fog" args={['#e9eeed', 9, 26]} />
            <hemisphereLight intensity={0.9} groundColor="#b8b0a2" />
            <directionalLight
              castShadow
              position={[4, 7, 3]}
              intensity={1.7}
              shadow-mapSize={[1024, 1024]}
              shadow-camera-left={-5}
              shadow-camera-right={5}
              shadow-camera-top={5}
              shadow-camera-bottom={-5}
            />
            <CameraGrab target={camera} />
            <Suspense fallback={null}>
              <Physics gravity={[0, -9.81, 0]}>
                {/* Boden und unsichtbare Ränder, damit nichts herunterfällt */}
                <RigidBody type="fixed" colliders={false}>
                  <CuboidCollider args={[GROUND_HALF, 0.05, GROUND_HALF]} position={[0, -0.05, 0]} friction={1} />
                  <CuboidCollider args={[0.05, 2, GROUND_HALF]} position={[GROUND_HALF, 2, 0]} />
                  <CuboidCollider args={[0.05, 2, GROUND_HALF]} position={[-GROUND_HALF, 2, 0]} />
                  <CuboidCollider args={[GROUND_HALF, 2, 0.05]} position={[0, 2, GROUND_HALF]} />
                  <CuboidCollider args={[GROUND_HALF, 2, 0.05]} position={[0, 2, -GROUND_HALF]} />
                </RigidBody>
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
              </Physics>
            </Suspense>
            {/* Großer Boden bis zum Horizont, die Baufläche ist durch das Raster markiert */}
            <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0]} receiveShadow>
              <planeGeometry args={[80, 80]} />
              <meshStandardMaterial color="#cbc5ba" roughness={1} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} receiveShadow>
              <planeGeometry args={[GROUND_HALF * 2, GROUND_HALF * 2]} />
              <meshStandardMaterial color="#d8d3c9" roughness={1} />
            </mesh>
            <Grid
              position={[0, 0.002, 0]}
              args={[GROUND_HALF * 2, GROUND_HALF * 2]}
              cellSize={0.5}
              sectionSize={1}
              cellColor="#b9b2a6"
              sectionColor="#9d958a"
              fadeDistance={16}
              infiniteGrid={false}
            />
            <OrbitControls
              ref={controls}
              makeDefault
              enabled={!pressing}
              target={[0, 0.4, 0]}
              minDistance={0.8}
              maxDistance={12}
              maxPolarAngle={Math.PI / 2.05}
            />
          </Canvas>
        )}
        <button className="heap-reset" onClick={() => controls.current?.reset()}>
          Ansicht zurücksetzen
        </button>
        {heap && heap.placements.length === 0 && (
          <p className="heap-empty">Tippe unten auf einen Gegenstand, um ihn auf deinen Haufen zu legen.</p>
        )}
      </div>

      <div className="heap-tools" aria-live="polite">
        {selItem ? (
          <>
            <div className="heap-sel">
              <strong>{selItem.title}</strong>
              <span className="quiet small">
                {dims(selItem.widthCm, selItem.heightCm, selItem.depthCm)}
                {locked ? ' · festgesetzt' : ''}
              </span>
            </div>
            <div className="row">
              <button className="btn small" onClick={turn} disabled={locked}>
                ↻ Drehen
              </button>
              <button className="btn small" onClick={tip} disabled={locked}>
                Kippen
              </button>
              <button className="btn small" onClick={toggleLock}>
                {locked ? 'Lösen' : 'Festsetzen'}
              </button>
              <button className="btn small" onClick={() => onOpen(selItem.id)}>
                Details
              </button>
              <button className="btn small danger-ghost" onClick={removeSelected} disabled={locked}>
                Herausnehmen
              </button>
            </div>
          </>
        ) : (
          <p className="quiet small">
            Tippe einen Gegenstand an, um ihn zu drehen oder zu kippen. Mit dem Finger ziehst du ihn an eine andere Stelle
            oder auf einen anderen Gegenstand. Wischen auf der freien Fläche dreht die Ansicht, zwei Finger zoomen.
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
    </section>
  )
}
