import { useMemo, useState, type FormEvent } from 'react'
import {
  useCompanies,
  useContacts,
  useRateCard,
  useStoAgreements,
  type AgreementLineInput,
} from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import { agreementTotals, formatMoney, lineTotal, toDateInput } from '../lib/agreement'
import type { StoAgreementWithItems } from '../lib/database.types'
import './ui.css'
import './agreement-form.css'

/** A line while it is being edited: numbers stay strings until save. */
interface DraftLine {
  key: string
  rate_card_item_id: string | null
  service_name: string
  description: string
  unit: string
  quantity: string
  unit_price: string
}

interface Props {
  /** Editing an existing agreement; omit to build a new one. */
  agreement?: StoAgreementWithItems
  /** Pre-selects the company; still changeable in the form. */
  companyId?: string
  onClose: () => void
  onSaved: () => void
}

const newKey = () => crypto.randomUUID()

const blankLine = (): DraftLine => ({
  key: newKey(),
  rate_card_item_id: null,
  service_name: '',
  description: '',
  unit: 'per month',
  quantity: '1',
  unit_price: '',
})

export default function AgreementFormModal({ agreement, companyId, onClose, onSaved }: Props) {
  const { companies } = useCompanies()
  const { items: rateCard } = useRateCard()
  const { createAgreement, updateAgreement } = useStoAgreements()
  const { profile } = useAuth()

  const [company, setCompany] = useState(agreement?.company_id ?? companyId ?? '')
  // Contacts belong to the chosen company, so this re-fetches whenever it
  // changes and a contact picked for the previous company falls out below.
  const { contacts } = useContacts(company || undefined)

  const [contactId, setContactId] = useState(agreement?.contact_id ?? '')
  const [title, setTitle] = useState(agreement?.title ?? '')
  const [currency, setCurrency] = useState(agreement?.currency ?? 'TZS')
  const [discount, setDiscount] = useState(String(agreement?.discount_percent ?? 0))
  const [startsOn, setStartsOn] = useState(toDateInput(agreement?.starts_on ?? null))
  const [validUntil, setValidUntil] = useState(toDateInput(agreement?.valid_until ?? null))
  const [terms, setTerms] = useState(agreement?.terms ?? '')
  const [notes, setNotes] = useState(agreement?.notes ?? '')
  const [lines, setLines] = useState<DraftLine[]>(
    agreement && agreement.items.length > 0
      ? agreement.items.map((i) => ({
          key: i.id,
          rate_card_item_id: i.rate_card_item_id,
          service_name: i.service_name,
          description: i.description ?? '',
          unit: i.unit ?? '',
          quantity: String(i.quantity),
          unit_price: String(i.unit_price),
        }))
      : [blankLine()]
  )

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const contactStillValid = contacts.some((c) => c.id === contactId)

  const parsedLines = useMemo(
    () =>
      lines.map((l) => ({
        quantity: parseFloat(l.quantity) || 0,
        unit_price: parseFloat(l.unit_price) || 0,
      })),
    [lines]
  )
  const totals = agreementTotals(parsedLines, parseFloat(discount) || 0)

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  /**
   * Copies the rate card row into the line rather than pointing at it: the
   * price on an agreement is fixed when it is built and must survive the rate
   * card being repriced afterwards.
   */
  function addFromRateCard(rateCardId: string) {
    const item = rateCard.find((i) => i.id === rateCardId)
    if (!item) return
    setLines((prev) => [
      // A single untouched blank line is scaffolding, not content — drop it
      // rather than leaving an empty row above the one just added.
      ...prev.filter((l) => l.service_name.trim() || l.unit_price.trim()),
      {
        key: newKey(),
        rate_card_item_id: item.id,
        service_name: item.service_name,
        description: item.description ?? '',
        unit: item.unit ?? '',
        quantity: '1',
        unit_price: String(item.price),
      },
    ])
    setCurrency(item.currency)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    if (!company) return setError('Choose the company this agreement is for.')
    if (!title.trim()) return setError('Give the agreement a title.')

    // Blank rows are how an empty line looks in the builder, so they are
    // dropped rather than rejected; anything half-filled is a real mistake.
    const filled = lines.filter((l) => l.service_name.trim())
    if (filled.length === 0) return setError('Add at least one service line.')
    if (filled.some((l) => !(parseFloat(l.quantity) > 0)))
      return setError('Every line needs a quantity above zero.')
    if (filled.some((l) => !(parseFloat(l.unit_price) >= 0)))
      return setError('Every line needs a price.')

    const linePayload: AgreementLineInput[] = filled.map((l) => ({
      rate_card_item_id: l.rate_card_item_id,
      service_name: l.service_name.trim(),
      description: l.description.trim() || null,
      unit: l.unit.trim() || null,
      quantity: parseFloat(l.quantity),
      unit_price: parseFloat(l.unit_price),
    }))

    const header = {
      company_id: company,
      contact_id: contactStillValid && contactId ? contactId : null,
      title: title.trim(),
      currency: currency.trim() || 'TZS',
      discount_percent: parseFloat(discount) || 0,
      starts_on: startsOn || null,
      valid_until: validUntil || null,
      terms: terms.trim() || null,
      notes: notes.trim() || null,
    }

    setSaving(true)
    setError(null)
    try {
      if (agreement) {
        await updateAgreement(agreement.id, header, linePayload)
      } else {
        // status is spelled out rather than left to the column default: the
        // button says "Save as draft", and the row that comes back is used
        // immediately without a re-read.
        //
        // created_by is what keeps a draft visible to its author if the
        // company is later reassigned to another rep.
        await createAgreement(
          { ...header, status: 'draft', created_by: profile?.id ?? null },
          linePayload
        )
      }
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this agreement.')
    } finally {
      setSaving(false)
    }
  }

  const activeRateCard = rateCard.filter((i) => i.active)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal agreement-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{agreement ? `Edit ${agreement.reference}` : 'Build STO agreement'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="agreement-row">
            <div className="field">
              <label htmlFor="a_company">Company</label>
              <select
                id="a_company"
                value={company}
                onChange={(e) => {
                  setCompany(e.target.value)
                  setContactId('')
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
              <label htmlFor="a_contact">Signing contact</label>
              <select
                id="a_contact"
                value={contactStillValid ? contactId : ''}
                onChange={(e) => setContactId(e.target.value)}
                disabled={!company}
              >
                <option value="">No contact yet</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                    {c.job_title ? ` — ${c.job_title}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="a_title">Title</label>
            <input
              id="a_title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="STO retainer — 12 months"
            />
          </div>

          <div className="agreement-row">
            <div className="field">
              <label htmlFor="a_start">Starts on</label>
              <input id="a_start" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="a_valid">Quote valid until</label>
              <input id="a_valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              <p className="field-hint">A sent agreement past this date shows as expired.</p>
            </div>
          </div>

          <div className="agreement-lines">
            <div className="agreement-lines-head">
              <label>Services</label>
              <select
                value=""
                aria-label="Add a service from the rate card"
                onChange={(e) => {
                  addFromRateCard(e.target.value)
                  e.target.value = ''
                }}
              >
                <option value="">+ Add from rate card</option>
                {activeRateCard.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.service_name} — {formatMoney(i.price, i.currency)}
                  </option>
                ))}
              </select>
            </div>

            {activeRateCard.length === 0 && (
              <p className="field-hint">
                No active rate card items yet. Add them on the Rate card tab, or type lines in by hand
                below.
              </p>
            )}

            <ul className="agreement-line-list">
              {lines.map((line) => (
                <li key={line.key} className="agreement-line">
                  <div className="agreement-line-main">
                    <input
                      aria-label="Service"
                      value={line.service_name}
                      onChange={(e) => updateLine(line.key, { service_name: e.target.value })}
                      placeholder="Service"
                    />
                    <input
                      aria-label="Quantity"
                      type="number"
                      min="0"
                      step="0.5"
                      value={line.quantity}
                      onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                      placeholder="Qty"
                    />
                    <input
                      aria-label="Unit price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unit_price}
                      onChange={(e) => updateLine(line.key, { unit_price: e.target.value })}
                      placeholder="Price"
                    />
                    <input
                      aria-label="Unit"
                      value={line.unit}
                      onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                      placeholder="per month"
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Remove ${line.service_name || 'line'}`}
                      onClick={() =>
                        setLines((prev) => {
                          const next = prev.filter((l) => l.key !== line.key)
                          // The builder always shows something to type into.
                          return next.length > 0 ? next : [blankLine()]
                        })
                      }
                    >
                      ✕
                    </button>
                  </div>
                  <div className="agreement-line-foot">
                    <input
                      aria-label="Line description"
                      value={line.description}
                      onChange={(e) => updateLine(line.key, { description: e.target.value })}
                      placeholder="What's included on this line (optional)"
                    />
                    <span className="agreement-line-total">
                      {formatMoney(
                        lineTotal({
                          quantity: parseFloat(line.quantity) || 0,
                          unit_price: parseFloat(line.unit_price) || 0,
                        }),
                        currency
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setLines((prev) => [...prev, blankLine()])}
            >
              + Add a custom line
            </button>
          </div>

          <div className="agreement-row">
            <div className="field">
              <label htmlFor="a_currency">Currency</label>
              <input id="a_currency" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="TZS" />
            </div>
            <div className="field">
              <label htmlFor="a_discount">Discount %</label>
              <input
                id="a_discount"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
              />
            </div>
          </div>

          <div className="agreement-totals">
            <div>
              <span>Subtotal</span>
              <span>{formatMoney(totals.subtotal, currency)}</span>
            </div>
            {totals.discount > 0 && (
              <div>
                <span>Discount ({parseFloat(discount) || 0}%)</span>
                <span>− {formatMoney(totals.discount, currency)}</span>
              </div>
            )}
            <div className="agreement-totals-grand">
              <span>Total</span>
              <span>{formatMoney(totals.total, currency)}</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="a_terms">Terms</label>
            <textarea
              id="a_terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="Payment terms, contract length, what the client provides…"
            />
            <p className="field-hint">Goes into the agreement the client receives.</p>
          </div>

          <div className="field">
            <label htmlFor="a_notes">Internal notes</label>
            <textarea
              id="a_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Only the team sees this"
            />
          </div>

          {error && <p className="agreement-error">{error}</p>}

          <div className="agreement-actions">
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : agreement ? 'Save changes' : 'Save as draft'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
