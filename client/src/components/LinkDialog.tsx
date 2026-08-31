import { useState, useEffect } from 'react';
import { useT } from '@/i18n';
import { isUnsafeUrl } from '@/utils/markdown';
import './LinkDialog.css';

interface LinkDialogProps {
  open: boolean;
  onClose: () => void;
  onInsert: (label: string, url: string) => void;
}

export function LinkDialog({ open, onClose, onInsert }: LinkDialogProps) {
  const t = useT();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (open) { setLabel(''); setUrl(''); setError(false); }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const u = url.trim();
    if (!u || isUnsafeUrl(u)) { setError(true); return; }
    onInsert(label.trim(), u);
    onClose();
  };

  // onMouseDown, а не onClick: диалог живёт внутри композера, и клик по
  // подложке не должен успеть увести фокус из textarea до закрытия.
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal link-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <label className="link-dialog-field">
          <span>{t('chat.linkText')}</span>
          <input className="input" value={label} onChange={(e) => { setLabel(e.target.value); setError(false); }} autoFocus />
        </label>
        <label className="link-dialog-field">
          <span>{t('chat.linkUrl')}</span>
          <input
            className={`input${error ? ' is-invalid' : ''}`}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(false); }}
            placeholder="https://"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          />
        </label>
        {error && <p className="modal-error">{t('chat.linkUrlInvalid')}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t('chat.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={submit}>{t('chat.insert')}</button>
        </div>
      </div>
    </div>
  );
}
