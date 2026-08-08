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

  return (
    <div className="link-dialog-backdrop" onMouseDown={onClose}>
      <div className="link-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <label className="link-dialog-field">
          <span>{t('chat.linkText')}</span>
          <input value={label} onChange={(e) => { setLabel(e.target.value); setError(false); }} autoFocus />
        </label>
        <label className="link-dialog-field">
          <span>{t('chat.linkUrl')}</span>
          <input
            className={error ? 'error' : ''}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(false); }}
            placeholder="https://"
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onClose(); }}
          />
        </label>
        {error && <div className="link-dialog-error">{t('chat.linkUrlInvalid')}</div>}
        <div className="link-dialog-actions">
          <button type="button" className="link-dialog-cancel" onClick={onClose}>{t('chat.cancel')}</button>
          <button type="button" className="link-dialog-submit" onClick={submit}>{t('chat.insert')}</button>
        </div>
      </div>
    </div>
  );
}
