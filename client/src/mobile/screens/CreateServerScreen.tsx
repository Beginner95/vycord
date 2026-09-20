import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { CreateServerForm } from '@/pages/app/CreateServerForm';

/** Спека §5.9. Навигацию после успеха делает не экран: контроллер шлёт
 *  serverOpened, и MobileShell открывает каналы нового сервера. */
export function CreateServerScreen({ onCreate, onBack }: {
  onCreate: (name: string, isPrivate: boolean) => Promise<void>;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <FormScreen title={t('server.create')} onBack={onBack}>
      <CreateServerForm
        onCreate={onCreate}
        renderActions={({ canSubmit }) => (
          <div className="form-screen-actions">
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {t('server.createSubmit')}
            </button>
          </div>
        )}
      />
    </FormScreen>
  );
}
