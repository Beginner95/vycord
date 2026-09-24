import { useEffect, useRef, useState } from 'react';
import type { Server, User } from '@/types';
import { apiService, apiErrorText } from '@/services/api';
import { useServerStore } from '@/stores/serverStore';
import { ConfirmModal } from '@/components/ConfirmModal';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { useT } from '@/i18n';
import { useServerMenuItems } from './useServerMenuItems';

interface ServerMenuSheetProps {
  server: Server | null;
  user: User | null;
  open: boolean;
  /** Всё взаимодействие с меню закончено: sheet закрыт без выбора потокового
   *  пункта, либо закончилось подтверждение удаления (отмена, успех, ошибка).
   *  Вызывается ровно один раз за взаимодействие. Пункты навигации
   *  (настройки/приглашения/стикеры/создать канал) потока не запускают, для них
   *  это тоже один вызов — сразу после выбора. Обязанность хоста: держать
   *  сервер смонтированным (через `open`) до вызова onClose — тост ошибки
   *  живёт внутри этого компонента. */
  onClose: () => void;
  onCreateChannel?: () => void;
  onSettings?: () => void;
  onInvites?: () => void;
  onStickers?: () => void;
  /** Без этого пропа пункт «Удалить» не показывается. */
  onDeleted?: (serverId: string) => void;
}

type Flow = 'none' | 'confirm' | 'error';

const ERROR_TOAST_MS = 5000;

/** Мобильный аналог ServerMenu: те же права и тот же поток удаления, но
 *  ActionSheet вместо ContextMenu (спека §4.5). Десктопный ServerMenu не
 *  трогаем — «десктоп не меняется» дороже переиспользования. */
export function ServerMenuSheet(props: ServerMenuSheetProps) {
  // Гейт снаружи: внутреннее тело вызывает useServerMenuItems, которому нужен
  // непустой сервер. Ни одного хука до этой проверки — правила хуков целы.
  if (!props.server) return null;
  return <Body {...props} server={props.server} />;
}

function Body({
  server, user, open, onClose, onCreateChannel, onSettings, onInvites, onStickers, onDeleted,
}: ServerMenuSheetProps & { server: Server }) {
  const t = useT();
  const [flow, setFlow] = useState<Flow>('none');
  const [error, setError] = useState<string | null>(null);
  const deletingRef = useRef(false);
  // Синхронное зеркало flow для отложенной проверки в closeSheet() и для
  // проверки «поток ещё идёт?» после await в handleDelete().
  const flowRef = useRef<Flow>('none');
  // Номер текущего confirm-потока: запрос, стартовавший в старом потоке, не
  // вправе закончить или провалить новый (Body может пережить onClose).
  const flowSeq = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyReportedRef = useRef(false);
  // Актуальный onClose для отложенных вызовов (таймер тоста, эффект пустого меню).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  useEffect(() => clearTimer, []);

  const startFlow = (next: Flow) => {
    if (next === 'confirm') flowSeq.current += 1;
    flowRef.current = next;
    setFlow(next);
  };
  // Поток закончен: родитель узнаёт об этом ровно один раз.
  const endFlow = () => {
    clearTimer();
    flowRef.current = 'none';
    setFlow('none');
    setError(null);
    onCloseRef.current();
  };

  // Ошибка удаления: меню остаётся смонтированным, пока виден тост, и только
  // потом сообщает родителю (иначе родитель размонтирует Body вместе с тостом).
  // Размонтирование в состоянии 'error' родителю не сообщается: хост сам убрал
  // сервер, ждать от него onClose после этого не нужно.
  const failFlow = (message: string) => {
    clearTimer();
    setError(message);
    startFlow('error');
    timerRef.current = setTimeout(endFlow, ERROR_TOAST_MS);
  };

  // ActionSheet зовёт onClose() ДО onClick пункта — и при выборе пункта, и при
  // закрытии скримом/свайпом/Escape/системным «назад». Отличить их можно только
  // после onClick, поэтому решение откладывается на микрозадачу: если пункт
  // успел запустить поток (confirm), sheet закрыт «в пользу» потока, и
  // родителю сообщать нельзя — иначе он размонтирует меню под подтверждением,
  // а onClose потом был бы вызван ещё раз по окончании потока.
  const closeSheet = () => {
    queueMicrotask(() => {
      if (flowRef.current === 'none') onCloseRef.current();
    });
  };

  const items = useServerMenuItems(server, user, {
    onCreateChannel, onSettings, onInvites, onStickers,
    onDelete: onDeleted ? () => startFlow('confirm') : undefined,
  });

  // Пустое меню (у участника нет прав): пустую шторку с заголовком не
  // показываем, а взаимодействие закрываем ровно один раз.
  const empty = items.length === 0;
  useEffect(() => {
    if (!open || !empty) {
      emptyReportedRef.current = false;
      return;
    }
    // Смена прав посреди confirm/error не должна закрывать меню раньше потока.
    if (flow !== 'none' || emptyReportedRef.current) return;
    emptyReportedRef.current = true;
    onCloseRef.current();
  }, [open, empty, flow]);

  const handleDelete = async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    const seq = flowSeq.current;
    // Поток всё ещё тот же confirm, что и при старте запроса.
    const stillMine = () => flowRef.current === 'confirm' && flowSeq.current === seq;
    try {
      await apiService.deleteServer(server.id);
      // Сервер удалён на бэкенде независимо от того, что успел сделать
      // пользователь, пока шёл запрос, — стор и хост узнают об этом всегда.
      useServerStore.getState().removeServer(server.id);
      // Но поток трогаем, только если он ещё идёт: отмена во время запроса уже
      // сообщила родителю (onClose), второй раз — нельзя.
      if (stillMine()) endFlow();
      onDeleted?.(server.id);
    } catch (err) {
      // Отменили во время запроса — родитель уже закрыт, показывать нечего.
      if (stillMine()) failFlow(apiErrorText(err, t));
    } finally {
      deletingRef.current = false;
    }
  };

  return (
    <>
      <ActionSheet open={open && flow === 'none' && !empty} onClose={closeSheet} title={server.name} items={items} />
      <ConfirmModal
        open={flow === 'confirm'}
        title={t('server.deleteTitle', { name: server.name })}
        body={t('server.deleteBody')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void handleDelete()}
        onCancel={endFlow}
      />
      {flow === 'error' && error && <div className="error-toast">{error}</div>}
    </>
  );
}
