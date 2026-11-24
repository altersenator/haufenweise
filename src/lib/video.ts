// Hilfsfunktionen für das Rundum-Video: Video laden und Standbilder herausholen.

const MAX_SIDE = 1280

export interface LoadedVideo {
  video: HTMLVideoElement
  duration: number
  dispose: () => void
}

function once(el: HTMLElement, event: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      el.removeEventListener(event, ok)
      reject(new Error(`Zeitüberschreitung beim Warten auf ${event}`))
    }, timeoutMs)
    const ok = () => {
      clearTimeout(timer)
      el.removeEventListener(event, ok)
      resolve()
    }
    el.addEventListener(event, ok)
  })
}

export async function loadVideo(file: Blob): Promise<LoadedVideo> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  const failed = new Promise<never>((_, reject) =>
    video.addEventListener('error', () => reject(new Error('Video kann nicht abgespielt werden')), { once: true }),
  )
  await Promise.race([once(video, 'loadedmetadata'), failed])

  let duration = video.duration
  // Manche Handys speichern die Länge nicht im Video. Dann ans Ende springen, um sie zu erfahren.
  if (!Number.isFinite(duration)) {
    video.currentTime = 1e7
    await once(video, 'seeked').catch(() => {})
    duration = video.duration
    video.currentTime = 0
    await once(video, 'seeked').catch(() => {})
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Videolänge unbekannt')

  // Manche Android-Browser zeigen erst nach kurzem Abspielen echte Bilder.
  try {
    await video.play()
    video.pause()
  } catch {
    /* nicht schlimm */
  }

  return { video, duration, dispose: () => URL.revokeObjectURL(url) }
}

// Nacheinander springen, damit sich mehrere Anfragen nicht in die Quere kommen.
let queue: Promise<unknown> = Promise.resolve()

/** Holt das Standbild an Sekunde t und zeichnet es auf eine Canvas. */
export function grabFrame(v: LoadedVideo, t: number, maxSide = MAX_SIDE): Promise<HTMLCanvasElement> {
  const job = queue.then(async () => {
    const { video } = v
    const target = Math.min(Math.max(0, t), Math.max(0, v.duration - 0.05))
    if (Math.abs(video.currentTime - target) > 0.01) {
      const done = once(video, 'seeked')
      video.currentTime = target
      await done
    }
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas
  })
  queue = job.catch(() => {})
  return job
}
