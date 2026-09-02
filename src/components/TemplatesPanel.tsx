import { useState, type FormEvent } from 'react'
import { useTemplates } from '../hooks/useCrmData'
import { useAuth } from '../hooks/useAuth'
import type { EmailTemplate, TemplateCategory } from '../lib/database.types'
import './ui.css'
import './templates.css'

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  general: 'General',
  pricing: 'Pricing / STO',
  follow_up: 'Follow-up',
  proposal: 'Proposal',
}

/**
 * Email templates, as one tab of the STO page.
 *
 * They used to be their own top-level section, but the only thing that reads
 * them is the agreement send modal — so they live next to what uses them now,
 * alongside the rate card and the branding they are composed with.
 */
export default function TemplatesPanel() {
  const { templates, loading, createTemplate, updateTemplate, deleteTemplate } = useTemplates()
  const { profile } = useAuth()
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null)
  const [preview, setPreview] = useState<EmailTemplate | null>(null)

  return (
    <div>
      <div className="panel-header">
        <div>
          <h2>Email templates</h2>
          <p>
            Reusable openings the team personalises per contact. They show up in the send modal
            when an agreement goes out.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          + New template
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-soft)' }}>Loading templates…</p>
      ) : templates.length === 0 ? (
        <div className="empty-state card">
          <h3>No templates yet</h3>
          <p>Create your first email template for proposals or follow-ups.</p>
        </div>
      ) : (
        <div className="template-grid">
          {templates.map((t) => (
            <div key={t.id} className="card template-card">
              <div className="template-card-top">
                <span
                  className="badge"
                  style={{ background: 'var(--stage-lead-bg)', color: 'var(--stage-lead)' }}
                >
                  {CATEGORY_LABELS[t.category]}
                </span>
              </div>
              <h3 className="template-card-name">{t.name}</h3>
              <p className="template-card-subject">{t.subject}</p>
              <p className="template-card-preview">{t.body_html.replace(/<[^>]+>/g, '').slice(0, 120)}…</p>
              <div className="template-card-actions">
                <button className="btn btn-sm" onClick={() => setPreview(t)}>
                  Preview
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(t)}>
                  Edit
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    if (confirm(`Delete template "${t.name}"?`)) await deleteTemplate(t.id)
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditorModal
          template={editing === 'new' ? undefined : editing}
          createdBy={profile?.id}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
          createTemplate={createTemplate}
          updateTemplate={updateTemplate}
        />
      )}

      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{preview.name}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>
                Close
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Subject</p>
            <p style={{ fontWeight: 600, marginBottom: 16 }}>{preview.subject}</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Body</p>
            <div className="template-preview-body" dangerouslySetInnerHTML={{ __html: preview.body_html }} />
          </div>
        </div>
      )}
    </div>
  )
}

interface EditorProps {
  template?: EmailTemplate
  createdBy?: string
  onClose: () => void
  onSaved: () => void
  createTemplate: (input: Partial<EmailTemplate>) => Promise<EmailTemplate>
  updateTemplate: (id: string, input: Partial<EmailTemplate>) => Promise<void>
}

function TemplateEditorModal({ template, createdBy, onClose, onSaved, createTemplate, updateTemplate }: EditorProps) {
  const [name, setName] = useState(template?.name ?? '')
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [category, setCategory] = useState<TemplateCategory>(template?.category ?? 'general')
  const [body, setBody] = useState(template?.body_html ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !subject.trim() || !body.trim()) {
      setError('Name, subject, and body are all required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = { name: name.trim(), subject: subject.trim(), body_html: body.trim(), category, created_by: createdBy }
      if (template) {
        await updateTemplate(template.id, payload)
      } else {
        await createTemplate(payload)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save template.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{template ? 'Edit template' : 'New template'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <div className="field">
              <label htmlFor="t_name">Template name</label>
              <input id="t_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="STO proposal — first outreach" />
            </div>
            <div className="field">
              <label htmlFor="t_category">Category</label>
              <select id="t_category" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label htmlFor="t_subject">Subject line</label>
            <input id="t_subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your SEO / STO proposal from Zondela" />
          </div>
          <div className="field">
            <label htmlFor="t_body">Body</label>
            <textarea
              id="t_body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the template. Basic HTML tags like <p>, <b>, <br> are supported for formatting."
              style={{ minHeight: 200, fontFamily: 'var(--font-body)' }}
            />
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : template ? 'Save changes' : 'Create template'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
