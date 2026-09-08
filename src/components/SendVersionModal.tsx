import { useEffect, useMemo, useState } from 'react'
import {
  useCompanies,
  useContacts,
  useOrgSettings,
  usePricingDocuments,
  useRateCard,
  useTemplates,
} from '../hooks/useCrmData'
import { useAgreementSends, useStoVersions, agreementLink } from '../hooks/useStoVersions'
import { invalidate } from '../hooks/sharedResource'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { emailStatus, sendRecordedEmail } from '../lib/email'
import {
  MEAL_PLANS,
  PLACEHOLDERS,
  fillTemplate,
  formatRate,
  rateRange,
  scopeLabel,
} from '../lib/stoVersion'
import type { StoVersionWithRates } from '../lib/database.types'
import './ui.css'
import './send-version.css'

interface Props {
  /**
   * The agreement being sent. Left out from a company's page, where the
   * agreement is the thing being chosen rather than the thing already known.
   */
  version?: StoVersionWithRates
  /** Pre-selects the operator, when sending from a company's own page. */
  companyId?: string
  onClose: () => void
  onSent: () => void
}

/**
 * Sending the season's rates to one operator.
 *
 * The send row is created first, because the link in the email is the token on
 * that row — there is nothing to paste into a message until the database has
 * issued it. The operator opens that link, reads the contract and accepts it
 * there, which is how the CRM knows what happened without anyone chasing.
 *
 * Two ways in, and they differ only in what is already decided. From the STO
 * page an agreement is picked first and this modal chooses the operator; from a
 * company's page the operator is known and the agreement is chosen here. Either
 * way it is the same send, recorded once.
 *
 * The service rate card and the price list PDF ride along as extras, for a
 * client who is being quoted services alongside the season's rooms.
 */
export default function SendVersionModal({ version: fixedVersion, companyId, onClose, onSent }: Props) {
  const { companies } = useCompanies()
  const { templates } = useTemplates()
  const { settings } = useOrgSettings()
  const { sends, createSend } = useAgreementSends()
  const { versions, loading: versionsLoading } = useStoVersions()
  const { items: rateCard } = useRateCard()
  const { documents, documentUrl } = usePricingDocuments()
  const { profile } = useAuth()

  // Only offered when one was not handed in. Active sheets first and the newest
  // season at the top: sending last year's rates is the mistake this ordering
  // is here to prevent.
  const choices = useMemo(
    () =>
      versions
        .filter((v) => v.status !== 'archived')
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1
          return b.year - a.year
        }),
    [versions]
  )

  const [versionChoice, setVersionChoice] = useState<string | null>(null)
  const version =
    fixedVersion ??
    (versionChoice ? versions.find((v) => v.id === versionChoice) : undefined) ??
    choices[0]

  const [company, setCompany] = useState(companyId ?? '')
  const { contacts } = useContacts(company || undefined)

  const [contactChoice, setContactChoice] = useState<string | null>(null)
  const contactId = contactChoice ?? contacts.find((c) => c.is_primary)?.id ?? contacts[0]?.id ?? ''
  const contact = contacts.find((c) => c.id === contactId)
  const companyName = companies.find((c) => c.id === company)?.name ?? ''

  const [templateId, setTemplateId] = useState('')
  // Resolved at render, not seeded into state: the agreement is still being
  // chosen here, and the subject carries its season — seeded once it would keep
  // the year of whichever sheet happened to be offered first. A subject the
  // user has typed wins, and stops following the picker.
  const [subjectDraft, setSubjectDraft] = useState<string | null>(null)
  const subject =
    subjectDraft ?? `${settings?.org_name || 'Zondela House'} STO Rates — ${version?.year ?? ''}`.trim()
  const [note, setNote] = useState('')

  // The extras, both off until asked for: the agreement is what is being sent,
  // and a quote for services is something a client is given as well, not
  // instead.
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [documentId, setDocumentId] = useState('')
  const chosenDoc = documents.find((d) => d.id === documentId)
  const chosenDocUrl = chosenDoc ? documentUrl(chosenDoc) : null
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentLink, setSentLink] = useState<string | null>(null)
  // How this will actually go out, asked before the button is pressed so the
  // button can say which of the two it is about to do.
  const [mail, setMail] = useState<{
    configured: boolean
    from: string | null
    replyTo: string | null
  } | null>(null)
  const [delivery, setDelivery] = useState<'provider' | 'mail-client' | null>(null)

  useEffect(() => {
    emailStatus().then(setMail)
  }, [])

  const template = templates.find((t) => t.id === templateId)
  const range = version ? rateRange(version.rates) : null

  // Already sent this season's sheet to this operator? Sending again is
  // legitimate — a contact changes, a link is lost — but doing it unknowingly
  // is not, so the modal says so before the button is pressed.
  const previous = sends.filter((s) => s.version_id === version?.id && s.company_id === company)

  /** The ticked services, as the lines they print as. */
  const serviceLines = rateCard
    .filter((i) => selectedItems.has(i.id))
    .map(
      (i) =>
        `• ${i.service_name} — ${formatRate(i.price, i.currency)}${i.unit ? ` (${i.unit})` : ''}`
    )
    .join('\n')

  /**
   * The message, with the link left as a placeholder until there is one.
   *
   * Composed the same way whether it comes from a template or not, so what is
   * previewed here is exactly what the mail client is handed.
   */
  const compose = (link: string) => {
    if (!version) return ''

    const values = {
      contactName: contact?.full_name?.split(' ')[0] || 'there',
      companyName: companyName || 'your team',
      year: version.year,
      versionName: version.name,
      link,
      senderName: profile?.full_name || settings?.org_name || 'Zondela House',
    }

    // The extras go after whatever the body turns out to be, template or not: a
    // template is about the agreement, and these are the things added to this
    // one send.
    const extras = [
      ...(serviceLines ? ['', 'Services', serviceLines] : []),
      ...(chosenDocUrl ? ['', `Full price list (PDF): ${chosenDocUrl}`] : []),
    ]

    if (template) {
      // Templates are stored as HTML; the mail client is handed text, so the
      // tags come out and the placeholders go in.
      return [fillTemplate(template.body_html.replace(/<[^>]+>/g, ''), values), ...extras]
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
    }

    // One line per room, all three meal plans on it: an operator scanning an
    // email wants the chart, not a link to go and find the chart.
    const rates = version.rates
      .map(
        (r) =>
          `• ${r.room_type} (sleeps ${r.max_occupancy}): ` +
          MEAL_PLANS.map((plan) => `${plan.label} ${formatRate(r[plan.key], r.currency)}`).join(' · ')
      )
      .join('\n')

    const supplements = version.supplements
      .map((s) => `• ${s.name}: ${formatRate(s.price, s.currency)} ${s.unit}`)
      .join('\n')

    const signature = [
      'Kind regards,',
      profile?.full_name || settings?.org_name || 'Zondela House',
      settings?.email_signature || '',
    ]
      .filter(Boolean)
      .join('\n')

    return [
      `Dear ${values.contactName},`,
      '',
      `Please find the ${version.year} STO rates for ${settings?.org_name || 'Zondela House'}${companyName ? ` for ${companyName}` : ''}.`,
      version.summary ?? '',
      '',
      version.rate_basis ? `${version.rate_basis}:` : 'Rates:',
      rates,
      ...(supplements ? ['', 'Supplements', supplements] : []),
      ...(version.rates_note ? ['', version.rates_note] : []),
      ...extras,
      '',
      'Open the full contract — rates, policies and terms — and confirm your acceptance here:',
      link,
      '',
      'Should you have any questions, please do not hesitate to reach out.',
      '',
      signature,
    ]
      .filter((line) => line !== null)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  }

  const preview = useMemo(
    () => compose('[the operator’s own agreement link]'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [template, contact, companyName, version, profile, settings, serviceLines, chosenDocUrl]
  )

  async function handleSend() {
    setError(null)
    if (!version) {
      setError('Choose the agreement being sent.')
      return
    }
    if (!company) {
      setError('Choose the operator this is going to.')
      return
    }
    if (!contact?.email) {
      setError('That contact has no email address. Add one on the company page first.')
      return
    }

    setBusy(true)
    try {
      // The row first: its token is the link, so nothing can be composed
      // before it exists.
      const send = await createSend({
        version_id: version.id,
        company_id: company,
        contact_id: contactId || null,
        to_name: contact.full_name,
        to_email: contact.email,
        subject,
        sent_by: profile?.id ?? null,
        note: note.trim() || null,
      })

      const link = agreementLink(send.token)
      const body = compose(link)
      await supabase.from('sto_agreement_sends').update({ body }).eq('id', send.id)

      // The message row is what actually gets sent: send-email reads the
      // subject and body from it server-side, so what leaves the building is
      // what the CRM recorded. It goes in as `queued` and the function moves it
      // to `sent` — or straight to `sent` when there is no provider and the
      // user's own mail client does the sending.
      let messageId: string | null = null
      // Why it fell back, when it does. supabase-js reports a refused insert in
      // `error` rather than by throwing, so swallowing it here used to send the
      // user to their mail client with a configured provider and no reason
      // given — the one failure that looks exactly like not having email set up.
      let logError: string | null = null
      try {
        const { data: logged, error: insertError } = await supabase
          .from('sent_messages')
          .insert({
            company_id: company,
            contact_id: contactId || null,
            agreement_id: null,
            sent_by: profile?.id ?? null,
            channel: 'email',
            template_id: templateId || null,
            subject,
            body,
            to_name: contact.full_name,
            to_email: contact.email,
            status: mail?.configured ? 'queued' : 'sent',
          })
          .select('id')
          .single()
        if (insertError) logError = insertError.message
        messageId = logged?.id ?? null
      } catch (err) {
        // history is a convenience; sto_agreement_sends is the record
        logError = err instanceof Error ? err.message : 'Could not record the message.'
      }

      const result = messageId
        ? await sendRecordedEmail({
            messageId,
            sendId: send.id,
            to: contact.email,
            subject,
            body,
          })
        : // No row to send from — hand it to the mail client, which needs
          // nothing from the database.
          (openMailClientFallback(contact.email, subject, body),
          {
            delivery: 'mail-client' as const,
            error: mail?.configured
              ? `The CRM could not record this message, so it could not send it either — it opened your mail client instead. ${
                  logError ?? ''
                }`.trim()
              : undefined,
          })

      // The body and the delivery status were written after the row was
      // created, so the lists reading them need a second look.
      await invalidate('sto_sends', 'sent_messages')

      setDelivery(result.delivery)
      if (result.error) setError(result.error)

      setSentLink(link)
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record this send.')
    } finally {
      setBusy(false)
    }
  }

  /** Used only when the message row could not be written — the send still has to happen. */
  function openMailClientFallback(to: string, mailSubject: string, mailBody: string) {
    window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(
      mailSubject
    )}&body=${encodeURIComponent(mailBody)}`
  }

  async function copyLink(link: string) {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal send-version" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{version ? `Send ${version.name}` : 'Send an STO agreement'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {!version ? (
          <div className="sv-done">
            <h3>{versionsLoading ? 'Loading agreements…' : 'No agreement to send yet'}</h3>
            {!versionsLoading && (
              <p>
                A rate sheet is one season's rates — room types, seasons and what each costs.
                Publish one on the STO page and it can be sent from here.
              </p>
            )}
            <div className="version-actions">
              <button className="btn btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : sentLink ? (
          <div className="sv-done">
            <h3>Sent to {contact?.full_name}</h3>
            <p>
              {delivery === 'provider'
                ? `The email has gone out from ${mail?.from ?? 'Zondela House'}${
                    mail?.replyTo ? `, with replies going to ${mail.replyTo}` : ''
                  }. Delivery and opens come back on their own.`
                : 'Your mail client has the message — press send there.'}{' '}
              The operator opens the link below, reads the {version.year} rates and accepts them
              there; this page will show it as viewed, then accepted, without anyone chasing.
            </p>
            <div className="sv-link">
              <code>{sentLink}</code>
              <button className="btn btn-sm" onClick={() => copyLink(sentLink)}>
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            <div className="version-actions">
              <button className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {!fixedVersion && (
              <div className="field">
                <label htmlFor="sv_version">STO agreement</label>
                <select
                  id="sv_version"
                  value={version.id}
                  onChange={(e) => setVersionChoice(e.target.value)}
                >
                  {choices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {v.year}
                      {v.status === 'active' ? ' (active)' : ` (${v.status})`}
                    </option>
                  ))}
                </select>
                {version.status !== 'active' && (
                  <p className="field-hint">
                    This sheet is a {version.status}. It can still be sent, and the operator sees it
                    exactly as it stands.
                  </p>
                )}
              </div>
            )}

            <div className="sv-version">
              <strong>{version.name}</strong>
              <span>
                {scopeLabel(version.rates)}
                {range
                  ? ` · ${formatRate(range.from, range.currency)}–${formatRate(range.to, range.currency)}`
                  : ''}
              </span>
              {version.summary && <p>{version.summary}</p>}
            </div>

            <div className="sv-row">
              <div className="field">
                <label htmlFor="sv_company">Operator</label>
                <select
                  id="sv_company"
                  value={company}
                  onChange={(e) => {
                    setCompany(e.target.value)
                    setContactChoice(null)
                  }}
                >
                  <option value="">Select a company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sv_contact">Send to</label>
                <select
                  id="sv_contact"
                  value={contactId}
                  disabled={!company}
                  onChange={(e) => setContactChoice(e.target.value)}
                >
                  <option value="">Select a contact</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                      {c.email ? ` — ${c.email}` : ' (no email)'}
                    </option>
                  ))}
                </select>
                {company && contacts.length === 0 && (
                  <p className="field-hint">
                    {companyName} has no contacts yet — add one on its page first.
                  </p>
                )}
              </div>
            </div>

            {previous.length > 0 && (
              <p className="sv-warn">
                {companyName} has already been sent this sheet {previous.length}{' '}
                {previous.length === 1 ? 'time' : 'times'}. Sending again issues a new link; the old
                one keeps working.
              </p>
            )}

            <div className="field">
              <label htmlFor="sv_subject">Subject</label>
              <input id="sv_subject" value={subject} onChange={(e) => setSubjectDraft(e.target.value)} />
            </div>

            <div className="field">
              <label htmlFor="sv_template">Template</label>
              <select
                id="sv_template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">Standard rates email</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                Placeholders filled on send: {PLACEHOLDERS.join(', ')}
              </p>
            </div>

            <div className="field">
              <label htmlFor="sv_note">Internal note</label>
              <input
                id="sv_note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Only the team sees this — why this operator, what they asked for"
              />
            </div>

            <div className="field">
              <label>Add services from the rate card (optional)</label>
              {rateCard.length === 0 ? (
                <p className="field-hint">
                  No service rate card items yet. Add them on the STO page's Settings tab and they
                  will be offered here.
                </p>
              ) : (
                <>
                  <div className="sv-extras">
                    {rateCard.map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={selectedItems.has(item.id)}
                          onChange={() =>
                            setSelectedItems((prev) => {
                              const next = new Set(prev)
                              if (next.has(item.id)) next.delete(item.id)
                              else next.add(item.id)
                              return next
                            })
                          }
                        />
                        <span>
                          <strong>{item.service_name}</strong> —{' '}
                          {formatRate(item.price, item.currency)}
                          {item.unit ? ` (${item.unit})` : ''}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="field-hint">
                    Printed under the season's rates, for a client being quoted services as well.
                  </p>
                </>
              )}
            </div>

            {documents.length > 0 && (
              <div className="field">
                <label htmlFor="sv_pdf">Price list PDF (optional)</label>
                <select
                  id="sv_pdf"
                  value={documentId}
                  onChange={(e) => setDocumentId(e.target.value)}
                >
                  <option value="">Don't include one</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}.pdf{d.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
                <p className="field-hint">
                  A link to the file goes in the message — email cannot carry an attachment from
                  here. The agreement's own rates are in the body either way.
                </p>
              </div>
            )}

            <div className="field">
              <label>Message</label>
              <pre className="sv-preview">{preview}</pre>
              <p className="field-hint">
                {mail === null
                  ? 'Checking how this will be sent…'
                  : mail.configured
                    ? `Sent by the CRM from ${mail.from}. Delivery, opens and bounces come back on their own${
                        mail.replyTo ? `, and any reply goes to ${mail.replyTo}` : ''
                      }.`
                    : 'Opens in your own mail client — the CRM records the send but cannot see delivery. See “Connecting email” in the README to change that.'}
              </p>
            </div>

            {error && <p className="version-error">{error}</p>}

            <div className="version-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !company || !contact?.email}
                onClick={handleSend}
              >
                {busy
                  ? 'Sending…'
                  : mail?.configured
                    ? 'Send the agreement'
                    : 'Open email and record send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
