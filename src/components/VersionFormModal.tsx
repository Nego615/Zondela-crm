import { useRef, useState, type FormEvent } from 'react'
import {
  useStoVersions,
  type RateInput,
  type SectionInput,
  type SupplementInput,
} from '../hooks/useStoVersions'
import { useAuth } from '../hooks/useAuth'
import { VERSION_STATUS_LIST, VERSION_STATUS_META } from '../lib/stoVersion'
import type { StoVersionWithRates, VersionStatus } from '../lib/database.types'
import './ui.css'
import './version-form.css'

/** A rate while it is being edited: the prices stay strings until save. */
interface DraftRate {
  key: string
  season: string
  room_type: string
  description: string
  bb: string
  hb: string
  fb: string
  occupancy: string
  currency: string
}

interface DraftSupplement {
  key: string
  name: string
  price: string
  currency: string
  unit: string
}

interface DraftSection {
  key: string
  title: string
  body: string
}

interface Props {
  /** Editing an existing season; omit to publish a new one. */
  version?: StoVersionWithRates
  onClose: () => void
  onSaved: () => void
}

const newKey = () => crypto.randomUUID()

const blankRate = (season = '', currency = 'USD'): DraftRate => ({
  key: newKey(),
  season,
  room_type: '',
  description: '',
  bb: '',
  hb: '',
  fb: '',
  occupancy: '2',
  currency,
})

const blankSupplement = (currency = 'USD'): DraftSupplement => ({
  key: newKey(),
  name: '',
  price: '',
  currency,
  unit: 'per person',
})

const blankSection = (): DraftSection => ({ key: newKey(), title: '', body: '' })

// The contract is quoted in dollars to operators abroad and in shillings at
// home; anything else can be typed over the top.
const CURRENCIES = ['USD', 'TZS', 'EUR', 'GBP']

/** The policies every rate contract carries, offered rather than retyped. */
const SECTION_SUGGESTIONS = [
  'Children’s Policy',
  'Tour Leader Policy',
  'Check-In / Check-Out',
  'Deposit Policy',
  'Cancellation Policy',
  'No-Show Policy',
]

const MAX_PDF_BYTES = 10 * 1024 * 1024

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The season's rate contract: what it is called, what it costs, and what it says.
 *
 * Laid out in the order the signed document reads — overview, the rates chart,
 * supplements, then the policies — because the person filling this in is
 * copying from that document, and a form that runs in a different order than
 * the paper is a form that gets a field skipped.
 *
 * The rates are typed in as data rather than left inside the PDF, because
 * everything downstream reads them: the document the operator opens, the tag
 * on the card, the description in a report. The PDF is still attached and still
 * sent; it is uploaded on an existing version because the file needs a row to
 * hang off.
 */
export default function VersionFormModal({ version, onClose, onSaved }: Props) {
  const { createVersion, updateVersion, uploadPdf, removePdf } = useStoVersions()
  const { profile } = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)

  const thisYear = new Date().getFullYear()
  const season = version?.year ?? thisYear + 1

  const [name, setName] = useState(version?.name ?? `Zondela House STO Rate Contract ${season}`)
  const [year, setYear] = useState(String(season))
  const [status, setStatus] = useState<VersionStatus>(version?.status ?? 'draft')
  const [validFrom, setValidFrom] = useState(version?.valid_from ?? `${season}-01-01`)
  const [validTo, setValidTo] = useState(version?.valid_to ?? `${season}-12-31`)
  const [summary, setSummary] = useState(version?.summary ?? '')
  const [intro, setIntro] = useState(version?.intro ?? '')
  const [rateBasis, setRateBasis] = useState(version?.rate_basis ?? 'Per room, per night')
  const [ratesNote, setRatesNote] = useState(
    version?.rates_note ?? 'All rates quoted are inclusive of VAT and Tourism development levy.'
  )
  const [terms, setTerms] = useState(version?.terms ?? '')

  const [rates, setRates] = useState<DraftRate[]>(
    version && version.rates.length > 0
      ? version.rates.map((r) => ({
          key: r.id,
          season: r.season === 'All year' ? '' : r.season,
          room_type: r.room_type,
          description: r.description ?? '',
          bb: String(r.bb_price),
          hb: String(r.hb_price),
          fb: String(r.fb_price),
          occupancy: String(r.max_occupancy),
          currency: r.currency,
        }))
      : [blankRate()]
  )

  const [supplements, setSupplements] = useState<DraftSupplement[]>(
    version && version.supplements.length > 0
      ? version.supplements.map((s) => ({
          key: s.id,
          name: s.name,
          price: String(s.price),
          currency: s.currency,
          unit: s.unit,
        }))
      : []
  )

  const [sections, setSections] = useState<DraftSection[]>(
    version && version.sections.length > 0
      ? version.sections.map((s) => ({ key: s.id, title: s.title, body: s.body }))
      : []
  )

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  function updateRate(key: string, patch: Partial<DraftRate>) {
    setRates((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  /** A new line inherits the season and currency above it — a chart is entered in blocks. */
  function addRate() {
    const last = rates[rates.length - 1]
    setRates((prev) => [...prev, blankRate(last?.season ?? '', last?.currency ?? 'USD')])
  }

  async function handleFile(file: File | undefined) {
    if (!file || !version) return
    setError(null)
    if (file.type !== 'application/pdf') {
      setError('That is not a PDF. Only a PDF contract can be attached.')
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
      setError('Give the contract a name — it is what the team and the operator both see.')
      return
    }
    const parsedYear = parseInt(year, 10)
    if (!parsedYear || parsedYear < 2000 || parsedYear > 2100) {
      setError('Enter the season as a four-digit year.')
      return
    }

    // Blank lines are scaffolding, not content: a row with no room type on it
    // was never filled in, and saving it would print an empty row.
    const cleanRates: RateInput[] = rates
      .filter((r) => r.room_type.trim())
      .map((r) => ({
        season: r.season.trim() || 'All year',
        room_type: r.room_type.trim(),
        description: r.description.trim() || null,
        bb_price: parseFloat(r.bb) || 0,
        hb_price: parseFloat(r.hb) || 0,
        fb_price: parseFloat(r.fb) || 0,
        max_occupancy: parseInt(r.occupancy, 10) || 1,
        currency: r.currency.trim().toUpperCase() || 'USD',
      }))

    if (cleanRates.length === 0) {
      setError('Add at least one room type and rate — that is what the operator is being sent.')
      return
    }
    if (status === 'active' && cleanRates.some((r) => r.bb_price <= 0)) {
      setError(
        'Every room type needs at least a bed & breakfast rate before this goes out. Save it as a draft instead.'
      )
      return
    }

    const cleanSupplements: SupplementInput[] = supplements
      .filter((s) => s.name.trim())
      .map((s) => ({
        name: s.name.trim(),
        description: null,
        price: parseFloat(s.price) || 0,
        currency: s.currency.trim().toUpperCase() || 'USD',
        unit: s.unit.trim() || 'per person',
      }))

    const cleanSections: SectionInput[] = sections
      .filter((s) => s.title.trim())
      .map((s) => ({ title: s.title.trim(), body: s.body.trim() }))

    const payload = {
      name: name.trim(),
      year: parsedYear,
      status,
      valid_from: validFrom || null,
      valid_to: validTo || null,
      summary: summary.trim() || null,
      intro: intro.trim() || null,
      rate_basis: rateBasis.trim() || null,
      rates_note: ratesNote.trim() || null,
      terms: terms.trim() || null,
    }

    const body = { rates: cleanRates, supplements: cleanSupplements, sections: cleanSections }

    setSaving(true)
    try {
      if (version) await updateVersion(version.id, payload, body)
      else await createVersion({ ...payload, created_by: profile?.id ?? null }, body)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this contract.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal version-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{version ? `Edit ${version.name}` : 'New rate contract'}</h2>
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
              placeholder={`Zondela House STO Rate Contract ${season}`}
            />
            <p className="field-hint">What the team and the operator both call this contract.</p>
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
              placeholder="Standard tour operator rates for Zondela House, 1 January to 31 December 2026."
            />
            <p className="field-hint">One line. Read in the list, in reports, and under the title.</p>
          </div>

          <div className="field">
            <label htmlFor="v_intro">Overview</label>
            <textarea
              id="v_intro"
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={4}
              placeholder="The property, in the words the contract opens with."
            />
          </div>

          <div className="version-rates">
            <div className="version-rates-head">
              <div>
                <label>Accommodation rates</label>
                <p className="field-hint">
                  One line per room type: bed &amp; breakfast, half board and full board, and how
                  many people it sleeps. Leave the season blank unless the contract prices more than
                  one.
                </p>
              </div>
              <button type="button" className="btn btn-sm" onClick={addRate}>
                + Add room type
              </button>
            </div>

            <div className="version-rate-headings" aria-hidden="true">
              <span>Season</span>
              <span>Room type</span>
              <span>STO BB</span>
              <span>STO HB</span>
              <span>STO FB</span>
              <span>Sleeps</span>
              <span>Cur.</span>
              <span />
            </div>

            <ul className="version-rate-list">
              {rates.map((rate) => (
                <li key={rate.key} className="version-rate">
                  <div className="version-rate-main">
                    <input
                      aria-label="Season"
                      value={rate.season}
                      onChange={(e) => updateRate(rate.key, { season: e.target.value })}
                      placeholder="All year"
                    />
                    <input
                      aria-label="Room type"
                      value={rate.room_type}
                      onChange={(e) => updateRate(rate.key, { room_type: e.target.value })}
                      placeholder="Standard Double"
                    />
                    <input
                      aria-label="Bed and breakfast rate"
                      type="number"
                      min="0"
                      step="1"
                      value={rate.bb}
                      onChange={(e) => updateRate(rate.key, { bb: e.target.value })}
                      placeholder="BB"
                    />
                    <input
                      aria-label="Half board rate"
                      type="number"
                      min="0"
                      step="1"
                      value={rate.hb}
                      onChange={(e) => updateRate(rate.key, { hb: e.target.value })}
                      placeholder="HB"
                    />
                    <input
                      aria-label="Full board rate"
                      type="number"
                      min="0"
                      step="1"
                      value={rate.fb}
                      onChange={(e) => updateRate(rate.key, { fb: e.target.value })}
                      placeholder="FB"
                    />
                    <input
                      aria-label="Maximum occupancy"
                      type="number"
                      min="1"
                      max="12"
                      value={rate.occupancy}
                      onChange={(e) => updateRate(rate.key, { occupancy: e.target.value })}
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
                    aria-label="What is included"
                    value={rate.description}
                    onChange={(e) => updateRate(rate.key, { description: e.target.value })}
                    placeholder="What is included — printed under the room type"
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="version-row version-row-pair">
            <div className="field">
              <label htmlFor="v_basis">How the rates are read</label>
              <input
                id="v_basis"
                value={rateBasis}
                onChange={(e) => setRateBasis(e.target.value)}
                placeholder="Per room, per night"
              />
            </div>
            <div className="field">
              <label htmlFor="v_note">Note under the chart</label>
              <input
                id="v_note"
                value={ratesNote}
                onChange={(e) => setRatesNote(e.target.value)}
                placeholder="All rates quoted are inclusive of VAT and Tourism development levy."
              />
            </div>
          </div>

          <div className="version-rates">
            <div className="version-rates-head">
              <div>
                <label>Supplements</label>
                <p className="field-hint">
                  Priced per person alongside the room — lunch, dinner, anything extra.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  setSupplements((prev) => [
                    ...prev,
                    blankSupplement(prev[prev.length - 1]?.currency ?? rates[0]?.currency ?? 'USD'),
                  ])
                }
              >
                + Add supplement
              </button>
            </div>

            {supplements.length === 0 ? (
              <p className="field-hint">None on this contract.</p>
            ) : (
              <ul className="version-rate-list">
                {supplements.map((item) => (
                  <li key={item.key} className="version-rate">
                    <div className="version-supp-main">
                      <input
                        aria-label="Supplement"
                        value={item.name}
                        onChange={(e) =>
                          setSupplements((prev) =>
                            prev.map((s) => (s.key === item.key ? { ...s, name: e.target.value } : s))
                          )
                        }
                        placeholder="Lunch"
                      />
                      <input
                        aria-label="Price"
                        type="number"
                        min="0"
                        step="1"
                        value={item.price}
                        onChange={(e) =>
                          setSupplements((prev) =>
                            prev.map((s) => (s.key === item.key ? { ...s, price: e.target.value } : s))
                          )
                        }
                        placeholder="20"
                      />
                      <select
                        aria-label="Currency"
                        value={item.currency}
                        onChange={(e) =>
                          setSupplements((prev) =>
                            prev.map((s) =>
                              s.key === item.key ? { ...s, currency: e.target.value } : s
                            )
                          )
                        }
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Unit"
                        value={item.unit}
                        onChange={(e) =>
                          setSupplements((prev) =>
                            prev.map((s) => (s.key === item.key ? { ...s, unit: e.target.value } : s))
                          )
                        }
                        placeholder="per person"
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Remove ${item.name || 'supplement'}`}
                        onClick={() =>
                          setSupplements((prev) => prev.filter((s) => s.key !== item.key))
                        }
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="version-rates">
            <div className="version-rates-head">
              <div>
                <label>Policies</label>
                <p className="field-hint">
                  The numbered sections of the contract. Lines starting with • or - print as
                  bullets; blank lines separate paragraphs.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setSections((prev) => [...prev, blankSection()])}
              >
                + Add policy
              </button>
            </div>

            {sections.length === 0 && (
              <div className="version-suggestions">
                <span>Start from the usual ones:</span>
                {SECTION_SUGGESTIONS.map((title) => (
                  <button
                    key={title}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSections((prev) => [...prev, { ...blankSection(), title }])}
                  >
                    + {title}
                  </button>
                ))}
              </div>
            )}

            <ul className="version-rate-list">
              {sections.map((section, index) => (
                <li key={section.key} className="version-rate version-section">
                  <div className="version-section-head">
                    <span className="version-section-num">{index + 1}</span>
                    <input
                      aria-label="Policy title"
                      value={section.title}
                      onChange={(e) =>
                        setSections((prev) =>
                          prev.map((s) => (s.key === section.key ? { ...s, title: e.target.value } : s))
                        )
                      }
                      placeholder="Cancellation Policy"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Move ${section.title || 'policy'} up`}
                      disabled={index === 0}
                      onClick={() =>
                        setSections((prev) => {
                          const next = [...prev]
                          ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                          return next
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Remove ${section.title || 'policy'}`}
                      onClick={() => setSections((prev) => prev.filter((s) => s.key !== section.key))}
                    >
                      ×
                    </button>
                  </div>
                  <textarea
                    aria-label={`${section.title || 'Policy'} text`}
                    rows={4}
                    value={section.body}
                    onChange={(e) =>
                      setSections((prev) =>
                        prev.map((s) => (s.key === section.key ? { ...s, body: e.target.value } : s))
                      )
                    }
                    placeholder={'• Cancellations made 45 days or more prior to arrival: 0% penalty.'}
                  />
                </li>
              ))}
            </ul>
          </div>

          <div className="field">
            <label htmlFor="v_terms">Anything else</label>
            <textarea
              id="v_terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              rows={3}
              placeholder="Printed after the policies, if there is anything that does not belong in one."
            />
          </div>

          <div className="field">
            <label>Signed contract (PDF)</label>
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
                      : 'Optional. The CRM renders the contract from what is above; attach the PDF as well if operators expect the file they know.'}
                </p>
              </>
            ) : (
              <p className="field-hint">
                Save this contract first, then reopen it to attach the PDF — the file needs
                somewhere to live.
              </p>
            )}
          </div>

          {error && <p className="version-error">{error}</p>}

          <div className="version-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : version ? 'Save changes' : 'Create rate contract'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
