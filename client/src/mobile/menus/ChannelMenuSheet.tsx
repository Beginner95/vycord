import { useEffect, useRef, useState } from 'react';
import type { Channel } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { can, PERMISSIONS } from '@/utils/permissions';
import { ConfirmModal } from '@/components/ConfirmModal';
import { EditChannelModal } from '@/components/EditChannelModal';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';
import { useChannelMenuItems } from './useChannelMenuItems';

interface ChannelMenuSheetProps {
  channel: Channel | null;
  serverId: string;
  /** Число каналов сервера на момент открытия — для дизейбла пункта. Само
   *  удаление перепроверяет гейт по стору. */
  channelCount: number;
  open: boolean;
  /** Вся интеракция с меню закончена; вызывается ровно один раз за интеракцию
   *  (закрытие sheet'а без выбора, конец переименования, отмена, конец
   *  удаления, конец показа ошибки, пустое меню). Хост обязан держать сущность
   *  смонтированной (через `open`) до вызова onClose: тост ошибки живёт внутри
   *  этого компонента. */
  onClose: () => void;
  onDeleted?: (channelId: string) => void;
}

type Flow = 'none' | 'rename' | 'confirm' | 'error';

const ERROR_MS = 5000;

/** Мобильный аналог контекстного меню канала в ChannelSidebar: ActionSheet
 *  вместо ContextMenu, те же права, тот же гейт последнего канала, тот же
 *  EditChannelModal / ConfirmModal. */
export function ChannelMenuSheet(props: ChannelMenuSheetProps) {
  // Гейт снаружи: ни одного хука до проверки (правила хуков целы).
  if (!props.channel) return null;
  return <Body {...props} channel={props.channel} />;
}

function Body({ channel, serverId, channelCount, open, onClose, onDeleted }: ChannelMenuSheetProps & { channel: Channel }) {
  const t = useT();
  const perms = useServerStore((s) => s.permissions.get(serverId));
  const canManage = can(perms, PERMISSIONS.MANAGE_CHANNELS);
  const [flow, setFlow] = useState<Flow>('none');
  const [error, setError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  // Синхронное зеркало flow для отложенных/асинхронных проверок.
  const flowRef = useRef<Flow>('none');
  // Номер запущенного потока: отличает «тот же confirm» от нового после отмены.
  const flowSeq = useRef(0);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Номер потока переименования: EditChannelModal зовёт onClose уже ПОСЛЕ
  // `await updateChannel`, а скрим/Cancel живы во время сохранения.
  const renameSeq = useRef(0);

  const startFlow = (next: Flow) => {
    flowSeq.current += 1;
    if (next === 'rename') renameSeq.current = flowSeq.current;
    flowRef.current = next;
    setFlow(next);
  };
  // Поток закончен: хост узнаёт об этом ровно один раз.
  const endFlow = () => {
    flowRef.current = 'none';
    setFlow('none');
    onCloseRef.current();
  };
  // Закрывалка для EditChannelModal: поздний/повторный вызов от устаревшего
  // потока (пользователь уже закрыл модалку, запрос завершился позже) — игнор.
  const seqAtRender = renameSeq.current;
  const closeRename = () => {
    if (flowRef.current === 'rename' && flowSeq.current === seqAtRender) endFlow();
  };

  // Размонтирование в состоянии 'error' onClose не шлёт: хост сам обнулил
  // сущность, ждать от него подтверждения не нужно.
  useEffect(() => () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  // Ошибка: sheet скрыт, тост виден, onClose хоста — только по истечении показа
  // (иначе хост обнулит сущность и тост исчезнет вместе с Body).
  const showError = (message: string) => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    flowRef.current = 'error';
    setFlow('error');
    setError(message);
    errorTimer.current = setTimeout(() => {
      errorTimer.current = null;
      setError(null);
      endFlow();
    }, ERROR_MS);
  };

  // ActionSheet зовёт onClose() ДО onClick пункта — и при выборе пункта, и при
  // закрытии скримом/свайпом/Escape/системным «назад». Отличить их можно только
  // после onClick, поэтому решение откладывается на микрозадачу: если пункт
  // успел запустить поток, sheet закрыт «в пользу» потока и хосту сообщать
  // нельзя.
  const closeSheet = () => {
    queueMicrotask(() => {
      if (flowRef.current === 'none') onCloseRef.current();
    });
  };

  const items = useChannelMenuItems({
    canManage,
    isLast: channelCount <= 1,
    onRename: () => startFlow('rename'),
    onDelete: onDeleted ? () => startFlow('confirm') : undefined,
  });

  // Пустое меню (нет прав): не показываем пустой sheet с заголовком, а сразу
  // сообщаем хосту. Ref-гард — от повторного вызова при StrictMode/перерендере.
  const emptyReported = useRef(false);
  const empty = items.length === 0;
  useEffect(() => {
    if (!open || !empty || flow !== 'none') {
      emptyReported.current = false;
      return;
    }
    if (emptyReported.current) return;
    emptyReported.current = true;
    onCloseRef.current();
  }, [open, empty, flow]);

  const handleDelete = async () => {
    // Список мог измениться (WS от другого клиента), пока открыто подтверждение —
    // перепроверяем гейт последнего канала по стору, а не по пропу.
    if (useServerStore.getState().channels.length <= 1) {
      showError(t('channel.deleteLastDisabled'));
      return;
    }
    if (deletingRef.current) return;
    deletingRef.current = true;
    const seq = flowSeq.current;
    // Пользователь мог отменить confirm, пока запрос в полёте (у ConfirmModal
    // нет busy-состояния): тогда хост уже закрыт и поток трогать нельзя.
    const stillMine = () => flowRef.current === 'confirm' && flowSeq.current === seq;
    try {
      await apiService.deleteChannel(serverId, channel.id);
    } catch (err) {
      if (stillMine()) showError(apiErrorText(err, t));
      return;
    } finally {
      deletingRef.current = false;
    }
    // Запрос удался — канал реально удалён, что бы ни стало с потоком.
    useServerStore.getState().removeChannel(channel.id);
    if (stillMine()) endFlow();
    onDeleted?.(channel.id);
  };

  return (
    <>
      <ActionSheet open={open && flow === 'none' && !empty} onClose={closeSheet} title={channel.name} items={items} />
      {flow === 'rename' && <EditChannelModal serverId={serverId} channel={channel} onClose={closeRename} />}
      <ConfirmModal
        open={flow === 'confirm'}
        title={t('channel.deleteTitle', { name: channel.name })}
        body={t('channel.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void handleDelete()}
        onCancel={endFlow}
      />
      {error && <div className="error-toast">{error}</div>}
    </>
  );
}
