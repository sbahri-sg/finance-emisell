import type { ReactNode } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-actions">{action}</div>}
    </header>
  )
}

export function Badge({ tone = 'neutral', children }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Button({
  children,
  variant = 'primary',
  type = 'button',
  onClick,
  disabled,
}: {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  type?: 'button' | 'submit'
  onClick?: () => void
  disabled?: boolean
}) {
  return <button className={`button button-${variant}`} type={type} onClick={onClick} disabled={disabled}>{children}</button>
}

export function Modal({ title, description, onClose, children, className = '' }: { title: string; description?: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Tutup"><X size={19} /></button>
        </header>
        {children}
      </section>
    </div>
  )
}

export function ConfirmActionModal({
  open,
  title,
  description = 'Konfirmasi diperlukan sebelum melanjutkan',
  subject,
  detail,
  note,
  confirmLabel,
  busy = false,
  error = '',
  tone = 'danger',
  onClose,
  onConfirm,
}: {
  open: boolean
  title: string
  description?: string
  subject: string
  detail: string
  note: string
  confirmLabel: string
  busy?: boolean
  error?: string
  tone?: 'danger' | 'warning'
  onClose: () => void
  onConfirm: () => void
}) {
  if (!open) return null
  const Icon = tone === 'danger' ? Trash2 : AlertTriangle
  return (
    <Modal title={title} description={description} onClose={() => !busy && onClose()}>
      {error && <div className="auth-error delete-confirmation-error">{error}</div>}
      <div className={`delete-confirmation ${tone === 'warning' ? 'warning' : ''}`}>
        <span className="delete-confirmation-icon"><Icon size={25} /></span>
        <div><strong>{subject}</strong><p>{detail}</p></div>
      </div>
      <div className="delete-confirmation-note"><AlertTriangle size={17} /><span>{note}</span></div>
      <div className="modal-actions delete-confirmation-actions">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Batal</Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
          <Icon size={15} /> {busy ? 'Memproses…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><strong>{title}</strong><span>{description}</span></div>
}
