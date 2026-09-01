import { useState, type FormEvent } from 'react'
import { useRateCard } from '../hooks/useCrmData'
import PricingDocuments from '../components/PricingDocuments'
import '../components/ui.css'

export default function RateCard() {
  const { items, loading, createItem, updateItem, deleteItem } = useRateCard()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [serviceName, setServiceName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('TZS')
  const [unit, setUnit] = useState('per month')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function resetForm() {
    setServiceName('')
    setDescription('')
    setPrice('')
    setCurrency('TZS')
    setUnit('per month')
    setEditingId(null)
    setError(null)
  }

  function startEdit(item: (typeof items)[number]) {
    setEditingId(item.id)
    setServiceName(item.service_name)
    setDescription(item.description ?? '')
    setPrice(String(item.price))
    setCurrency(item.currency)
    setUnit(item.unit ?? '')
    setShowForm(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!serviceName.trim() || !price) {
      setError('Service name and price are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        service_name: serviceName.trim(),
        description: description.trim() || null,
        price: parseFloat(price),
        currency,
        unit: unit.trim() || null,
        sort_order: items.length,
      }
      if (editingId) {
        await updateItem(editingId, payload)
      } else {
        await createItem(payload)
      }
      resetForm()
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this item.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>STO rate card</h1>
          <p>The price list used when sharing pricing with a company.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
        >
          + Add item
        </button>
      </div>

      <PricingDocuments />

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading rate card…</p>
      ) : items.length === 0 ? (
        <div className="empty-state card">
          <h3>No pricing items yet</h3>
          <p>Add your STO services and prices to build the rate card.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Description</th>
                <th>Price</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{item.service_name}</td>
                  <td style={{ color: 'var(--text-soft)' }}>{item.description || '—'}</td>
                  <td>
                    {item.currency} {item.price.toLocaleString()}
                    {item.unit ? ` / ${item.unit.replace('per ', '')}` : ''}
                  </td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        background: item.active ? 'var(--stage-won-bg)' : 'var(--paper-dim)',
                        color: item.active ? 'var(--stage-won)' : 'var(--text-muted)',
                      }}
                    >
                      {item.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => startEdit(item)}>
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => updateItem(item.id, { active: !item.active })}
                      >
                        {item.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          if (confirm(`Remove ${item.service_name} from the rate card?`)) await deleteItem(item.id)
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Edit rate card item' : 'Add rate card item'}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>
                Close
              </button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="field">
                <label htmlFor="r_name">Service name</label>
                <input id="r_name" value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder="STO Growth" />
              </div>
              <div className="field">
                <label htmlFor="r_desc">Description</label>
                <textarea id="r_desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's included" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <div className="field">
                  <label htmlFor="r_price">Price</label>
                  <input id="r_price" type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="650000" />
                </div>
                <div className="field">
                  <label htmlFor="r_currency">Currency</label>
                  <input id="r_currency" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="TZS" />
                </div>
                <div className="field">
                  <label htmlFor="r_unit">Unit</label>
                  <input id="r_unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="per month" />
                </div>
              </div>

              {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn" onClick={() => setShowForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Add item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
