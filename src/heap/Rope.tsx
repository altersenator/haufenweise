// Ein Seil zwischen einem Haken (am Deko-Baustein) und einem aufgehängten Gegenstand.
// Physikalisch ist das ein Seilgelenk: Der Abstand kann kürzer werden, aber nie länger als das Seil.
import { useFrame } from '@react-three/fiber'
import { useRopeJoint, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, type RefObject } from 'react'
import { BufferAttribute, BufferGeometry, Line, LineBasicMaterial, Quaternion, Vector3 } from 'three'
import type { Vec3 } from './geometry'

interface Props {
  a: RapierRigidBody
  b: RapierRigidBody
  anchorA: Vec3
  anchorB: Vec3
  length: number
}

const tmpQ = new Quaternion()
const tmpV = new Vector3()

function worldPoint(body: RapierRigidBody, local: Vec3, out: Float32Array, offset: number) {
  const t = body.translation()
  const r = body.rotation()
  tmpQ.set(r.x, r.y, r.z, r.w)
  tmpV.set(...local).applyQuaternion(tmpQ)
  out[offset] = t.x + tmpV.x
  out[offset + 1] = t.y + tmpV.y
  out[offset + 2] = t.z + tmpV.z
}

export function Rope({ a, b, anchorA, anchorB, length }: Props) {
  const ra = useMemo(() => ({ current: a }), [a]) as RefObject<RapierRigidBody>
  const rb = useMemo(() => ({ current: b }), [b]) as RefObject<RapierRigidBody>
  useRopeJoint(ra, rb, [anchorA, anchorB, length])

  const line = useMemo(() => {
    const geom = new BufferGeometry()
    geom.setAttribute('position', new BufferAttribute(new Float32Array(6), 3))
    return new Line(geom, new LineBasicMaterial({ color: '#4a3b2c' }))
  }, [])
  useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as LineBasicMaterial).dispose()
    },
    [line],
  )

  useFrame(() => {
    const attr = line.geometry.getAttribute('position') as BufferAttribute
    const arr = attr.array as Float32Array
    try {
      worldPoint(a, anchorA, arr, 0)
      worldPoint(b, anchorB, arr, 3)
    } catch {
      return // Körper wurde gerade entfernt
    }
    attr.needsUpdate = true
    line.geometry.computeBoundingSphere()
  })

  return <primitive object={line} />
}
