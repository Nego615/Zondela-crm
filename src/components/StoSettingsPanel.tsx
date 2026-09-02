import { useEffect, useState, type FormEvent } from 'react'
import { useOrgSettings } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import RateSheetDocument, { type SheetRate, type SheetVersion } from './RateSheetDocument'
import type { OrgSettings } from '../lib/database.types'
import './ui.css'
import './sto-settings.css'

const BRANDING_BUCKET = 'branding'

/**
 * A stand-in season, so the preview shows a real rate sheet rather than an
 * empty frame. Never saved — it exists only to be rendered beside the form.
 */
const SAMPLE_VERSION: SheetVersion = {
  name: `Zondela House STO Rates ${new Date().getFullYear() + 1}`,
  year: new Date().getFullYear() + 1,
  summary: 'Standard tour operator rates, valid for the whole season.',
  intro:
    'Zondela House is a boutique property with 12 comfortable rooms, offering a warm and inviting stay for leisure, business and safari travellers.',
  rate_basis: 'Per room, per night',
  rates_note: 'All rates quoted are inclusive of VAT and Tourism development levy.',
  terms: null,
  valid_from: `${new Date().getFullYear() + 1}-01-01`,
  valid_to: `${new Date().getFullYear() + 1}-12-31`,
}

const SAMPLE_RATES: SheetRate[] = [
  {
    season: 'All year',
    room_type: 'Standard Double',
    description: 'Twin or double, private balcony.',
    bb_price: 170,
    hb_price: 210,
    fb_price: 250,
    max_occupancy: 2,
    currency: 'USD',
  },
  {
    season: 'All year',
    room_type: 'Family Room',
    description: null,
    bb_price: 340,
    hb_price: 420,
    fb_price: 500,
    max_occupancy: 4,
    currency: 'USD',
  },
]

/** Every editable field, so the form state can be built and diffed generically. */
type Draft = Omit<OrgSettings, 'id' | 'created_at' | 'updated_at'>

const EMPTY_DRAFT: Draft = {
  org_name: '',
  legal_name: '',
  tagline: '',
  address: '',
  city: '',
  country: '',
  phone: '',
  email: '',
  website: '',
  logo_url: '',
  brand_color: '#0c3b35',
  accent_color: '#a9463a',
  agreement_intro: '',
  agreement_terms_default: '',
  agreement_footer: '',
  signatory_name: '',
  signatory_title: '',
  email_from_name: '',
  email_from_address: '',
  email_reply_to: '',
  email_bcc: '',
  email_signature: '',
}

function toDraft(settings: OrgSettings): Draft {
  const { id: _id, created_at: _c, updated_at: _u, ...rest } = settings
  // Null reads badly in a controlled input; the save turns blanks back to null.
  return Object.fromEntries(
    Object.entries({ ...EMPTY_DRAFT, ...rest }).map(([k, v]) => [k, v ?? '']),
  ) as Draft
}

export default function StoSettingsPanel() {
  const { settings, loading, save } = useOrgSettings()
  const { can } = useAuth()

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const editable = can('settings.branding')

  // The row arrives after the first render, so the form is seeded here rather
  // than in initial state.
  useEffect(() => {
    if (settings) setDraft(toDraft(settings))
  }, [settings])

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setSaved(false)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!draft.org_name.trim()) {
      setError('An organisation name is required — it heads every agreement.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      // Blanks go back as null so the document's `||` fallbacks work.
      const payload = Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [k, typeof v === 'string' && !v.trim() ? null : v]),
      )
      await save({ ...payload, org_name: draft.org_name.trim() })
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the settings.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * The logo goes to the public `branding` bucket, not into the row as a data
   * URI: it has to load inside a client's mail client, which will not render a
   * base64 image reliably and cannot reach anything that needs a session.
   */
  async function handleLogo(file: File) {
    setUploading(true)
    setError(null)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `logo-${crypto.randomUUID()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from(BRANDING_BUCKET)
        .upload(path, file, { upsert: false })
      if (uploadError) throw uploadError

      const { data } = supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path)
      set('logo_url', data.publicUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that logo.')
    } finally {
      setUploading(false)
    }
  }

  if (loading) return <p style={{ color: 'var(--text-soft)' }}>Loading settings…</p>

  const previewSettings: OrgSettings = {
    ...(settings ?? ({} as OrgSettings)),
    ...draft,
    id: 1,
  }

  return (
    <div className="sto-settings">
      <form className="card sto-settings-form" onSubmit={handleSubmit}>
        {!editable && (
          <p className="sto-settings-locked">
            You can see how agreements are branded, but not change it. Ask an Admin or Manager.
          </p>
        )}

        <fieldset disabled={!editable || saving}>
          <h3>Identity</h3>
          <p className="sto-settings-sub">Heads every agreement and signs off every email.</p>

          <div className="sto-settings-grid">
            <div className="field">
              <label htmlFor="s_org">Organisation name</label>
              <input id="s_org" value={draft.org_name} onChange={(e) => set('org_name', e.target.value)} placeholder="Zondela House" />
            </div>
            <div className="field">
              <label htmlFor="s_legal">Legal name</label>
              <input id="s_legal" value={draft.legal_name ?? ''} onChange={(e) => set('legal_name', e.target.value)} placeholder="Zondela House Ltd" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="s_tagline">Tagline</label>
            <input id="s_tagline" value={draft.tagline ?? ''} onChange={(e) => set('tagline', e.target.value)} placeholder="Search and traffic optimisation" />
          </div>

          <div className="sto-settings-grid">
            <div className="field">
              <label htmlFor="s_address">Address</label>
              <input id="s_address" value={draft.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="Street, area" />
            </div>
            <div className="field">
              <label htmlFor="s_city">City</label>
              <input id="s_city" value={draft.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="Arusha" />
            </div>
          </div>

          <div className="sto-settings-grid">
            <div className="field">
              <label htmlFor="s_country">Country</label>
              <input id="s_country" value={draft.country ?? ''} onChange={(e) => set('country', e.target.value)} placeholder="Tanzania" />
            </div>
            <div className="field">
              <label htmlFor="s_phone">Phone</label>
              <input id="s_phone" value={draft.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+255 7XX XXX XXX" />
            </div>
          </div>

          <div className="sto-settings-grid">
            <div className="field">
              <label htmlFor="s_email">Email</label>
              <input id="s_email" type="email" value={draft.email ?? ''} onChange={(e) => set('email', e.target.value)} placeholder="hello@zondela.co.tz" />
            </div>
            <div className="field">
              <label htmlFor="s_website">Website</label>
              <input id="s_website" value={draft.website ?? ''} onChange={(e) => set('website', e.target.value)} placeholder="zondela.co.tz" />
            </div>
          </div>

          <h3>Look</h3>
          <p className="sto-settings-sub">
            Applied inline on the document, so it survives print and paste into an email.
          </p>

          <div className="sto-settings-grid">
            <div className="field">
              <label htmlFor="s_brand">Brand colour</label>
              <div className="sto-color">
                <input id="s_brand" type="color" value={draft.brand_color} onChange={(e) => set('brand_color', e.target.value)} />
                <input aria-label="Brand colour hex" value={draft.brand_color} onChange={(e) => set('brand_color', e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="s_accent">Accent colour</label>
              <div className="sto-color">
                <input id="s_accent" type="color" value={draft.accent_color} onChange={(e) => set('accent_color', e.target.value)} />
                <input aria-label="Accent colour hex" value={draft.accent_color} onChange={(e) => set('accent_color', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="field">
            <label htmlFor="s_logo">Logo</label>
            <div className="sto-logo-row">
              {draft.logo_url ? (
                <img className="sto-logo-thumb" src={draft.logo_url} alt="Current logo" />
              ) : (
                <span className="sto-logo-empty">No logo</span>
              )}
              <input
                id="s_logo"
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleLogo(file)
                  e.target.value = ''
                }}
              />
              {draft.logo_url && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => set('logo_url', '')}>
                  Remove
                </button>
              )}
            </div>
            <span className="field-hint">
              {uploading ? 'Uploading…' : 'Stored publicly so it loads in a client’s email.'}
            </span>
          </div>

          <h3>Agreement wording</h3>

          <div className="field">
            <label htmlFor="s_intro">Opening paragraph</label>
            <textarea id="s_intro" value={draft.agreement_intro ?? ''} onChange={(e) => set('agreement_intro', e.target.value)} placeholder="Thank you for considering Zondela House. The services below are quoted for the period stated." />
          </div>

          <div className="field">
            <label htmlFor="s_terms">Default terms</label>
            <textarea id="s_terms" value={draft.agreement_terms_default ?? ''} onChange={(e) => set('agreement_terms_default', e.target.value)} placeholder="Payment within 14 days of invoice. Either party may cancel with 30 days' notice." />
            <span className="field-hint">Used when an agreement has no terms of its own.</span>
          </div>

          <div className="field">
            <label htmlFor="s_footer">Footer line</label>
            <input id="s_footer" value={draft.agreement_footer ?? ''} onChange={(e) => set('agreement_footer', e.target.value)} placeholder="Zondela House Ltd · TIN 123-456-789 · Arusha, Tanzania" />
          </div>

          <div className="sto-settings-grid">
            <div className="field">
              <label htmlFor="s_sig_name">Signatory name</label>
              <input id="s_sig_name" value={draft.signatory_name ?? ''} onChange={(e) => set('signatory_name', e.target.value)} placeholder="Asha Mwangi" />
            </div>
            <div className="field">
              <label htmlFor="s_sig_title">Signatory title</label>
              <input id="s_sig_title" value={draft.signatory_title ?? ''} onChange={(e) => set('signatory_title', e.target.value)} placeholder="Managing Director" />
            </div>
          </div>

          <h3>Email settings</h3>
          <p className="sto-settings-sub">
            Used to compose what goes out. Sending still opens your own mail client — nothing here
            sends on your behalf.
          </p>

          <div className="sto-settings-grid">
            <div className="field">
              <label htmlFor="s_from_name">From name</label>
              <input id="s_from_name" value={draft.email_from_name ?? ''} onChange={(e) => set('email_from_name', e.target.value)} placeholder="Zondela House" />
            </div>
            <div className="field">
              <label htmlFor="s_from_addr">From address</label>
              <input id="s_from_addr" type="email" value={draft.email_from_address ?? ''} onChange={(e) => set('email_from_address', e.target.value)} placeholder="sto@zondela.co.tz" />
            </div>
          </div>

          <div className="sto-settings-grid">
            <div className="field">
              <label htmlFor="s_reply">Reply-to</label>
              <input id="s_reply" type="email" value={draft.email_reply_to ?? ''} onChange={(e) => set('email_reply_to', e.target.value)} placeholder="hello@zondela.co.tz" />
            </div>
            <div className="field">
              <label htmlFor="s_bcc">BCC every send to</label>
              <input id="s_bcc" type="email" value={draft.email_bcc ?? ''} onChange={(e) => set('email_bcc', e.target.value)} placeholder="records@zondela.co.tz" />
              <span className="field-hint">Added to the mail client's BCC line.</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="s_signature">Email signature</label>
            <textarea id="s_signature" value={draft.email_signature ?? ''} onChange={(e) => set('email_signature', e.target.value)} placeholder={'Zondela House\n+255 7XX XXX XXX · zondela.co.tz'} />
            <span className="field-hint">Closes every agreement email, under the sender's name.</span>
          </div>
        </fieldset>

        {error && <p className="sto-settings-error">{error}</p>}
        {saved && <p className="sto-settings-saved">Saved. New agreements use this straight away.</p>}

        {editable && (
          <div className="sto-settings-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        )}
      </form>

      <div className="sto-settings-preview">
        <div className="panel-header">
          <h2>Preview</h2>
          <p>Sample rates, your branding. Updates as you type.</p>
        </div>
        <div className="sto-settings-preview-frame">
          <RateSheetDocument
            version={SAMPLE_VERSION}
            rates={SAMPLE_RATES}
            supplements={[{ name: 'Dinner', price: 20, currency: 'USD', unit: 'per person' }]}
            sections={[
              {
                title: 'Check-In / Check-Out',
                body: 'Check-in: 2:00 PM\nCheck-out: 10:00 AM',
              },
            ]}
            org={previewSettings}
            recipient={{ company: 'Serengeti Trails Safaris Ltd' }}
          />
        </div>
      </div>
    </div>
  )
}
