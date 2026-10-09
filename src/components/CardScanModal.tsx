import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  findQrCode,
  hasPerson,
  loadImage,
  loadQrDecoder,
  parseQrPayload,
  photoReadingAvailable,
  readCardPhoto,
  toJpegBase64,
  type ScanSource,
  type ScannedCard,
} from '../lib/businessCard'
import './ui.css'
import './card-scan.css'

interface Props {
  onClose: () => void
  onResult: (card: ScannedCard, source: ScanSource) => void
}

type CameraState = 'starting' | 'live' | 'unavailable'

/** How often the live view is checked for a QR code. Four a second is plenty. */
const QR_INTERVAL_MS = 250

/**
 * Point the camera at a business card and get its details back.
 *
 * Two ways in, tried in this order:
 *
 *   1. **A QR code**, watched for continuously on the live view. A vCard or
 *      MECARD fills the form the moment it is in focus, and is read entirely
 *      in the browser — nothing is uploaded.
 *   2. **The printed card**, when the rep presses Capture (or picks a photo).
 *      The frame is checked once more for a QR code at full resolution, and
 *      only if there is none does it go to the scan-card function to be read.
 *
 * A QR code that is only a link (a website, a profile page) does not end the
 * scan: it is held as the website, and the printed side is still needed for
 * the person.
 *
 * Portalled to <body> and stacked above the form that opened it.
 */
export default function CardScanModal({ onClose, onResult }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // While a photo is being read the live QR check stands down, so a code that
  // drifts into view cannot finish the scan underneath the request.
  const busyRef = useRef(false)

  const [camera, setCamera] = useState<CameraState>('starting')
  const [photoReading, setPhotoReading] = useState<boolean | null>(null)
  const [linkHint, setLinkHint] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const finish = useCallback(
    (card: ScannedCard, source: ScanSource) => {
      busyRef.current = true
      onResult(linkHint && !card.website ? { ...card, website: linkHint } : card, source)
    },
    [linkHint, onResult]
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    loadQrDecoder().catch(() => {})
    photoReadingAvailable().then((ok) => {
      if (!cancelled) setPhotoReading(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // The camera. getUserMedia needs a secure origin (https, or localhost) and
  // the user's permission; failing either, the scanner still works from a
  // picked photo, which on a phone offers the camera app anyway.
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamera('unavailable')
        return
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play().catch(() => {})
        setCamera('live')
      } catch {
        if (!cancelled) setCamera('unavailable')
      }
    }

    start()
    return () => {
      cancelled = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  // Watch the live view for a QR code.
  useEffect(() => {
    if (camera !== 'live') return
    const timer = window.setInterval(() => {
      const video = videoRef.current
      if (busyRef.current || !video || video.readyState < 2 || !video.videoWidth) return
      const payload = findQrCode(video, video.videoWidth, video.videoHeight)
      if (!payload) return
      const parsed = parseQrPayload(payload)
      if (parsed?.kind === 'contact') finish(parsed.card, 'qr')
      else if (parsed?.kind === 'link') setLinkHint((current) => current ?? parsed.url)
    }, QR_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [camera, finish])

  /** One still — a captured frame or a picked photo — through both readers. */
  async function readStill(source: CanvasImageSource, width: number, height: number) {
    busyRef.current = true
    setError(null)

    await loadQrDecoder().catch(() => {})
    const payload = findQrCode(source, width, height, 1600)
    const parsed = payload ? parseQrPayload(payload) : null
    if (parsed?.kind === 'contact') {
      finish(parsed.card, 'qr')
      return
    }
    const link = parsed?.kind === 'link' ? parsed.url : linkHint
    if (link) setLinkHint(link)

    if (!(await photoReadingAvailable())) {
      setError(
        'There is no QR code in that picture, and reading printed cards is not set up yet. ' +
          'Fill the fields in by hand, or ask an admin to deploy the scan-card function.'
      )
      busyRef.current = false
      return
    }

    try {
      const { base64, dataUrl } = toJpegBase64(source, width, height)
      setReading(dataUrl)
      const card = await readCardPhoto(base64)
      if (!hasPerson(card) && !card.company) {
        throw new Error(
          'No details could be found on that card. Fill the frame with the card, in good light, and try again.'
        )
      }
      finish(link && !card.website ? { ...card, website: link } : card, 'photo')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The card could not be read.')
      setReading(null)
      busyRef.current = false
    }
  }

  function capture() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    // Drawn to a canvas first: the video keeps playing while the photo is
    // read, and the still has to be the frame the rep saw when they pressed.
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    readStill(canvas, canvas.width, canvas.height)
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const img = await loadImage(file)
      await readStill(img, img.naturalWidth, img.naturalHeight)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That photo could not be opened.')
    }
  }

  const status = reading
    ? 'Reading the card…'
    : camera === 'live'
      ? photoReading === false
        ? 'Hold the QR code inside the frame.'
        : 'Hold the QR code inside the frame — or, for a printed card, fill the frame with it and press Capture.'
      : camera === 'starting'
        ? 'Starting the camera…'
        : 'The camera is not available here. Upload a photo of the card instead.'

  return createPortal(
    <div className="modal-backdrop card-scan-backdrop" onClick={onClose}>
      <div
        className="modal card-scan"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-scan-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="card-scan-title">Scan business card</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <div className={`card-scan-view${camera === 'unavailable' && !reading ? ' is-empty' : ''}`}>
          {/* Always mounted: unmounting it would detach the stream, and the
              view would come back black after a photo that failed to read. */}
          <video ref={videoRef} className="card-scan-video" playsInline muted hidden={camera !== 'live'} />
          {camera === 'live' && !reading && <div className="card-scan-frame" aria-hidden="true" />}
          {reading && (
            <>
              <img src={reading} alt="The captured card" className="card-scan-still" />
              <div className="card-scan-reading">
                <span className="card-scan-spinner" aria-hidden="true" />
              </div>
            </>
          )}
          {camera === 'unavailable' && !reading && (
            <div className="card-scan-placeholder">
              <CameraIcon size={28} />
            </div>
          )}
        </div>

        <p className="card-scan-status" aria-live="polite">
          {status}
        </p>

        {linkHint && !reading && (
          <p className="card-scan-link">
            The QR code is a link — <strong>{linkHint}</strong> — and will be used as the website.
          </p>
        )}

        {error && <p className="card-scan-error">{error}</p>}

        <div className="card-scan-actions">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={pickFile}
            hidden
          />
          <button
            type="button"
            className={camera === 'live' ? 'btn' : 'btn btn-primary'}
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(reading)}
          >
            Upload photo
          </button>
          {camera === 'live' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={capture}
              disabled={Boolean(reading)}
            >
              <CameraIcon size={15} />
              Capture
            </button>
          )}
        </div>

        <p className="card-scan-note">
          QR codes are read on this device. A photo of a printed card is sent to Claude, Anthropic's AI model,
          to be read — nothing is saved until you press Add.
        </p>
      </div>
    </div>,
    document.body
  )
}

export function CameraIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 8h3l1.6-2.4A1 1 0 0 1 9.4 5h5.2a1 1 0 0 1 .8.6L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}
