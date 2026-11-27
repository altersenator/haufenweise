// Ein Gegenstand im 3D-Haufen: ein Quader in echter Größe mit Physik und Fotos auf den Seiten.
import { Edges } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { memo, useCallback, useMemo } from 'react'
import { Quaternion } from 'three'
import type { Item, Placement } from '../types'
import { halfExtents, type Vec3 } from './geometry'
import { useBodyMaterials } from './useBodyMaterials'

export interface BodyEntry {
  body: RapierRigidBody
  half: Vec3
}

type Handler = (id: string, e: ThreeEvent<PointerEvent>) => void

interface Props {
  item: Item
  initial: Placement
  locked: boolean
  selected: boolean
  dragging: boolean
  onRegister: (id: string, entry: BodyEntry | null) => void
  onDown: Handler
  onMove: Handler
  onUp: Handler
}

export const HeapBody = memo(function HeapBody({
  item,
  initial,
  locked,
  selected,
  dragging,
  onRegister,
  onDown,
  onMove,
  onUp,
}: Props) {
  const half = useMemo(() => halfExtents(item), [item])
  const materials = useBodyMaterials(item)

  // Start-Position und -Drehung nur beim ersten Erscheinen setzen, danach bewegt die Physik den Körper
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const position = useMemo(() => initial.pos, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const quaternion = useMemo(() => new Quaternion(...initial.rot), [])

  const register = useCallback(
    (body: RapierRigidBody | null) => onRegister(item.id, body ? { body, half } : null),
    [item.id, half, onRegister],
  )

  const type = locked ? 'fixed' : dragging ? 'kinematicPosition' : 'dynamic'

  return (
    <RigidBody
      ref={register}
      type={type}
      colliders={false}
      position={position}
      quaternion={quaternion}
      linearDamping={0.6}
      angularDamping={2}
      ccd
    >
      {/* Beim Ziehen durchlässig, damit nichts angeschoben oder umgestoßen wird */}
      <CuboidCollider args={half} friction={0.9} restitution={0.02} density={250} sensor={dragging} />
      <mesh
        castShadow
        receiveShadow
        material={materials}
        onPointerDown={(e) => onDown(item.id, e)}
        onPointerMove={(e) => onMove(item.id, e)}
        onPointerUp={(e) => onUp(item.id, e)}
        onPointerCancel={(e) => onUp(item.id, e)}
      >
        <boxGeometry args={[half[0] * 2, half[1] * 2, half[2] * 2]} />
        {selected && <Edges color={locked ? '#868e96' : '#ff6a13'} lineWidth={3} />}
      </mesh>
    </RigidBody>
  )
})
