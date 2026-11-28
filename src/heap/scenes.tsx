// Hintergründe für den Haufen. Sie sind nicht nur Kulisse, sondern bewegen sich zum Teil:
// Beim Polizeifoto blitzt es regelmäßig, der Drehteller dreht sich mit allem, was darauf steht.
import { Grid } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { CuboidCollider, CylinderCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier'
import { useEffect, useMemo, useRef } from 'react'
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Mesh, type MeshStandardMaterial, type PointLight, type Texture } from 'three'
import type { SceneKind, SceneOptions } from '../types'
import type { Vec3 } from './geometry'

export const SCENES: { kind: SceneKind; label: string }[] = [
  { kind: 'plain', label: 'Wand' },
  { kind: 'mugshot', label: 'Polizeifoto' },
  { kind: 'turntable', label: 'Drehteller' },
]

/**
 * Die Bühne: hinten eine Wand, davor eine begrenzte Fläche zum Arrangieren.
 * Alle Maße in Metern, die Wand steht bei z = back.
 */
export const STAGE = { halfW: 2.5, back: -1.5, front: 2.0, wallH: 2.8 }
export const STAGE_CENTER_Z = (STAGE.back + STAGE.front) / 2

/** Kameraposition und Blickpunkt, mit denen jeder Hintergrund startet. Die Kamera schaut immer auf die Wand. */
export const CAMERA_PRESETS: Record<SceneKind, { position: Vec3; target: Vec3 }> = {
  plain: { position: [0, 1.55, 5.4], target: [0, 0.8, -0.3] },
  mugshot: { position: [0, 1.4, 5.2], target: [0, 0.9, -0.5] },
  turntable: { position: [0, 2.3, 5.4], target: [0, 0.45, 0.1] },
}

/** Grenzen für den Blickpunkt der Kamera, damit man nie hinter die Wand oder ins Leere schaut */
export const CAMERA_TARGET_BOUNDS = { min: [-1.8, 0.2, STAGE.back + 0.4] as Vec3, max: [1.8, 1.9, 1.4] as Vec3 }

export const TURNTABLE_RADIUS = 1.4
const TURNTABLE_TOP = 0.1

interface StageProps {
  floor?: string
  wall?: string
  wallMap?: Texture
  grid?: boolean
}

/** Boden, Wand und unsichtbare Ränder, gemeinsam für alle Hintergründe */
export function Stage({ floor = '#dcd4c6', wall = '#ece7dd', wallMap, grid = true }: StageProps) {
  const w = STAGE.halfW * 2
  const depth = STAGE.front - STAGE.back
  return (
    <>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[STAGE.halfW + 0.5, 0.05, depth / 2 + 0.5]} position={[0, -0.05, STAGE_CENTER_Z]} friction={1} />
        <CuboidCollider args={[STAGE.halfW, STAGE.wallH / 2, 0.05]} position={[0, STAGE.wallH / 2, STAGE.back - 0.05]} friction={0.6} />
      </RigidBody>
      {/* Unsichtbare Ränder links, rechts und vorne. Zielstrahlen beim Ziehen gehen durch sie hindurch. */}
      <RigidBody type="fixed" colliders={false} userData={{ boundary: true }}>
        <CuboidCollider args={[0.05, 1.5, depth / 2]} position={[STAGE.halfW + 0.05, 1.5, STAGE_CENTER_Z]} />
        <CuboidCollider args={[0.05, 1.5, depth / 2]} position={[-STAGE.halfW - 0.05, 1.5, STAGE_CENTER_Z]} />
        <CuboidCollider args={[STAGE.halfW, 1.5, 0.05]} position={[0, 1.5, STAGE.front + 0.05]} />
      </RigidBody>

      {/* Umgebung, verschwimmt im Hintergrund */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.004, 0]} receiveShadow>
        <planeGeometry args={[60, 60]} />
        <meshStandardMaterial color="#cbc5ba" roughness={1} />
      </mesh>
      {/* Fläche zum Arrangieren */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, STAGE_CENTER_Z]} receiveShadow>
        <planeGeometry args={[w, depth]} />
        <meshStandardMaterial color={floor} roughness={1} />
      </mesh>
      {/* Vorderkante der Fläche */}
      <mesh position={[0, 0.006, STAGE.front - 0.015]} receiveShadow>
        <boxGeometry args={[w, 0.012, 0.03]} />
        <meshStandardMaterial color="#12343b" roughness={0.8} />
      </mesh>
      {grid && (
        <Grid
          position={[0, 0.003, STAGE_CENTER_Z]}
          args={[w, depth]}
          cellSize={0.5}
          sectionSize={1}
          cellColor="#c4bcae"
          sectionColor="#aaa194"
          fadeDistance={20}
          infiniteGrid={false}
        />
      )}
      {/* Wand */}
      <mesh position={[0, STAGE.wallH / 2, STAGE.back]} receiveShadow>
        <planeGeometry args={[w, STAGE.wallH]} />
        <meshStandardMaterial color={wallMap ? '#ffffff' : wall} map={wallMap ?? null} roughness={0.95} />
      </mesh>
      <mesh position={[0, STAGE.wallH / 2, STAGE.back - 0.06]} castShadow>
        <boxGeometry args={[w + 0.08, STAGE.wallH + 0.04, 0.1]} />
        <meshStandardMaterial color="#b9b2a6" roughness={1} />
      </mesh>
      {!wallMap && (
        <mesh position={[0, 0.04, STAGE.back + 0.01]} receiveShadow>
          <boxGeometry args={[w, 0.08, 0.02]} />
          <meshStandardMaterial color="#f7f4ee" roughness={0.8} />
        </mesh>
      )}
    </>
  )
}

// ---- Polizeifoto ---------------------------------------------------------------

const WALL_W = STAGE.halfW * 2
const WALL_H = STAGE.wallH

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
    if (major && cm <= 200) {
      g.font = 'bold 34px Barlow, Arial, sans-serif'
      g.textBaseline = 'bottom'
      const label = `${cm} cm`
      for (const x of [0.3, 1.45, 2.5, 3.55, 4.7]) {
        g.textAlign = 'center'
        g.fillText(label, x * pxPerM, yOf(cm) - 6)
      }
    }
  }
  g.fillStyle = '#1f2d33'
  g.font = 'bold 40px Barlow, Arial, sans-serif'
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
      <mesh position={[STAGE.halfW - 0.3, WALL_H - 0.3, STAGE.back + 0.03]}>
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
      <Stage floor="#a3a29d" wallMap={tex} grid={false} />
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
      <Stage />
      <RigidBody
        ref={body}
        type="kinematicVelocity"
        colliders={false}
        position={[0, TURNTABLE_TOP / 2, STAGE_CENTER_Z]}
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
