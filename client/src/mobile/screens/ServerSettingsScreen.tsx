import { useState } from 'react';
import type { Server } from '@/types';
import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { EditServerBody, uploadServerIcon } from '@/components/EditServerBody';
import { AvatarCropModal } from '@/components/AvatarCropModal';
import './ServerSettingsScreen.css';

/** Настройки сервера (спека §5.9). Кроп иконки остаётся модалкой: на мобиле
 *  она — шторка через правило этапа 1 для `.modal-overlay > .modal`, своего CSS
 *  здесь не нужно. Окном кропа и загрузкой владеет экран, а не тело. */
export function ServerSettingsScreen({ server, onBack }: { server: Server; onBack: () => void }) {
  const t = useT();
  const [cropFile, setCropFile] = useState<File | null>(null);
  return (
    <>
      <FormScreen title={t('server.editTitle')} onBack={onBack}>
        <EditServerBody
          server={server}
          onDone={onBack}
          onCropFile={setCropFile}
          autoFocusName={false}
          renderActions={({ saving }) => (
            <div className="form-screen-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          )}
        />
      </FormScreen>
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
