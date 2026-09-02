import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { stoPdfUrl } from '../hooks/useStoVersions'
import { formatDayTime } from '../lib/stoVersion'
import RateSheetDocument, {
  type SheetOrg,
  type SheetRate,
  type SheetSection,
  type SheetSupplement,
  type SheetVersion,
} from '../components/RateSheetDocument'
import './public-agreement.css'

/** Exactly what sto_public_agreement returns — the whole public surface. */
interface AgreementPayload {
  send: {
    status: 'sent' | 'viewed' | 'accepted' | 'declined'
    to_name: string | null
    company_name: string | null
    sent_at: string
    viewed_at: string | null
    accepted_at: string | null
    declined_at: string | null
    responded_name: string | null
    responded_title: string | null
    responded_note: string | null
  }
  version: SheetVersion & { pdf_path: string | null; pdf_name: string | null }
  rates: SheetRate[]
  supplements: SheetSupplement[]
  sections: SheetSection[]
  org: SheetOrg | null
}

/**
 * The page an operator opens from the email.
 *
 * No login, and nothing here belongs to the CRM's shell: this is the only part
 * of the app a client ever sees, so it is its own page from the frame in. It
 * talks to two security-definer functions and nothing else — there is no table
 * access behind this route to get wrong, and the token in the URL is the only
 * thing that names a row.
 *
 * No tax numbers, no registration details, no account. Zondela is publishing
 * the season's rates; the operator reads them and says yes.
 */
export default function PublicAgreement() {
  const { token = '' } = useParams()

  const [data, setData] = useState<AgreementPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: payload, error } = await supabase.rpc('sto_public_agreement', { p_token: token })
    if (error || !payload) {
      setNotFound(true)
      setLoading(false)
      return
    }
    const value = payload as AgreementPayload
    setData(value)
    setName((prev) => prev || value.send.responded_name || value.send.to_name || '')
    setTitle((prev) => prev || value.send.responded_title || '')
    setLoading(false)
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  async function respond(accept: boolean) {
    if (accept && !name.trim()) {
      setError('Please give your name, so we know who accepted on behalf of your company.')
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.rpc('sto_public_respond', {
      p_token: token,
      p_accept: accept,
      p_name: name.trim() || null,
      p_title: title.trim() || null,
      p_email: email.trim() || null,
      p_note: note.trim() || null,
    })
    setBusy(false)
    if (error) {
      setError('Something went wrong sending your answer. Please try again, or reply to our email.')
      return
    }
    await load()
  }

  if (loading) {
    return (
      <div className="pa-shell">
        <p className="pa-status">Loading…</p>
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="pa-shell">
        <div className="pa-card">
          <h1>This link is not valid</h1>
          <p>
            The agreement link may have been mistyped or withdrawn. Please reply to the email you
            received and we will send a fresh one.
          </p>
        </div>
      </div>
    )
  }

  const { send, version, rates, supplements, sections, org } = data
  const answered = send.status === 'accepted' || send.status === 'declined'
  const brand = org?.brand_color || '#0c3b35'

  return (
    <div className="pa-shell">
      {answered && (
        <div
          className={`pa-banner${send.status === 'declined' ? ' pa-banner-declined' : ''}`}
          style={send.status === 'accepted' ? { background: brand } : undefined}
        >
          <strong>
            {send.status === 'accepted'
              ? `Accepted${send.responded_name ? ` by ${send.responded_name}` : ''}${
                  send.responded_title ? `, ${send.responded_title}` : ''
                }`
              : 'You declined these rates'}
          </strong>
          <span>
            {formatDayTime(send.accepted_at ?? send.declined_at)} · A copy of this page stays at this
            link for your records.
          </span>
        </div>
      )}

      <main className="pa-main">
        <RateSheetDocument
          version={version}
          rates={rates}
          supplements={supplements}
          sections={sections}
          org={org}
          recipient={{ name: send.to_name, company: send.company_name }}
          pdfUrl={version.pdf_path ? stoPdfUrl(version.pdf_path) : null}
          pdfName={version.pdf_name}
          acceptance={
            send.status === 'accepted'
              ? {
                  name: send.responded_name,
                  title: send.responded_title,
                  company: send.company_name,
                  at: send.accepted_at,
                }
              : null
          }
        />

        {!answered && (
          <section className="pa-accept" aria-labelledby="pa-accept-title">
            <h2 id="pa-accept-title">Accept these rates</h2>
            {/* The sentence the paper contract asks the client to sign under,
                in the same words — this is that signature, typed. */}
            <p className="pa-declaration">
              I, on behalf of <strong>{send.company_name || 'my company'}</strong>, accept the rates
              offered by {org?.org_name || 'Zondela House'} for {version.year} and accept the terms
              and conditions pertaining thereto.
            </p>

            <div className="pa-fields">
              <label>
                <span>Name in print</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Who is accepting"
                />
              </label>
              <label>
                <span>Position / title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Director, Reservations Manager…"
                />
              </label>
              <label>
                <span>Email (optional)</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="So we can confirm back"
                />
              </label>
            </div>

            <label className="pa-note">
              <span>Anything you would like to add (optional)</span>
              <textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Questions, or the rates you would like us to look at again"
              />
            </label>

            {error && <p className="pa-error">{error}</p>}

            <div className="pa-actions">
              <button
                className="pa-btn pa-btn-primary"
                style={{ background: brand }}
                disabled={busy}
                onClick={() => respond(true)}
              >
                {busy ? 'Sending…' : `Accept the ${version.year} rate contract`}
              </button>
              <button className="pa-btn" disabled={busy} onClick={() => respond(false)}>
                Not this season
              </button>
            </div>
          </section>
        )}

        {answered && send.responded_note && (
          <section className="pa-accept">
            <h2>What you told us</h2>
            <p className="pa-quote">{send.responded_note}</p>
          </section>
        )}
      </main>

      <footer className="pa-foot">
        {org?.org_name || 'Zondela House'}
        {org?.email ? ` · ${org.email}` : ''}
        {org?.phone ? ` · ${org.phone}` : ''}
      </footer>
    </div>
  )
}
