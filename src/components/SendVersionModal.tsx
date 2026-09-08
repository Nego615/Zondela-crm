import { useEffect, useMemo, useState } from 'react'
import { useCompanies, useContacts, useOrgSettings, useTemplates } from '../hooks/useCrmData'
import { useAgreementSends, useStoVersions, agreementLink } from '../hooks/useStoVersions'
import { invalidate } from '../hooks/sharedResource'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { emailStatus, sendRecordedEmail } from '../lib/email'
import {
  DEFAULT_AGREEMENT_TEMPLATE,
  fillTemplate,
  formatRate,
  rateRange,
  scopeLabel,
  templateToText,
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
 * company's page the operator is known and the agreement is chosen here, out of
 * the active ones. Either way it is the same send, recorded once.
 *
 * The message itself is not up for editing: the subject is the season and the
 * body is the contract. What can be added is one personal line above it, which
 * is the part that differs from operator to operator.
 */
export default function SendVersionModal({
  version: fixedVersion,
  companyId,
  onClose,
  onSent,
}: Props) {
  const { companies } = useCompanies()
  const { settings } = useOrgSettings()
  const { templates } = useTemplates()
  const { sends, createSend } = useAgreementSends()
  const { versions, loading: versionsLoading } = useStoVersions()
  const { profile } = useAuth()

  /**
   * Active sheets only, newest season first.
   *
   * A draft is unfinished and an archived one has been replaced; neither is a
   * thing to put in front of an operator. The STO page can still send either,
   * because there the sheet was chosen deliberately and handed in.
   */
  const choices = useMemo(
    () => versions.filter((v) => v.status === 'active').sort((a, b) => b.year - a.year),
    [versions]
  )

  const [versionChoice, setVersionChoice] = useState<string | null>(null)
  const version =
    fixedVersion ??
    (versionChoice ? versions.find((v) => v.id === versionChoice) : undefined) ??
    choices[0]

  const [company, setCompany] = useState(companyId ?? '')
  const { contacts } = useContacts(company || undefined)

  // Nothing is pre-picked: a send goes to a person, and which person is the
  // decision being made here rather than one to be defaulted past.
  const [contactId, setContactId] = useState('')
  const contact = contacts.find((c) => c.id === contactId)
  const companyName = companies.find((c) => c.id === company)?.name ?? ''

  /**
   * The addresses this can go to: the contact's own first, then anyone else on
   * file at the company.
   *
   * A contact holds one address, but an operator's reservations desk is often
   * the one that answers, so the others are offered rather than hidden.
   */
  const emailOptions = useMemo(() => {
    if (!contact) return []
    const seen = new Set<string>()
    const options: { email: string; label: string }[] = []
    for (const c of [contact, ...contacts.filter((x) => x.id !== contact.id)]) {
      const email = c.email?.trim()
      if (!email || seen.has(email.toLowerCase())) continue
      seen.add(email.toLowerCase())
      options.push({ email, label: c.id === contact.id ? email : `${email} — ${c.full_name}` })
    }
    return options
  }, [contact, contacts])

  const [emailChoice, setEmailChoice] = useState<string | null>(null)
  const toEmail = emailChoice ?? emailOptions[0]?.email ?? ''

  const [customMessage, setCustomMessage] = useState('')
  const [followUpAt, setFollowUpAt] = useState('')
  const [showPreview, setShowPreview] = useState(false)
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

  /**
   * The wording, and where it comes from.
   *
   * A row marked default in the Templates tab wins, so the team rewords the
   * covering email without a deploy. The built-in below is what a fresh
   * install sends until someone writes one — same text as the seeded row, so
   * the two never disagree.
   */
  const template = useMemo(() => {
    const chosen = templates.find((t) => t.is_default)
    return chosen
      ? { id: chosen.id, subject: chosen.subject, body: templateToText(chosen.body_html) }
      : { id: null as string | null, ...DEFAULT_AGREEMENT_TEMPLATE }
  }, [templates])

  const orgName = settings?.org_name || 'Zondela House'

  // Everything a placeholder stands for except the link, which is minted per
  // send and so is passed in at the point the body is built.
  const values = {
    contactName: contact?.full_name?.split(' ')[0] || 'there',
    companyName,
    orgName,
    year: version?.year ?? '',
    versionName: version?.name ?? '',
    senderName: profile?.full_name || orgName,
  }

  // A subject has no link in it, so it can be filled once here.
  const subject = fillTemplate(template.subject, { ...values, link: '' }).trim()

  const range = version ? rateRange(version.rates) : null

  // Already sent this season's sheet to this operator? Sending again is
  // legitimate — a contact changes, a link is lost — but doing it unknowingly
  // is not, so the modal says so before the button is pressed.
  const previous = sends.filter((s) => s.version_id === version?.id && s.company_id === company)

  /**
   * The message, with the link left as a placeholder until there is one.
   *
   * The personal line sits under the salutation rather than above it: a note
   * before "Dear —" reads as a second letter stapled to the front.
   */
  const compose = (link: string) => {
    if (!version) return ''

    const signature = [
      'Kind regards,',
      profile?.full_name || orgName,
      settings?.email_signature || '',
    ]
      .filter(Boolean)
      .join('\n')

    const filled = fillTemplate(template.body, { ...values, link })
    const personal = customMessage.trim()

    // The personal line goes under the salutation, not above it: a note before
    // "Dear —" reads as a second letter stapled to the front. The template's
    // first line is that salutation, so the note follows it.
    const [salutation, ...rest] = filled.split('\n')

    return [
      salutation,
      '',
      ...(personal ? [personal, ''] : []),
      ...rest,
      '',
      signature,
    ]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  const preview = useMemo(
    () => compose('[the operator’s own agreement link]'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contact, companyName, version, profile, settings, customMessage, template]
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
    if (!contact) {
      setError('Choose the person this is going to.')
      return
    }
    if (!toEmail) {
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
        to_email: toEmail,
        subject,
        sent_by: profile?.id ?? null,
        note: customMessage.trim() || null,
        follow_up_at: followUpAt || null,
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
            template_id: template.id,
            subject,
            body,
            to_name: contact.full_name,
            to_email: toEmail,
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
            to: toEmail,
            subject,
            body,
          })
        : // No row to send from — hand it to the mail client, which needs
          // nothing from the database.
          (openMailClientFallback(toEmail, subject, body),
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
          <h2>{fixedVersion ? `Send ${fixedVersion.name}` : 'Send STO Agreement'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {!version ? (
          <div className="sv-done">
            <h3>{versionsLoading ? 'Loading agreements…' : 'No active agreement to send'}</h3>
            {!versionsLoading && (
              <p>
                A rate sheet is one season's rates — room types, seasons and what each costs. Publish
                one on the STO page and mark it active, and it can be sent from here.
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
            <div className="field">
              <label htmlFor="sv_company">Company</label>
              {companyId ? (
                // Fixed: this modal was opened from the company's own page, and
                // changing who it goes to there would be a different errand.
                <input id="sv_company" value={companyName} readOnly />
              ) : (
                <select
                  id="sv_company"
                  value={company}
                  onChange={(e) => {
                    setCompany(e.target.value)
                    setContactId('')
                    setEmailChoice(null)
                  }}
                >
                  <option value="">Choose company</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field">
              <label htmlFor="sv_contact">Contact person</label>
              <select
                id="sv_contact"
                value={contactId}
                disabled={!company}
                onChange={(e) => {
                  setContactId(e.target.value)
                  setEmailChoice(null)
                }}
              >
                <option value="">Choose contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                    {c.is_primary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
              {company && contacts.length === 0 && (
                <p className="field-hint">
                  {companyName} has no contacts yet — add one on its page first.
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor="sv_email">Email address</label>
              <select
                id="sv_email"
                value={toEmail}
                disabled={!contact || emailOptions.length === 0}
                onChange={(e) => setEmailChoice(e.target.value)}
              >
                {!contact ? (
                  <option value="">Choose contact first</option>
                ) : emailOptions.length === 0 ? (
                  <option value="">No email on file</option>
                ) : (
                  emailOptions.map((o) => (
                    <option key={o.email} value={o.email}>
                      {o.label}
                    </option>
                  ))
                )}
              </select>
              {contact && emailOptions.length === 0 && (
                <p className="field-hint">
                  Add an address for {contact.full_name} on the company page, and this can go out.
                </p>
              )}
            </div>

            {!fixedVersion && (
              <div className="field">
                <label htmlFor="sv_version">Agreement version (Active only)</label>
                <select
                  id="sv_version"
                  value={version.id}
                  onChange={(e) => setVersionChoice(e.target.value)}
                >
                  {choices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {v.year}
                    </option>
                  ))}
                </select>
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

            {previous.length > 0 && (
              <p className="sv-warn">
                {companyName} has already been sent this sheet {previous.length}{' '}
                {previous.length === 1 ? 'time' : 'times'}. Sending again issues a new link; the old
                one keeps working.
              </p>
            )}

            <div className="field">
              <label htmlFor="sv_message">Optional custom message</label>
              <textarea
                id="sv_message"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                placeholder="Optional personal note added above the standard message."
                rows={4}
              />
            </div>

            <div className="field">
              <label htmlFor="sv_followup">Follow-up date</label>
              <input
                id="sv_followup"
                type="date"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
              />
              <p className="field-hint">
                Optional. The date this send comes back around on the STO page, if the operator has
                not answered by then.
              </p>
            </div>

            <div className="sv-fold">
              <button
                type="button"
                className="sv-fold-head"
                onClick={() => setShowPreview((v) => !v)}
                aria-expanded={showPreview}
              >
                <span>Email preview</span>
                <span className="sv-fold-toggle">{showPreview ? 'Hide' : 'Show'}</span>
              </button>
              {showPreview && (
                <div className="sv-fold-body">
                  <p className="sv-fold-subject">
                    <strong>Subject:</strong> {subject}
                  </p>
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
              )}
            </div>

            {error && <p className="version-error">{error}</p>}

            <div className="version-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || !company || !contact || !toEmail}
                onClick={handleSend}
              >
                {busy ? 'Sending…' : mail?.configured ? 'Send agreement' : 'Open email and record send'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
