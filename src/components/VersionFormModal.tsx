import { useRef, useState, type FormEvent } from 'react'
import { useStoVersions, type RateInput } from '../hooks/useStoVersions'
import { useAuth } from '../hooks/useAuth'
import { VERSION_STATUS_LIST, VERSION_STATUS_META } from '../lib/stoVersion'
import type { StoVersionWithRates, VersionStatus } from '../lib/database.types'
import './ui.css'
import './version-form.css'

/** A rate while it is being edited: the price stays a string until save. */
interface DraftRate {
  key: string
  season: string
  room_type: string
  basis: string
  description: string
  price: string
  currency: string
}

interface Props {
  /** Editing an existing season; omit to publish a new one. */
  version?: StoVersionWithRates
  onClose: () => void
  onSaved: () => void
}

const newKey = () => crypto.randomUUID()

const blankRate = (season = 'All year', currency = 'USD'): DraftRate => ({
  key: newKey(),
  season,
  room_type: '',
  basis: '',
  description: '',
  price: '',
  currency,
})

// A rate sheet is quoted in dollars to operators abroad and in shillings at
// home; anything else can be typed over the top.
const CURRENCIES = ['USD', 'TZS', 'EUR', 'GBP']

const MAX_PDF_BYTES = 10 * 1024 * 1024

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The season's rate sheet: what it is called, what it covers, and what it costs.
 *
 * The rates are typed in as data rather than left inside the PDF, because
 * everything downstream reads them — the document the operator opens, the
 * summary in the list, the description in a report. The PDF is still attached
 * and still sent: it is the file the operators know, and it is uploaded on an
 * existing version because the upload needs a row to hang off.
 */
export default function VersionFormModal({ version, onClose, onSaved }: Props) {
  const { createVersion, updateVersion, uploadPdf, removePdf } = useStoVersions()
  const { profile } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)

  const thisYear = new Date().getFullYear()

  const [name, setName] = useState(version?.name ?? `Zondela House STO Rates ${thisYear + 1}`)
  const [year, setYear] = useState(String(version?.year ?? thisYear + 1))
  const [status, setStatus] = useState<VersionStatus>(version?.status ?? 'draft')
  const [validFrom, setValidFrom] = useState(version?.valid_from ?? `${thisYear + 1}-01-01`)
  const [validTo, setValidTo] = useState(version?.valid_to ?? `${thisYear + 1}-12-31`)
  const [summary, setSummary] = useState(version?.summary ?? '')
  const [intro, setIntro] = useState(version?.intro ?? '')
  const [terms, setTerms] = useState(version?.terms ?? '')
  const [rates, setRates] = useState<DraftRate[]>(
    version && version.rates.length > 0
      ? version.rates.map((r) => ({
          key: r.id,
          season: r.season,
          room_type: r.room_type,
          basis: r.basis ?? '',
          description: r.description ?? '',
          price: String(r.price),
          currency: r.currency,
        }))
      : [blankRate()]
  )

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  function updateRate(key: string, patch: Partial<DraftRate>) {
    setRates((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  /** A new line inherits the season and currency above it — a sheet is entered in blocks. */
  function addRate() {
    const last = rates[rates.length - 1]
    setRates((prev) => [...prev, blankRate(last?.season ?? 'All year', last?.currency ?? 'USD')])
  }

  async function handleFile(file: File | undefined) {
    if (!file || !version) return
    setError(null)
    if (file.type !== 'application/pdf') {
      setError('That is not a PDF. Only a PDF rate sheet can be attached.')
      return
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(`That file is ${formatSize(file.size)}. The limit is ${formatSize(MAX_PDF_BYTES)}.`)
      return
    }
    setUploading(true)
    try {
      await uploadPdf(version, file)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Give the rate sheet a name — it is what the team and the operator both see.')
      return
    }
    const parsedYear = parseInt(year, 10)
    if (!parsedYear || parsedYear < 2000 || parsedYear > 2100) {
      setError('Enter the season as a four-digit year.')
      return
    }

    // Blank lines are scaffolding, not content: a row with no room type on it
    // was never filled in, and saving it would print an empty row.
    const cleaned: RateInput[] = rates
      .filter((r) => r.room_type.trim())
      .map((r) => ({
        season: r.season.trim() || 'All year',
        room_type: r.room_type.trim(),
        basis: r.basis.trim() || null,
        description: r.description.trim() || null,
        price: parseFloat(r.price) || 0,
        currency: r.currency.trim().toUpperCase() || 'USD',
      }))

    if (cleaned.length === 0) {
      setError('Add at least one room type and rate — that is what the operator is being sent.')
      return
    }
    if (status === 'active' && cleaned.some((r) => r.price <= 0)) {
      setError('Every room type needs a rate before this sheet goes out. Save it as a draft instead.')
      return
    }

    const payload = {
      name: name.trim(),
      year: parsedYear,
      status,
      valid_from: validFrom || null,
      valid_to: validTo || null,
      summary: summary.trim() || null,
      intro: intro.trim() || null,
      terms: terms.trim() || null,
    }

    setSaving(true)
    try {
      if (version) await updateVersion(version.id, payload, cleaned)
      else await createVersion({ ...payload, created_by: profile?.id ?? null }, cleaned)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this rate sheet.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal version-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{version ? `Edit ${version.name}` : 'New rate sheet'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="v_name">Name</label>
            <input
              id="v_name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Zondela House STO Rates ${thisYear + 1}`}
            />
            <p className="field-hint">What the team and the operator both call this sheet.</p>
          </div>

          <div className="version-row">
            <div className="field">
              <label htmlFor="v_year">Season</label>
              <input
                id="v_year"
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="v_from">Valid from</label>
              <input
                id="v_from"
                type="date"
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="v_to">Valid to</label>
              <input id="v_to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="v_status">Status</label>
              <select
                id="v_status"
                value={status}
                onChange={(e) => setStatus(e.target.value as VersionStatus)}
              >
                {VERSION_STATUS_LIST.map((s) => (
                  <option key={s} value={s}>
                    {VERSION_STATUS_META[s].label}
                  </option>
                ))}
              </select>
              <p className="field-hint">{VERSION_STATUS_META[status].hint}</p>
            </div>
          </div>

          <div className="field">
            <label htmlFor="v_summary">Summary</label>
            <input
              id="v_summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Contracted STO rates for the 2027 season, valid for all tour operators."
            />
            <p className="field-hint">One line. Read in the list, in reports, and under the title.</p>
          </div>

          <div className="version-rates">
            <div className="version-rates-head">
              <div>
                <label>Rates</label>
                <p className="field-hint">
                  One line per room type per season. This is what the operator reads, and what the
                  reports describe.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={addRate}>
                + Add room type
              </button>
            </div>

            <ul className="version-rate-list">
              {rates.map((rate) => (
                <li key={rate.key} className="version-rate">
                  <div className="version-rate-main">
                    <input
                      aria-label="Season"
                      value={rate.season}
                      onChange={(e) => updateRate(rate.key, { season: e.target.value })}
                      placeholder="Season"
                    />
                    <input
                      aria-label="Room type"
                      value={rate.room_type}
                      onChange={(e) => updateRate(rate.key, { room_type: e.target.value })}
                      placeholder="Room type"
                    />
                    <input
                      aria-label="Basis"
                      value={rate.basis}
                      onChange={(e) => updateRate(rate.key, { basis: e.target.value })}
                      placeholder="Per person sharing, B&B"
                    />
                    <input
                      aria-label="Rate"
                      type="number"
                      min="0"
                      step="1"
                      value={rate.price}
                      onChange={(e) => updateRate(rate.key, { price: e.target.value })}
                      placeholder="Rate"
                    />
                    <select
                      aria-label="Currency"
                      value={rate.currency}
                      onChange={(e) => updateRate(rate.key, { currency: e.target.value })}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Remove ${rate.room_type || 'rate'}`}
                      onClick={() =>
                        setRates((prev) => {
                          const next = prev.filter((r) => r.key !== rate.key)
                          // The editor always shows something to type into.
                          return next.length > 0 ? next : [blankRate()]
                        })
                      }
                    >
                      ×
                    </button>
                  </div>
                  <input
                    className="version-rate-desc"
                    aria-label="Description"
                    value={rate.description}
                    onChange={(e) => updateRate(rate.key, { description: e.target.value })}
                    placeholder="What is included — printed under the room type"
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="field">
            <label htmlFor="v_intro">Introduction</label>
            <textarea
              id="v_intro"
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={3}
              placeholder="What the operator reads above the rates."
            />
          </div>

          <div className="field">
            <label htmlFor="v_terms">Terms and conditions</label>
            <textarea
              id="v_terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={4}
              placeholder="Payment terms, child policy, cancellation, validity…"
            />
          </div>

          <div className="field">
            <label>Signed rate sheet (PDF)</label>
            {version ? (
              <>
                <div className="version-pdf">
                  <input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={uploading}
                    onChange={(e) => handleFile(e.target.files?.[0])}
                  />
                  {version.pdf_path && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => removePdf(version).then(onSaved)}
                    >
                      Remove {version.pdf_name}
                    </button>
                  )}
                </div>
                <p className="field-hint">
                  {uploading
                    ? 'Uploading…'
                    : version.pdf_path
                      ? `Attached: ${version.pdf_name} (${formatSize(version.pdf_size_bytes)}). Operators can download it from the agreement page.`
                      : 'Optional. The CRM renders its own sheet from the rates above; attach the PDF if operators expect the file they know.'}
                </p>
              </>
            ) : (
              <p className="field-hint">
                Save this sheet first, then reopen it to attach the PDF — the file needs somewhere to
                live.
              </p>
            )}
          </div>

          {error && <p className="version-error">{error}</p>}

          <div className="version-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : version ? 'Save changes' : 'Create rate sheet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
