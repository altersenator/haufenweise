// Hintergründe für den Haufen. Sie sind nicht nur Kulisse, sondern bewegen sich zum Teil:
// Beim Polizeifoto blitzt es regelmäßig, der Drehteller dreht sich mit allem, was darauf steht.
import { Grid } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Mesh, type MeshStandardMaterial, type PointLight } from 'three'
import type { SceneKind, SceneOptions } from '../types'
import { GROUND_HALF, type Vec3 } from './geometry'

export const SCENES: { kind: SceneKind; label: string }[] = [
  { kind: 'plain', label: 'Freie Fläche' },
  { kind: 'mugshot', label: 'Polizeifoto' },
  { kind: 'turntable', label: 'Drehteller' },
]

/** Kameraposition und Blickpunkt, mit denen jeder Hintergrund startet */
export const CAMERA_PRESETS: Record<SceneKind, { position: Vec3; target: Vec3 }> = {
  plain: { position: [3.4, 3.4, 4.4], target: [0, 0.4, 0] },
  mugshot: { position: [0, 1.3, 4.6], target: [0, 0.9, -0.6] },
  turntable: { position: [0, 2.6, 4.6], target: [0, 0.4, 0] },
}

export const MUGSHOT_WALL_Z = -1.6
export const TURNTABLE_RADIUS = 1.6
const TURNTABLE_TOP = 0.1

/** Boden und unsichtbare Ränder, gemeinsam für alle Hintergründe */
export function Ground({ color = '#d8d3c9', grid = true }: { color?: string; grid?: boolean }) {
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[GROUND_HALF, 0.05, GROUND_HALF]} position={[0, -0.05, 0]} friction={1} />
        <CuboidCollider args={[0.05, 2, GROUND_HALF]} position={[GROUND_HALF, 2, 0]} />
        <CuboidCollider args={[0.05, 2, GROUND_HALF]} position={[-GROUND_HALF, 2, 0]} />
        <CuboidCollider args={[GROUND_HALF, 2, 0.05]} position={[0, 2, GROUND_HALF]} />
        <CuboidCollider args={[GROUND_HALF, 2, 0.05]} position={[0, 2, -GROUND_HALF]} />
      </RigidBody>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.001, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#cbc5ba" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[GROUND_HALF * 2, GROUND_HALF * 2]} />
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      {grid && (
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
      )}
    </>
  )
}

// ---- Polizeifoto ---------------------------------------------------------------

const WALL_W = GROUND_HALF * 2
const WALL_H = 3

/** Wand mit Messlatte in echten Zentimetern, wie bei einem Polizeifoto */
function mugshotTexture() {
  const pxPerM = 240
  const c = document.createElement('canvas')
  c.width = WALL_W * pxPerM
  c.height = WALL_H * pxPerM
  const g = c.getContext('2d')!
  g.fillStyle = '#c9d3d6'
  g.fillRect(0, 0, c.width, c.height)
  const yOf = (cm: number) => c.height - (cm / 100) * pxPerM
  for (let cm = 10; cm < WALL_H * 100; cm += 10) {
    const major = cm % 50 === 0
    g.fillStyle = major ? '#1f2d33' : '#5d6c71'
    g.fillRect(0, yOf(cm) - (major ? 2.5 : 1), c.width, major ? 5 : 2)
    if (major) {
      g.font = 'bold 34px Barlow, Arial, sans-serif'
      g.textBaseline = 'bottom'
      const label = `${cm} cm`
      for (const x of [0.35, 2.6, 4.5, 6.4, 8.65]) {
        g.textAlign = 'center'
        g.fillText(label, x * pxPerM, yOf(cm) - 6)
      }
    }
  }
  g.fillStyle = '#1f2d33'
  g.font = 'bold 54px Barlow, Arial, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'top'
  g.fillText('HAUFENWEISE · SPERRMÜLL-ERKENNUNGSDIENST', c.width / 2, 24)
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function Flash() {
  const light = useRef<PointLight>(null)
  const dot = useRef<MeshStandardMaterial>(null)
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    // Alle 6 Sekunden ein kurzer Doppelblitz
    const p = t % 6
    const flash = p < 0.08 ? 1 : p > 0.22 && p < 0.3 ? 0.8 : 0
    if (light.current) light.current.intensity = flash * 40
    // Kleine rote Aufnahmeleuchte blinkt jede Sekunde
    if (dot.current) dot.current.emissiveIntensity = Math.floor(t * 1.5) % 2 ? 0.1 : 2.5
  })
  return (
    <>
      <pointLight ref={light} position={[0, 1.8, 3]} intensity={0} distance={14} decay={1.2} color="#ffffff" />
      <mesh position={[GROUND_HALF - 0.4, WALL_H - 0.3, MUGSHOT_WALL_Z + 0.03]}>
        <sphereGeometry args={[0.05, 16, 16]} />
        <meshStandardMaterial ref={dot} color="#c92a2a" emissive="#ff2a2a" emissiveIntensity={2} />
      </mesh>
    </>
  )
}

export function MugshotScene() {
  const tex = useMemo(mugshotTexture, [])
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <>
      <Ground color="#9b9a95" grid={false} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[WALL_W / 2, WALL_H / 2, 0.05]} position={[0, WALL_H / 2, MUGSHOT_WALL_Z - 0.05]} friction={0.6} />
      </RigidBody>
      <mesh position={[0, WALL_H / 2, MUGSHOT_WALL_Z]} receiveShadow>
        <planeGeometry args={[WALL_W, WALL_H]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      <Flash />
    </>
  )
}

// ---- Drehteller ------------------------------------------------------------------

function turntableTexture() {
  const s = 1024
  const c = document.createElement('canvas')
  c.width = s
  c.height = s
  const g = c.getContext('2d')!
  const cx = s / 2
  const n = 16
  for (let i = 0; i < n; i++) {
    g.beginPath()
    g.moveTo(cx, cx)
    g.arc(cx, cx, cx, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2)
    g.closePath()
    g.fillStyle = i % 2 ? '#e8e2d6' : '#ff8a3d'
    g.fill()
  }
  g.beginPath()
  g.arc(cx, cx, cx * 0.18, 0, Math.PI * 2)
  g.fillStyle = '#12343b'
  g.fill()
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  tex.wrapS = tex.wrapT = RepeatWrapping
  return tex
}

export function TurntableScene({ options }: { options: SceneOptions }) {
  const body = useRef<RapierRigidBody>(null)
  const tex = useMemo(turntableTexture, [])
  const rim = useRef<Mesh>(null)
  useEffect(() => () => tex.dispose(), [tex])

  // Geschwindigkeit setzen; Gegenstände auf dem Teller werden durch die Reibung mitgenommen
  useEffect(() => {
    body.current?.setAngvel({ x: 0, y: options.running ? options.speed : 0, z: 0 }, true)
  }, [options.speed, options.running])

  // Lauflichter am Rand
  useFrame(({ clock }) => {
    if (rim.current) (rim.current.material as MeshStandardMaterial).emissiveIntensity = 0.6 + Math.sin(clock.getElapsedTime() * 4) * 0.4
  })

  return (
    <>
      <Ground />
      <RigidBody
        ref={body}
        type="kinematicVelocity"
        colliders={false}
        position={[0, TURNTABLE_TOP / 2, 0]}
        onWake={() => body.current?.setAngvel({ x: 0, y: options.running ? options.speed : 0, z: 0 }, true)}
      >
        <CylinderCollider args={[TURNTABLE_TOP / 2, TURNTABLE_RADIUS]} friction={1.4} />
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[TURNTABLE_RADIUS, TURNTABLE_RADIUS * 1.02, TURNTABLE_TOP, 64]} />
          <meshStandardMaterial attach="material-0" color="#12343b" />
          <meshStandardMaterial attach="material-1" map={tex} roughness={0.7} />
          <meshStandardMaterial attach="material-2" color="#12343b" />
        </mesh>
        <mesh ref={rim} position={[0, TURNTABLE_TOP / 2, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[TURNTABLE_RADIUS, 0.015, 8, 96]} />
          <meshStandardMaterial color="#ffd8a8" emissive="#ff922b" emissiveIntensity={0.8} />
        </mesh>
      </RigidBody>
    </>
  )
}
