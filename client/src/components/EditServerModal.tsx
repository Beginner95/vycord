import { useState } from 'react';
import { X } from 'lucide-react';
import type { Server } from '@/types';
import { AvatarCropModal } from '@/components/AvatarCropModal';
import { EditServerBody, uploadServerIcon } from '@/components/EditServerBody';
import { useT } from '@/i18n';
import './EditServerModal.css';

interface EditServerModalProps {
  server: Server;
  onClose: () => void;
}

export function EditServerModal({ server, onClose }: EditServerModalProps) {
  const t = useT();
  // Окно кропа — СЕСТРА оверлея (корень — фрагмент), а не потомок .modal:
  // иначе stopPropagation модалки менял бы поведение клика по его фону.
  // Поэтому им и загрузкой владеет оболочка, а не тело.
  const [cropFile, setCropFile] = useState<File | null>(null);

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="modal-title">{t('server.editTitle')}</h2>
            <button
              type="button"
              className="modal-close-btn"
              title={t('common.close')}
              aria-label={t('common.close')}
              onClick={onClose}
            >
              <X size={16} strokeWidth={1.8} />
            </button>
          </div>

          <EditServerBody
            server={server}
            onDone={onClose}
            onCropFile={setCropFile}
            renderActions={({ saving }) => (
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={onClose}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? t('common.saving') : t('common.save')}
                </button>
              </div>
            )}
          />
        </div>
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          title={t('server.cropIconTitle')}
          onCancel={() => setCropFile(null)}
          onUpload={async (blob) => {
            await uploadServerIcon(server.id, blob);
            setCropFile(null);
          }}
        />
      )}
    </>
  );
}
