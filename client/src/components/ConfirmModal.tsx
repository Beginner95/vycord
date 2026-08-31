import { useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useT } from '@/i18n';
import { useModalFocus } from '@/hooks/useModalFocus';
import './ConfirmModal.css';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ open, title, body, confirmLabel, onConfirm, onCancel }: ConfirmModalProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(open, ref, onCancel);

  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={(e) => { e.stopPropagation(); onCancel(); }}>
      <div ref={ref} className="confirm-modal" role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-icon">
          <AlertTriangle size={18} strokeWidth={1.8} />
        </div>
        <h3 className="confirm-modal-title">{title}</h3>
        <p className="confirm-modal-body">{body}</p>
        <div className="confirm-modal-actions">
          <button type="button" className="btn btn-secondary" data-autofocus onClick={onCancel}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
