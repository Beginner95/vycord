import { useRef } from 'react';
import { X } from 'lucide-react';
import type { Server } from '@/types';
import { FindServerBody } from '@/components/FindServerBody';
import { useModalFocus } from '@/hooks/useModalFocus';
import { useT } from '@/i18n';

interface FindServerModalProps {
  open: boolean;
  onClose: () => void;
  onJoinServer: (server: Server) => void;
  onServerJoined: (server: Server) => void;
  onCreateServer: () => void;
}

export function FindServerModal({ open, onClose, onJoinServer, onServerJoined, onCreateServer }: FindServerModalProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(open, ref, onClose);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={ref} className="modal find-server-modal" role="dialog" aria-modal="true" aria-label={t('server.findServer.title')} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{t('server.findServer.title')}</div>
            <p className="modal-sub">{t('server.findServer.description')}</p>
          </div>
          <button type="button" className="modal-close-btn" aria-label={t('common.close')} onClick={onClose}>
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>
        <FindServerBody
          active={open}
          onJoinServer={onJoinServer}
          onServerJoined={onServerJoined}
          onDone={onClose}
          onCreateServer={onCreateServer}
        />
      </div>
    </div>
  );
}
