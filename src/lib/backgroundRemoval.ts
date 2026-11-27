// Entfernt den Hintergrund eines Fotos direkt auf dem Handy.
//
// Dafür nutzen wir das kleine KI-Modell U²-Netp (4,5 MB, Apache-2.0-Lizenz)
// und onnxruntime-web (MIT-Lizenz), das solche Modelle im Browser ausführt.
// Die Fotos verlassen dabei nie das Gerät.
import * as ort from 'onnxruntime-web/wasm'

const MODEL_SIZE = 320 // Das Modell arbeitet mit 320 × 320 Pixeln.
const MAX_IMAGE_SIDE = 1280 // Größere Fotos werden verkleinert, das spart Speicher.

let sessionPromise: Promise<ort.InferenceSession> | null = null

function assetUrl(path: string) {
  return new URL(path, document.baseURI).href
}

/** Das Modell liegt als Base64 in einer JSON-Datei, weil nicht jeder Hoster .onnx-Dateien ausliefert. */
async function loadModelBytes(): Promise<Uint8Array> {
  const res = await fetch(assetUrl('./models/u2netp.json'))
  if (!res.ok) throw new Error(`Modell nicht gefunden (${res.status})`)
  const { base64 } = (await res.json()) as { base64: string }
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Lädt das Modell. Kann früh aufgerufen werden, damit es bereitsteht. */
export function preloadModel(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1
    ort.env.wasm.proxy = false
    // Die Laufzeit-Datei (.wasm) bindet Vite beim Bauen automatisch mit ein.
    sessionPromise = loadModelBytes()
      .then((bytes) =>
        ort.InferenceSession.create(bytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        }),
      )
      .catch((err) => {
        sessionPromise = null // Beim nächsten Versuch neu laden.
        throw err
      })
  }
  return sessionPromise
}

/**
 * Lädt ein Foto, dreht es richtig herum und verkleinert es.
 * Beim Zeichnen auf eine Canvas gehen alle Metadaten verloren,
 * auch ein eventuell gespeicherter GPS-Standort. Das ist hier gewollt.
 */
export async function loadPhoto(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

export const MASK_SIZE = MODEL_SIZE

/**
 * Lässt das Modell eine Maske berechnen (MASK_SIZE × MASK_SIZE Werte).
 * Werte nahe 1 = Gegenstand, nahe 0 = Hintergrund. Das Bild wird dafür
 * auf ein Quadrat gestaucht, die Maske gilt also relativ zur Bildgröße.
 */
export async function predictMask(source: CanvasImageSource): Promise<Float32Array> {
  const session = await preloadModel()

  // Bild auf 320 × 320 bringen und in Zahlen umwandeln, so wie das Modell sie erwartet.
  const small = document.createElement('canvas')
  small.width = MODEL_SIZE
  small.height = MODEL_SIZE
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(source, 0, 0, MODEL_SIZE, MODEL_SIZE)
  const { data } = sctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE)

  let max = 1
  for (let i = 0; i < data.length; i++) if (i % 4 !== 3 && data[i] > max) max = data[i]

  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  const plane = MODEL_SIZE * MODEL_SIZE
  const input = new Float32Array(3 * plane)
  for (let p = 0; p < plane; p++) {
    for (let c = 0; c < 3; c++) {
      input[c * plane + p] = (data[p * 4 + c] / max - mean[c]) / std[c]
    }
  }

  const tensor = new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE])
  const results = await session.run({ [session.inputNames[0]]: tensor })
  return results[session.outputNames[0]].data as Float32Array
}

/**
 * Erstellt aus dem Foto ein Bild mit durchsichtigem Hintergrund.
 * Mit crop = true wird es eng auf den Gegenstand zugeschnitten,
 * mit crop = false bleibt es genauso groß wie das Foto.
 */
export async function removeBackground(photo: HTMLCanvasElement, crop = true): Promise<HTMLCanvasElement> {
  const mask = await predictMask(photo)
  const plane = MODEL_SIZE * MODEL_SIZE

  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < plane; i++) {
    if (mask[i] < lo) lo = mask[i]
    if (mask[i] > hi) hi = mask[i]
  }
  const range = hi - lo || 1

  // 3. Maske als Transparenz auf das Foto legen.
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = MODEL_SIZE
  maskCanvas.height = MODEL_SIZE
  const mctx = maskCanvas.getContext('2d')!
  const maskImage = mctx.createImageData(MODEL_SIZE, MODEL_SIZE)
  for (let i = 0; i < plane; i++) {
    const v = (mask[i] - lo) / range
    // Leichte Kurve: unsichere Randbereiche werden klarer getrennt.
    const a = Math.min(1, Math.max(0, (v - 0.15) / 0.7))
    maskImage.data[i * 4 + 3] = Math.round(a * 255)
  }
  mctx.putImageData(maskImage, 0, 0)

  const out = document.createElement('canvas')
  out.width = photo.width
  out.height = photo.height
  const octx = out.getContext('2d', { willReadFrequently: true })!
  octx.drawImage(photo, 0, 0)
  octx.globalCompositeOperation = 'destination-in'
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(maskCanvas, 0, 0, out.width, out.height)
  octx.globalCompositeOperation = 'source-over'

  return crop ? cropToContent(out) : out
}

/** Schneidet durchsichtige Ränder ab, damit das Bild genau den Gegenstand zeigt. */
function cropToContent(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const { width, height } = canvas
  const { data } = ctx.getImageData(0, 0, width, height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 24) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return canvas // Nichts gefunden, Bild unverändert lassen.
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const cropped = document.createElement('canvas')
  cropped.width = w
  cropped.height = h
  cropped.getContext('2d')!.drawImage(canvas, minX, minY, w, h, 0, 0, w, h)
  return cropped
}

/** Speichert eine Canvas als Bilddatei. WebP behält die Transparenz und ist klein. */
export function canvasToBlob(canvas: HTMLCanvasElement, transparent: boolean): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const type = transparent ? 'image/webp' : 'image/jpeg'
    canvas.toBlob(
      (blob) => {
        if (blob && blob.type === type) return resolve(blob)
        // Ältere Browser können kein WebP speichern, dann nehmen wir PNG.
        canvas.toBlob((png) => (png ? resolve(png) : reject(new Error('Bild konnte nicht gespeichert werden'))), 'image/png')
      },
      type,
      0.88,
    )
  })
}
