// Ein Deko-Baustein im Haufen: zusammengesetzt aus einfachen Teilen, mit Physik.
// Die Schaukel hat zusätzlich einen beweglichen Sitz, der an einem Gelenk hängt.
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import {
  CuboidCollider,
  CylinderCollider,
  RigidBody,
  useRevoluteJoint,
  type RapierRigidBody,
} from '@react-three/rapier'
import { memo, useCallback, useMemo, useRef, type RefObject } from 'react'
import { CanvasTexture, MeshStandardMaterial, Quaternion, SRGBColorSpace, Vector3 } from 'three'
import type { DecoPlacement } from '../types'
import { DECOS, decoMeters, type Part, type SeatDef } from './decos'
import type { BodyEntry } from './HeapBody'

type Handler = (id: string, e: ThreeEvent<PointerEvent>) => void

interface Props {
  deco: DecoPlacement
  selected: boolean
  dragging: boolean
  onRegister: (id: string, entry: BodyEntry | null) => void
  onSeat: (id: string, seat: RapierRigidBody | null) => void
  onDown: Handler
  onMove: Handler
  onUp: Handler
}

// Zahlen auf dem Siegertreppchen als kleine Bild-Textur
const labelCache = new Map<string, CanvasTexture>()
function labelTexture(text: string) {
  let tex = labelCache.get(text)
  if (!tex) {
    const c = document.createElement('canvas')
    c.width = 256
    c.height = 256
    const g = c.getContext('2d')!
    g.fillStyle = '#f4f2ee'
    g.fillRect(0, 0, 256, 256)
    g.fillStyle = '#12343b'
    g.font = 'bold 150px Barlow, Arial, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(text, 128, 140)
    tex = new CanvasTexture(c)
    tex.colorSpace = SRGBColorSpace
    labelCache.set(text, tex)
  }
  return tex
}

function PartMesh({ part }: { part: Part }) {
  const materials = useMemo(() => {
    const plain = new MeshStandardMaterial({ color: part.color, roughness: 0.75, metalness: part.color === '#5b7a86' ? 0.4 : 0 })
    if (part.shape === 'box' && part.label) {
      const front = new MeshStandardMaterial({ map: labelTexture(part.label), roughness: 0.8 })
      // Reihenfolge: +x, -x, +y, -y, +z (vorne), -z
      return [plain, plain, plain, plain, front, plain]
    }
    return plain
  }, [part])
  return (
    <mesh position={part.pos} rotation={part.rot ?? [0, 0, 0]} material={materials} castShadow receiveShadow>
      {part.shape === 'box' && <boxGeometry args={[part.half[0] * 2, part.half[1] * 2, part.half[2] * 2]} />}
      {part.shape === 'cyl' && <cylinderGeometry args={[part.r, part.r, part.halfH * 2, 32]} />}
      {part.shape === 'torus' && <torusGeometry args={[part.radius, part.tube, 10, 32]} />}
    </mesh>
  )
}

function PartCollider({ part, sensor }: { part: Part; sensor: boolean }) {
  if (part.visualOnly) return null
  if (part.shape === 'box')
    return <CuboidCollider args={part.half} position={part.pos} rotation={part.rot ?? [0, 0, 0]} friction={0.9} restitution={0.02} density={900} sensor={sensor} />
  if (part.shape === 'cyl')
    return <CylinderCollider args={[part.halfH, part.r]} position={part.pos} rotation={part.rot ?? [0, 0, 0]} friction={0.9} restitution={0.02} density={900} sensor={sensor} />
  return null
}

/** Sitz der Schaukel: eigener Körper, mit einem Drehgelenk am Balken befestigt. */
function SwingSeat({
  frame,
  seat,
  initialPos,
  initialRot,
  onSeat,
  onDown,
  onMove,
  onUp,
}: {
  frame: RefObject<RapierRigidBody | null>
  seat: SeatDef
  initialPos: [number, number, number]
  initialRot: Quaternion
  onSeat: (seat: RapierRigidBody | null) => void
  onDown: (e: ThreeEvent<PointerEvent>) => void
  onMove: (e: ThreeEvent<PointerEvent>) => void
  onUp: (e: ThreeEvent<PointerEvent>) => void
}) {
  const ref = useRef<RapierRigidBody | null>(null)
  const pos = useMemo(() => {
    const o = new Vector3(...seat.offset).applyQuaternion(initialRot)
    return [initialPos[0] + o.x, initialPos[1] + o.y, initialPos[2] + o.z] as [number, number, number]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useRevoluteJoint(frame as RefObject<RapierRigidBody>, ref as RefObject<RapierRigidBody>, [seat.anchorFrame, seat.anchorSeat, [1, 0, 0]])
  const ropeLen = seat.anchorSeat[1]
  const [hx] = seat.half
  return (
    <RigidBody
      ref={(b) => {
        ref.current = b
        onSeat(b)
      }}
      colliders={false}
      position={pos}
      quaternion={initialRot}
      angularDamping={0.05}
      linearDamping={0.05}
    >
      <CuboidCollider args={seat.half} friction={1} density={400} />
      <mesh castShadow receiveShadow onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}>
        <boxGeometry args={[seat.half[0] * 2, seat.half[1] * 2, seat.half[2] * 2]} />
        <meshStandardMaterial color={seat.color} roughness={0.8} />
      </mesh>
      {/* Seile vom Sitz zum Balken; sie schwingen mit dem Sitz mit */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (hx - 0.02), ropeLen / 2, 0]}>
          <cylinderGeometry args={[0.006, 0.006, ropeLen, 6]} />
          <meshStandardMaterial color="#6d5a45" />
        </mesh>
      ))}
    </RigidBody>
  )
}

export const DecoBody = memo(function DecoBody({ deco, selected, dragging, onRegister, onSeat, onDown, onMove, onUp }: Props) {
  const def = DECOS[deco.kind]
  const [w, h, d] = decoMeters(deco.kind, deco.dims)
  const parts = useMemo(() => def.parts(w, h, d), [def, w, h, d])
  const seat = useMemo(() => def.seat?.(w, h, d), [def, w, h, d])
  const half = useMemo(() => [w / 2, h / 2, d / 2] as [number, number, number], [w, h, d])
  const frame = useRef<RapierRigidBody | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const position = useMemo(() => deco.pos, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const quaternion = useMemo(() => new Quaternion(...deco.rot), [])

  const register = useCallback(
    (b: RapierRigidBody | null) => {
      frame.current = b
      onRegister(deco.id, b ? { body: b, half } : null)
    },
    [deco.id, half, onRegister],
  )

  const type = deco.locked ? 'fixed' : dragging ? 'kinematicPosition' : 'dynamic'

  return (
    <>
      <RigidBody ref={register} type={type} colliders={false} position={position} quaternion={quaternion} angularDamping={2} linearDamping={0.6}>
        {parts.map((p, i) => (
          <PartCollider key={i} part={p} sensor={dragging} />
        ))}
        <group
          onPointerDown={(e) => onDown(deco.id, e)}
          onPointerMove={(e) => onMove(deco.id, e)}
          onPointerUp={(e) => onUp(deco.id, e)}
          onPointerCancel={(e) => onUp(deco.id, e)}
        >
          {parts.map((p, i) => (
            <PartMesh key={i} part={p} />
          ))}
        </group>
        {selected && (
          <mesh raycast={() => null}>
            <boxGeometry args={[w + 0.02, h + 0.02, d + 0.02]} />
            <meshBasicMaterial visible={false} />
            <Edges color={deco.locked ? '#868e96' : '#ff6a13'} lineWidth={2} />
          </mesh>
        )}
      </RigidBody>
      {seat && (
        <SwingSeat
          frame={frame}
          seat={seat}
          initialPos={deco.pos}
          initialRot={quaternion}
          onSeat={(b) => onSeat(deco.id, b)}
          onDown={(e) => onDown(deco.id, e)}
          onMove={(e) => onMove(deco.id, e)}
          onUp={(e) => onUp(deco.id, e)}
        />
      )}
    </>
  )
})
