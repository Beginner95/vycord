import { useCallback } from 'react';
import { apiService, ApiError } from '@/services/api';
import { useAttachmentStore, type DraftAttachment } from '@/stores/attachmentStore';
import { logger } from '@/utils/logger';

// ВНИМАНИЕ: это вторая, захардкоденная копия лимита — на сервере он живёт в
// таблице plans, чтобы платный тариф поднимался без правок кода. Пока клиент
// про тарифы не знает (по ТЗ задел на подписки делается только на бэке), это
// приемлемо. Когда платные планы появятся, эту константу обязательно заменить
// на эффективный лимит, приходящий с сервера в данных пользователя, — иначе
// клиент отвергнет файл, который сервер принял бы, и платный тариф не заработает.
const HARD_MAX_BYTES = 25 * 1024 * 1024;

// Стабильная ссылка обязательна: Zustand v5 сравнивает снимок селектора по
// ссылке через useSyncExternalStore, и свежий [] при каждом вызове даёт
// бесконечную перерисовку. До появления тестов с настоящим React это было
// не видно — хук никто не монтировал.
const EMPTY_DRAFTS: DraftAttachment[] = [];

export function useAttachmentUpload(channelId: string | undefined) {
  const drafts = useAttachmentStore((s) => (channelId ? s.drafts.get(channelId) ?? EMPTY_DRAFTS : EMPTY_DRAFTS));
  const add = useAttachmentStore((s) => s.add);
  const update = useAttachmentStore((s) => s.update);
  const removeDraft = useAttachmentStore((s) => s.remove);
  const clearDrafts = useAttachmentStore((s) => s.clear);

  const startUpload = useCallback(
    (chan: string, localId: string, file: File) => {
      const handle = apiService.uploadAttachment(chan, file, {
        onProgress: (percent) => update(chan, localId, { progress: percent }),
      });

      handle.promise
        .then((attachment) => update(chan, localId, { status: 'done', progress: 100, attachment }))
        .catch((err: unknown) => {
          if (err instanceof ApiError && err.code === 'upload_aborted') return;
          logger.error('Attachment upload failed', err, { module: 'chat' });
          update(chan, localId, {
            status: 'error',
            errorCode: err instanceof ApiError ? err.code : undefined,
          });
        });

      return handle.abort;
    },
    [update],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (!channelId) return;
      for (const file of Array.from(files)) {
        const localId = crypto.randomUUID();

        if (file.size > HARD_MAX_BYTES) {
          add(channelId, {
            localId, file, status: 'error', progress: 0,
            errorCode: 'attachment_too_large', abort: () => {},
          } satisfies DraftAttachment);
          continue;
        }

        const abort = startUpload(channelId, localId, file);
        add(channelId, { localId, file, status: 'uploading', progress: 0, abort });
      }
    },
    [channelId, add, startUpload],
  );

  const cancel = useCallback(
    (localId: string) => {
      if (!channelId) return;
      const draft = useAttachmentStore.getState().getDrafts(channelId).find((d) => d.localId === localId);
      draft?.abort();
      // Загруженное, но отменённое вложение удаляем сразу: иначе оно осталось
      // бы сиротой до прохода уборщика.
      if (draft?.attachment) {
        // Уборщик на сервере подберёт сироту и сам, но молчаливый провал
        // удаления нечем будет объяснить при разборе.
        apiService.deleteAttachment(draft.attachment.id).catch((err: unknown) => {
          logger.error('Failed to delete cancelled attachment', err, { module: 'chat' });
        });
      }
      removeDraft(channelId, localId);
    },
    [channelId, removeDraft],
  );

  const retry = useCallback(
    (localId: string) => {
      if (!channelId) return;
      const draft = useAttachmentStore.getState().getDrafts(channelId).find((d) => d.localId === localId);
      if (!draft) return;
      // Файл, не прошедший проверку размера, запросом не поможешь: nginx
      // оборвёт соединение, и пользователь снова увидит «сеть недоступна»
      // вместо внятной причины. Возвращаем ту же ошибку, не ходя на сервер.
      if (draft.file.size > HARD_MAX_BYTES) {
        update(channelId, localId, { status: 'error', progress: 0, errorCode: 'attachment_too_large' });
        return;
      }
      const abort = startUpload(channelId, localId, draft.file);
      update(channelId, localId, { status: 'uploading', progress: 0, errorCode: undefined, abort });
    },
    [channelId, startUpload, update],
  );

  const clear = useCallback(() => {
    if (channelId) clearDrafts(channelId);
  }, [channelId, clearDrafts]);

  return {
    drafts,
    addFiles,
    cancel,
    retry,
    clear,
    /** Готовые к отправке вложения — их id уходят вместе с сообщением. */
    readyIds: drafts.filter((d) => d.attachment).map((d) => d.attachment!.id),
    /** Пока что-то грузится, отправку блокируем: сообщение не должно уйти без файла. */
    isUploading: drafts.some((d) => d.status === 'uploading'),
  };
}
