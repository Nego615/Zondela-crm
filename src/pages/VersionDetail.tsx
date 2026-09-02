import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  useStoVersions,
  stoPdfUrl,
  type RateInput,
  type SupplementInput,
  type TermInput,
} from '../hooks/useStoVersions'
import {
  MEAL_PLANS,
  VERSION_STATUS_LIST,
  VERSION_STATUS_META,
  formatDay,
  scopeLabel,
} from '../lib/stoVersion'
import { downloadCsv, toCsv } from '../lib/reports'
import type {
  StoPropertySectionWithImages,
  StoVersionWithRates,
  VersionStatus,
} from '../lib/database.types'
import VersionPreviewModal from '../components/VersionPreviewModal'
import '../components/ui.css'
import './version-detail.css'

/**
 * One season's rate contract, in the five parts it is actually made of.
 *
 * A page rather than a modal: a contract is a document — room categories with
 * photographs, a rate table per season, a dozen named clauses — and none of
 * that fits in a dialogue you scroll. Each tab saves on its own, so a long
 * afternoon of edits is never one unsaved form.
 */
type Tab = 'overview' | 'sections' | 'rates' | 'terms' | 'pdf'

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'sections', label: 'Property Sections' },
  { value: 'rates', label: 'Rate Tables' },
  { value: 'terms', label: 'Terms & Conditions' },
  { value: 'pdf', label: 'Official PDF' },
]

const CURRENCIES = ['USD', 'TZS', 'EUR', 'GBP']

/** What a rate contract in this trade carries, offered rather than retyped. */
const STANDARD_CLAUSES = [
  'Meal Plan',
  'Children Policy',
  'Extras',
  'Tour Leader Policy',
  'Volume Discount',
  'Booking Confirmation & Payment',
  'Cancellation Policy',
  'Payment Method',
  'Credit Facilities',
  'Disputes',
  'Change of Rates',
  'Confidentiality',
]

/** Three photographs per category: enough to show the room, the view and the space. */
const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PDF_BYTES = 10 * 1024 * 1024

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} kB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`

interface DraftRate {
  key: string
  section_id: string
  season: string
  room_type: string
  description: string
  pax: string
  bb: string
  bbRack: string
  hb: string
  hbRack: string
  fb: string
  fbRack: string
  currency: string
}

const newKey = () => crypto.randomUUID()

const blankRate = (sectionId: string, season: string, currency: string): DraftRate => ({
  key: newKey(),
  section_id: sectionId,
  season,
  room_type: '',
  description: '',
  pax: '2',
  bb: '',
  bbRack: '',
  hb: '',
  hbRack: '',
  fb: '',
  fbRack: '',
  currency,
})

export default function VersionDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const {
    versions,
    loading,
    error,
    refresh,
    updateVersion,
    deleteVersion,
    uploadPdf,
    removePdf,
    addSection,
    updateSection,
    deleteSection,
    addSectionImage,
    updateSectionImage,
    deleteSectionImage,
  } = useStoVersions()

  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: Tab = TABS.some((t) => t.value === tabParam) ? (tabParam as Tab) : 'overview'
  const setTab = (value: Tab) => {
    const next = new URLSearchParams(params)
    if (value === 'overview') next.delete('tab')
    else next.set('tab', value)
    setParams(next, { replace: true })
  }

  const version = versions.find((v) => v.id === id)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  async function guard(action: () => Promise<void>, message: string, note = 'Saved.') {
    setBusy(true)
    setProblem(null)
    try {
      await action()
      setSaved(note)
      setTimeout(() => setSaved(null), 2200)
    } catch (err) {
      setProblem(err instanceof Error ? err.message : message)
    } finally {
      setBusy(false)
    }
  }

  if (loading && !version) return <p className="vd-loading">Loading contract…</p>

  if (!version) {
    return (
      <div className="empty-state card">
        <h3>That contract is not here</h3>
        <p>It may have been deleted. </p>
        <Link className="btn" to="/sto">
          Back to versions
        </Link>
      </div>
    )
  }

  const meta = VERSION_STATUS_META[version.status]

  return (
    <div className="vd">
      <button className="vd-back" onClick={() => navigate('/sto')}>
        ← Back to versions
      </button>

      <div className="vd-head">
        <div className="vd-title">
          <h1>{version.name}</h1>
          <span className="badge" style={{ background: meta.bg, color: meta.color }}>
            {meta.label}
          </span>
          <span className="badge vd-year">{version.year}</span>
          <span className="vd-scope">{scopeLabel(version.rates)}</span>
        </div>
        <div className="vd-actions">
          <button className="btn btn-sm" onClick={() => setPreview(true)}>
            Preview
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              guard(
                async () => {
                  if (
                    confirm(
                      `Delete ${version.name}? Everything sent from it goes too. This cannot be undone.`
                    )
                  ) {
                    await deleteVersion(version)
                    navigate('/sto')
                  }
                },
                'Could not delete that contract.',
                'Deleted.'
              )
            }
          >
            Delete
          </button>
        </div>
      </div>
      <p className="vd-validity">
        Valid {formatDay(version.valid_from)} → {formatDay(version.valid_to)}
      </p>

      <div className="vd-tabs" role="tablist" aria-label="Contract sections">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={tab === t.value}
            className={`vd-tab${tab === t.value ? ' active' : ''}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(error || problem) && <p className="vd-error">{error || problem}</p>}
      {saved && <p className="vd-saved">{saved}</p>}

      {tab === 'overview' ? (
        <OverviewTab version={version} busy={busy} onSave={guard} save={updateVersion} />
      ) : tab === 'sections' ? (
        <SectionsTab
          version={version}
          busy={busy}
          onSave={guard}
          add={addSection}
          update={updateSection}
          remove={deleteSection}
          addImage={addSectionImage}
          updateImage={updateSectionImage}
          removeImage={deleteSectionImage}
        />
      ) : tab === 'rates' ? (
        <RatesTab version={version} busy={busy} onSave={guard} save={updateVersion} />
      ) : tab === 'terms' ? (
        <TermsTab version={version} busy={busy} onSave={guard} save={updateVersion} />
      ) : (
        <PdfTab
          version={version}
          busy={busy}
          onSave={guard}
          upload={uploadPdf}
          remove={removePdf}
          refresh={refresh}
        />
      )}

      {preview && <VersionPreviewModal version={version} onClose={() => setPreview(false)} />}
    </div>
  )
}

type Guard = (action: () => Promise<void>, message: string, note?: string) => Promise<void>
type SaveVersion = (
  id: string,
  input: Partial<StoVersionWithRates>,
  body?: { rates: RateInput[]; supplements: SupplementInput[]; terms: TermInput[] }
) => Promise<void>

/** Everything under the header that this tab is not editing, passed through untouched. */
function bodyFrom(
  version: StoVersionWithRates,
  overrides: Partial<{ rates: RateInput[]; supplements: SupplementInput[]; terms: TermInput[] }>
) {
  return {
    rates:
      overrides.rates ??
      version.rates.map((r) => ({
        section_id: r.section_id,
        season: r.season,
        room_type: r.room_type,
        description: r.description,
        pax: r.pax,
        bb_price: r.bb_price,
        hb_price: r.hb_price,
        fb_price: r.fb_price,
        bb_rack: r.bb_rack,
        hb_rack: r.hb_rack,
        fb_rack: r.fb_rack,
        max_occupancy: r.max_occupancy,
        currency: r.currency,
      })),
    supplements:
      overrides.supplements ??
      version.supplements.map((s) => ({
        name: s.name,
        description: s.description,
        price: s.price,
        currency: s.currency,
        unit: s.unit,
      })),
    terms:
      overrides.terms ??
      version.terms_list.map((t) => ({ title: t.title, body: t.body })),
  }
}

/* ===========================================================================
   Overview
   =========================================================================== */
function OverviewTab({
  version,
  busy,
  onSave,
  save,
}: {
  version: StoVersionWithRates
  busy: boolean
  onSave: Guard
  save: SaveVersion
}) {
  const [draft, setDraft] = useState({
    name: version.name,
    year: String(version.year),
    status: version.status,
    valid_from: version.valid_from ?? '',
    valid_to: version.valid_to ?? '',
    summary: version.summary ?? '',
    intro: version.intro ?? '',
    rate_basis: version.rate_basis ?? '',
    rates_note: version.rates_note ?? '',
    internal_notes: version.internal_notes ?? '',
  })

  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  return (
    <section className="card vd-card">
      <div className="vd-grid">
        <label className="field">
          <span>Title</span>
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>Year</span>
          <input
            type="number"
            min="2000"
            max="2100"
            value={draft.year}
            onChange={(e) => set('year', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select
            value={draft.status}
            onChange={(e) => set('status', e.target.value as VersionStatus)}
          >
            {VERSION_STATUS_LIST.map((s) => (
              <option key={s} value={s}>
                {VERSION_STATUS_META[s].label}
              </option>
            ))}
          </select>
          <p className="field-hint">{VERSION_STATUS_META[draft.status].hint}</p>
        </label>
        <label className="field">
          <span>Quoted</span>
          <input
            value={draft.rate_basis}
            onChange={(e) => set('rate_basis', e.target.value)}
            placeholder="Per room, per night"
          />
        </label>
        <label className="field">
          <span>Valid from</span>
          <input
            type="date"
            value={draft.valid_from}
            onChange={(e) => set('valid_from', e.target.value)}
          />
        </label>
        <label className="field">
          <span>Valid to</span>
          <input
            type="date"
            value={draft.valid_to}
            onChange={(e) => set('valid_to', e.target.value)}
          />
        </label>
      </div>

      <label className="field">
        <span>Summary</span>
        <input
          value={draft.summary}
          onChange={(e) => set('summary', e.target.value)}
          placeholder="Standard tour operator rates, 1 January to 31 December."
        />
        <p className="field-hint">One line. Read in the list, in reports, and under the title.</p>
      </label>

      <label className="field">
        <span>Overview</span>
        <textarea
          rows={4}
          value={draft.intro}
          onChange={(e) => set('intro', e.target.value)}
          placeholder="The property, in the words the contract opens with."
        />
      </label>

      <label className="field">
        <span>Note under the rate chart</span>
        <input
          value={draft.rates_note}
          onChange={(e) => set('rates_note', e.target.value)}
          placeholder="All rates quoted are inclusive of VAT and Tourism development levy."
        />
      </label>

      <label className="field">
        <span>Internal notes</span>
        <textarea
          rows={3}
          value={draft.internal_notes}
          onChange={(e) => set('internal_notes', e.target.value)}
          placeholder="Never printed and never sent — what an operator pushed back on, why a rate moved."
        />
      </label>

      <p className="vd-stamp">
        Created {new Date(version.created_at).toLocaleString()} · Last updated{' '}
        {new Date(version.updated_at).toLocaleString()}
      </p>

      <div className="vd-save">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            onSave(async () => {
              const year = parseInt(draft.year, 10)
              if (!draft.name.trim()) throw new Error('The contract needs a title.')
              if (!year || year < 2000 || year > 2100)
                throw new Error('Enter the season as a four-digit year.')
              await save(version.id, {
                name: draft.name.trim(),
                year,
                status: draft.status,
                valid_from: draft.valid_from || null,
                valid_to: draft.valid_to || null,
                summary: draft.summary.trim() || null,
                intro: draft.intro.trim() || null,
                rate_basis: draft.rate_basis.trim() || null,
                rates_note: draft.rates_note.trim() || null,
                internal_notes: draft.internal_notes.trim() || null,
              })
            }, 'Could not save the overview.')
          }
        >
          {busy ? 'Saving…' : 'Save overview'}
        </button>
      </div>
    </section>
  )
}

/* ===========================================================================
   Property sections — the room categories, each with its own photographs
   =========================================================================== */
function SectionsTab({
  version,
  busy,
  onSave,
  add,
  update,
  remove,
  addImage,
  updateImage,
  removeImage,
}: {
  version: StoVersionWithRates
  busy: boolean
  onSave: Guard
  add: (versionId: string, input: Record<string, unknown>) => Promise<unknown>
  update: (id: string, input: Record<string, unknown>) => Promise<void>
  remove: (section: StoPropertySectionWithImages) => Promise<void>
  addImage: (sectionId: string, file: File, caption: string, sortOrder: number) => Promise<void>
  updateImage: (id: string, caption: string) => Promise<void>
  removeImage: (image: StoPropertySectionWithImages['images'][number]) => Promise<void>
}) {
  return (
    <>
      {version.sections.length === 0 && (
        <div className="empty-state card">
          <h3>No room categories yet</h3>
          <p>
            A contract is set out category by category — Standard rooms read, and photograph,
            differently from Deluxe. Add one for each, then price its rooms on the Rate Tables tab.
          </p>
        </div>
      )}

      {version.sections.map((section) => (
        <SectionCard
          key={section.id}
          section={section}
          busy={busy}
          onSave={onSave}
          update={update}
          remove={remove}
          addImage={addImage}
          updateImage={updateImage}
          removeImage={removeImage}
        />
      ))}

      <div className="vd-add-row">
        {['Standard Rooms', 'Deluxe Rooms'].map((name) =>
          version.sections.some((s) => s.name.toLowerCase() === name.toLowerCase()) ? null : (
            <button
              key={name}
              className="btn btn-sm"
              disabled={busy}
              onClick={() =>
                onSave(
                  async () => {
                    await add(version.id, { name, sort_order: version.sections.length })
                  },
                  'Could not add that category.',
                  `${name} added.`
                )
              }
            >
              + {name}
            </button>
          )
        )}
        <button
          className="btn btn-sm"
          disabled={busy}
          onClick={() =>
            onSave(
              async () => {
                const name = prompt('What is this category called?')?.trim()
                if (!name) return
                await add(version.id, { name, sort_order: version.sections.length })
              },
              'Could not add that category.',
              'Category added.'
            )
          }
        >
          + Another category
        </button>
      </div>
    </>
  )
}

function SectionCard({
  section,
  busy,
  onSave,
  update,
  remove,
  addImage,
  updateImage,
  removeImage,
}: {
  section: StoPropertySectionWithImages
  busy: boolean
  onSave: Guard
  update: (id: string, input: Record<string, unknown>) => Promise<void>
  remove: (section: StoPropertySectionWithImages) => Promise<void>
  addImage: (sectionId: string, file: File, caption: string, sortOrder: number) => Promise<void>
  updateImage: (id: string, caption: string) => Promise<void>
  removeImage: (image: StoPropertySectionWithImages['images'][number]) => Promise<void>
}) {
  const [draft, setDraft] = useState({
    name: section.name,
    description: section.description ?? '',
    gallery_url: section.gallery_url ?? '',
    meal_plan_notes: section.meal_plan_notes ?? '',
    seasonal_notes: section.seasonal_notes ?? '',
    internal_notes: section.internal_notes ?? '',
  })
  const [captions, setCaptions] = useState<Record<string, string>>(
    Object.fromEntries(section.images.map((im) => [im.id, im.caption ?? '']))
  )
  const fileInput = useRef<HTMLInputElement>(null)

  // The card is a form over a row that its own saves replace; when the row
  // comes back with new photographs, the captions have to follow it.
  useEffect(() => {
    setCaptions((prev) => {
      const next = { ...prev }
      for (const im of section.images) if (!(im.id in next)) next[im.id] = im.caption ?? ''
      return next
    })
  }, [section.images])

  const set = <K extends keyof typeof draft>(key: K, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }))

  return (
    <section className="card vd-card">
      <div className="vd-card-head">
        <h2>{section.name}</h2>
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() =>
            onSave(
              async () => {
                if (confirm(`Remove ${section.name} and its photographs?`)) await remove(section)
              },
              'Could not remove that category.',
              'Removed.'
            )
          }
        >
          Remove
        </button>
      </div>

      <label className="field">
        <span>Name</span>
        <input value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </label>

      <label className="field">
        <span>Description</span>
        <textarea
          rows={4}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="What an operator should know about these rooms."
        />
      </label>

      <div className="field">
        <span className="field-label">Featured images</span>
        <p className="field-hint">
          Up to {MAX_IMAGES} landscape photographs, shown in the contract in this order. A caption
          under each says what it is.
        </p>
        <div className="vd-images">
          {section.images.map((image) => (
            <div key={image.id} className="vd-image">
              <img src={stoPdfUrl(image.storage_path)} alt={image.caption ?? ''} />
              <input
                aria-label="Caption"
                value={captions[image.id] ?? ''}
                onChange={(e) => setCaptions((prev) => ({ ...prev, [image.id]: e.target.value }))}
                onBlur={() =>
                  onSave(
                    () => updateImage(image.id, captions[image.id] ?? ''),
                    'Could not save that caption.',
                    'Caption saved.'
                  )
                }
                placeholder="Standard room, garden side"
              />
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() =>
                  onSave(() => removeImage(image), 'Could not remove that image.', 'Image removed.')
                }
              >
                Remove image
              </button>
            </div>
          ))}

          {section.images.length < MAX_IMAGES && (
            <div className="vd-image vd-image-empty">
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  onSave(
                    async () => {
                      if (file.size > MAX_IMAGE_BYTES)
                        throw new Error(
                          `That image is ${formatSize(file.size)}. The limit is ${formatSize(MAX_IMAGE_BYTES)}.`
                        )
                      await addImage(section.id, file, '', section.images.length)
                    },
                    'Upload failed.',
                    'Image added.'
                  ).finally(() => {
                    if (fileInput.current) fileInput.current.value = ''
                  })
                }}
              />
              <p className="field-hint">
                Image {section.images.length + 1} of {MAX_IMAGES}
              </p>
            </div>
          )}
        </div>
      </div>

      <label className="field">
        <span>Full gallery link</span>
        <input
          value={draft.gallery_url}
          onChange={(e) => set('gallery_url', e.target.value)}
          placeholder="https://photos.app.goo.gl/…"
        />
      </label>

      <div className="vd-grid">
        <label className="field">
          <span>Meal plan notes</span>
          <textarea
            rows={3}
            value={draft.meal_plan_notes}
            onChange={(e) => set('meal_plan_notes', e.target.value)}
            placeholder="All rates are quoted on a bed & breakfast basis unless stated otherwise."
          />
        </label>
        <label className="field">
          <span>Seasonal notes</span>
          <textarea
            rows={3}
            value={draft.seasonal_notes}
            onChange={(e) => set('seasonal_notes', e.target.value)}
            placeholder="High season: 1 June – 31 October and 20 December – 15 March."
          />
        </label>
      </div>

      <label className="field">
        <span>Internal notes</span>
        <textarea
          rows={2}
          value={draft.internal_notes}
          onChange={(e) => set('internal_notes', e.target.value)}
          placeholder="Never printed."
        />
      </label>

      <div className="vd-save">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            onSave(async () => {
              if (!draft.name.trim()) throw new Error('The category needs a name.')
              await update(section.id, {
                name: draft.name.trim(),
                description: draft.description.trim() || null,
                gallery_url: draft.gallery_url.trim() || null,
                meal_plan_notes: draft.meal_plan_notes.trim() || null,
                seasonal_notes: draft.seasonal_notes.trim() || null,
                internal_notes: draft.internal_notes.trim() || null,
              })
            }, 'Could not save that category.')
          }
        >
          {busy ? 'Saving…' : `Save ${section.name}`}
        </button>
      </div>
    </section>
  )
}

/* ===========================================================================
   Rate tables — one per room category, a table per season
   =========================================================================== */
function RatesTab({
  version,
  busy,
  onSave,
  save,
}: {
  version: StoVersionWithRates
  busy: boolean
  onSave: Guard
  save: SaveVersion
}) {
  const [rows, setRows] = useState<DraftRate[]>(
    version.rates.map((r) => ({
      key: r.id,
      section_id: r.section_id ?? '',
      season: r.season,
      room_type: r.room_type,
      description: r.description ?? '',
      pax: String(r.pax),
      bb: String(r.bb_price),
      bbRack: String(r.bb_rack),
      hb: String(r.hb_price),
      hbRack: String(r.hb_rack),
      fb: String(r.fb_price),
      fbRack: String(r.fb_rack),
      currency: r.currency,
    }))
  )

  const setRow = (key: string, patch: Partial<DraftRate>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const seasons = [...new Set(rows.map((r) => r.season.trim() || 'All year'))]
  const currency = rows[0]?.currency ?? 'USD'

  /** The whole contract's rates, as a spreadsheet. */
  const exportRows = (subset: DraftRate[], filename: string) =>
    downloadCsv(
      filename,
      toCsv(
        [
          'Category',
          'Season',
          'Room type',
          'Pax',
          'BB STO',
          'BB Rack',
          'HB STO',
          'HB Rack',
          'FB STO',
          'FB Rack',
          'Currency',
          'Description',
        ],
        subset.map((r) => [
          version.sections.find((s) => s.id === r.section_id)?.name ?? 'Uncategorised',
          r.season || 'All year',
          r.room_type,
          r.pax,
          r.bb,
          r.bbRack,
          r.hb,
          r.hbRack,
          r.fb,
          r.fbRack,
          r.currency,
          r.description,
        ])
      )
    )

  function saveRates() {
    const cleaned: RateInput[] = rows
      .filter((r) => r.room_type.trim())
      .map((r) => ({
        section_id: r.section_id || null,
        season: r.season.trim() || 'All year',
        room_type: r.room_type.trim(),
        description: r.description.trim() || null,
        pax: parseInt(r.pax, 10) || 1,
        bb_price: parseFloat(r.bb) || 0,
        hb_price: parseFloat(r.hb) || 0,
        fb_price: parseFloat(r.fb) || 0,
        bb_rack: parseFloat(r.bbRack) || 0,
        hb_rack: parseFloat(r.hbRack) || 0,
        fb_rack: parseFloat(r.fbRack) || 0,
        max_occupancy: parseInt(r.pax, 10) || 1,
        currency: r.currency.trim().toUpperCase() || 'USD',
      }))
    return onSave(
      () => save(version.id, {}, bodyFrom(version, { rates: cleaned })),
      'Could not save the rates.'
    )
  }

  const groups = [
    ...version.sections.map((s) => ({ id: s.id, name: s.name })),
    // Anything not yet filed under a category still has to be visible, or a
    // rate quietly stops being editable the moment its category is removed.
    ...(rows.some((r) => !r.section_id) ? [{ id: '', name: 'Uncategorised' }] : []),
  ]

  return (
    <>
      <div className="vd-rates-top">
        <button
          className="btn btn-sm"
          onClick={() =>
            exportRows(rows, `zondela-rates-${version.year}-full-workbook.csv`)
          }
        >
          Download full rates workbook
        </button>
      </div>

      {groups.length === 0 && (
        <div className="empty-state card">
          <h3>No room categories yet</h3>
          <p>Add Standard and Deluxe on the Property Sections tab, then price their rooms here.</p>
        </div>
      )}

      {groups.map((group) => {
        const mine = rows.filter((r) => (r.section_id || '') === group.id)
        return (
          <section key={group.id || 'none'} className="card vd-card">
            <div className="vd-card-head">
              <h2>{group.name} — Rates</h2>
              <div className="vd-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    downloadCsv(
                      `zondela-rates-template.csv`,
                      toCsv(
                        [
                          'Season',
                          'Room type',
                          'Pax',
                          'BB STO',
                          'BB Rack',
                          'HB STO',
                          'HB Rack',
                          'FB STO',
                          'FB Rack',
                        ],
                        [['High Season', 'Standard Double', 2, 170, 0, 210, 0, 250, 0]]
                      )
                    )
                  }
                >
                  Template
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() =>
                    exportRows(
                      mine,
                      `zondela-rates-${version.year}-${group.name.toLowerCase().replace(/\s+/g, '-')}.csv`
                    )
                  }
                >
                  Export
                </button>
              </div>
            </div>

            {(seasons.length > 0 ? seasons : ['All year']).map((season) => {
              const seasonRows = mine.filter((r) => (r.season.trim() || 'All year') === season)
              if (seasonRows.length === 0) return null
              return (
                <div key={season} className="vd-rate-block">
                  <h3 className="vd-season">{season}</h3>
                  <div className="vd-table-wrap">
                    <table className="vd-rate-table">
                      <thead>
                        <tr>
                          <th rowSpan={2}>Room type</th>
                          <th rowSpan={2}>Pax</th>
                          {MEAL_PLANS.map((plan) => (
                            <th key={plan.key} colSpan={2} className="vd-plan-head">
                              {plan.full}
                            </th>
                          ))}
                          <th rowSpan={2} />
                        </tr>
                        <tr>
                          {MEAL_PLANS.map((plan) => (
                            <>
                              <th key={`${plan.key}-sto`}>{plan.label} STO</th>
                              <th key={`${plan.key}-rack`}>{plan.label} Rack</th>
                            </>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {seasonRows.map((row) => (
                          <tr key={row.key}>
                            <td>
                              <input
                                aria-label="Room type"
                                value={row.room_type}
                                onChange={(e) => setRow(row.key, { room_type: e.target.value })}
                                placeholder="Standard Double"
                              />
                            </td>
                            <td className="vd-narrow">
                              <input
                                aria-label="Pax"
                                type="number"
                                min="1"
                                max="12"
                                value={row.pax}
                                onChange={(e) => setRow(row.key, { pax: e.target.value })}
                              />
                            </td>
                            <td className="vd-narrow">
                              <input
                                aria-label="BB STO"
                                type="number"
                                min="0"
                                value={row.bb}
                                onChange={(e) => setRow(row.key, { bb: e.target.value })}
                              />
                            </td>
                            <td className="vd-narrow">
                              <input
                                aria-label="BB rack"
                                type="number"
                                min="0"
                                value={row.bbRack}
                                onChange={(e) => setRow(row.key, { bbRack: e.target.value })}
                              />
                            </td>
                            <td className="vd-narrow">
                              <input
                                aria-label="HB STO"
                                type="number"
                                min="0"
                                value={row.hb}
                                onChange={(e) => setRow(row.key, { hb: e.target.value })}
                              />
                            </td>
                            <td className="vd-narrow">
                              <input
                                aria-label="HB rack"
                                type="number"
                                min="0"
                                value={row.hbRack}
                                onChange={(e) => setRow(row.key, { hbRack: e.target.value })}
                              />
                            </td>
                            <td className="vd-narrow">
                              <input
                                aria-label="FB STO"
                                type="number"
                                min="0"
                                value={row.fb}
                                onChange={(e) => setRow(row.key, { fb: e.target.value })}
                              />
                            </td>
                            <td className="vd-narrow">
                              <input
                                aria-label="FB rack"
                                type="number"
                                min="0"
                                value={row.fbRack}
                                onChange={(e) => setRow(row.key, { fbRack: e.target.value })}
                              />
                            </td>
                            <td>
                              <button
                                className="btn btn-ghost btn-sm"
                                aria-label={`Remove ${row.room_type || 'row'}`}
                                onClick={() =>
                                  setRows((prev) => prev.filter((r) => r.key !== row.key))
                                }
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}

            <div className="vd-add-row">
              <button
                className="btn btn-sm"
                onClick={() =>
                  setRows((prev) => [
                    ...prev,
                    blankRate(group.id, seasons[0] ?? 'All year', currency),
                  ])
                }
              >
                + Add room
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const season = prompt('Name the season', 'Low Season')?.trim()
                  if (!season) return
                  setRows((prev) => [...prev, blankRate(group.id, season, currency)])
                }}
              >
                + Add a season
              </button>
            </div>
          </section>
        )
      })}

      {groups.length > 0 && (
        <div className="vd-save vd-save-sticky">
          <label className="vd-currency">
            <span>Currency</span>
            <select
              value={currency}
              onChange={(e) =>
                setRows((prev) => prev.map((r) => ({ ...r, currency: e.target.value })))
              }
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" disabled={busy} onClick={saveRates}>
            {busy ? 'Saving…' : 'Save rate tables'}
          </button>
        </div>
      )}
    </>
  )
}

/* ===========================================================================
   Terms & conditions
   =========================================================================== */
function TermsTab({
  version,
  busy,
  onSave,
  save,
}: {
  version: StoVersionWithRates
  busy: boolean
  onSave: Guard
  save: SaveVersion
}) {
  const [terms, setTerms] = useState(
    version.terms_list.map((t) => ({ key: t.id, title: t.title, body: t.body }))
  )

  const move = (index: number, by: number) =>
    setTerms((prev) => {
      const next = [...prev]
      const target = index + by
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  return (
    <>
      {terms.length === 0 && (
        <div className="empty-state card">
          <h3>No clauses yet</h3>
          <p>
            Start from the standard set below — meal plan, children, cancellation, payment — and
            edit the wording to match what Zondela actually agrees to.
          </p>
          <button
            className="btn btn-primary"
            onClick={() =>
              setTerms(STANDARD_CLAUSES.map((title) => ({ key: newKey(), title, body: '' })))
            }
          >
            Add the standard clauses
          </button>
        </div>
      )}

      {terms.map((term, index) => (
        <section key={term.key} className="card vd-card vd-term">
          <div className="vd-term-head">
            <span className="vd-term-num">{index + 1}</span>
            <input
              aria-label="Clause title"
              value={term.title}
              onChange={(e) =>
                setTerms((prev) =>
                  prev.map((t) => (t.key === term.key ? { ...t, title: e.target.value } : t))
                )
              }
              placeholder="Cancellation Policy"
            />
            <button
              className="btn btn-ghost btn-sm"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              ↑
            </button>
            <button
              className="btn btn-ghost btn-sm"
              aria-label="Move down"
              disabled={index === terms.length - 1}
              onClick={() => move(index, 1)}
            >
              ↓
            </button>
            <button
              className="btn btn-ghost btn-sm"
              aria-label="Remove clause"
              onClick={() => setTerms((prev) => prev.filter((t) => t.key !== term.key))}
            >
              ×
            </button>
          </div>
          <textarea
            aria-label={`${term.title || 'Clause'} text`}
            rows={4}
            value={term.body}
            onChange={(e) =>
              setTerms((prev) =>
                prev.map((t) => (t.key === term.key ? { ...t, body: e.target.value } : t))
              )
            }
            placeholder="Lines starting with • or - print as bullets; a blank line starts a paragraph."
          />
        </section>
      ))}

      <div className="vd-add-row">
        <button
          className="btn btn-sm"
          onClick={() => setTerms((prev) => [...prev, { key: newKey(), title: '', body: '' }])}
        >
          + Add clause
        </button>
        {terms.length > 0 && (
          <button
            className="btn btn-sm"
            onClick={() =>
              setTerms((prev) => [
                ...prev,
                ...STANDARD_CLAUSES.filter(
                  (title) => !prev.some((t) => t.title.toLowerCase() === title.toLowerCase())
                ).map((title) => ({ key: newKey(), title, body: '' })),
              ])
            }
          >
            + Any standard clauses still missing
          </button>
        )}
      </div>

      <div className="vd-save vd-save-sticky">
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            onSave(
              () =>
                save(
                  version.id,
                  {},
                  bodyFrom(version, {
                    terms: terms
                      .filter((t) => t.title.trim())
                      .map((t) => ({ title: t.title.trim(), body: t.body.trim() })),
                  })
                ),
              'Could not save the terms.'
            )
          }
        >
          {busy ? 'Saving…' : 'Save terms & conditions'}
        </button>
      </div>
    </>
  )
}

/* ===========================================================================
   Official PDF
   =========================================================================== */
function PdfTab({
  version,
  busy,
  onSave,
  upload,
  remove,
  refresh,
}: {
  version: StoVersionWithRates
  busy: boolean
  onSave: Guard
  upload: (version: StoVersionWithRates, file: File) => Promise<void>
  remove: (version: StoVersionWithRates) => Promise<void>
  refresh: () => Promise<void>
}) {
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <section className="card vd-card">
      <h2>Official STO PDF</h2>
      <p className="vd-lede">
        The signed file as you send it today. It stays attached to this version and travels with
        every agreement sent from it — an operator who already accepted keeps the file they accepted
        against, because their link reads this version.
      </p>

      {version.pdf_path ? (
        <div className="vd-pdf">
          <code>{version.pdf_name}</code>
          <span className="vd-pdf-size">{formatSize(version.pdf_size_bytes)}</span>
          <a
            className="btn btn-sm"
            href={stoPdfUrl(version.pdf_path)}
            target="_blank"
            rel="noreferrer"
          >
            Download
          </a>
          <button
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() =>
              onSave(
                async () => {
                  await remove(version)
                  await refresh()
                },
                'Could not remove that file.',
                'PDF removed.'
              )
            }
          >
            Remove
          </button>
        </div>
      ) : (
        <p className="field-hint">
          Nothing attached. The CRM renders its own contract from the tabs above, so this is
          optional — attach it when operators expect the file they know.
        </p>
      )}

      <div className="field">
        <span className="field-label">{version.pdf_path ? 'Replace it' : 'Attach a PDF'}</span>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            onSave(
              async () => {
                if (file.type !== 'application/pdf')
                  throw new Error('That is not a PDF.')
                if (file.size > MAX_PDF_BYTES)
                  throw new Error(
                    `That file is ${formatSize(file.size)}. The limit is ${formatSize(MAX_PDF_BYTES)}.`
                  )
                await upload(version, file)
              },
              'Upload failed.',
              'PDF attached.'
            ).finally(() => {
              if (fileInput.current) fileInput.current.value = ''
            })
          }}
        />
      </div>
    </section>
  )
}
