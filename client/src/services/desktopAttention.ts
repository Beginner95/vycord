/**
 * Привлечь внимание к звонку, когда окно не в фокусе: системное уведомление
 * (HTML5 Notification — в Electron оно нативное) и подсветка окна в панели
 * задач. В фокусе — ничего: карточка и так на экране.
 */
export function requestAttention(title: string, body: string): void {
  if (typeof document === 'undefined' || (document.hasFocus() && !document.hidden)) return;
  const api = (window as Window & typeof globalThis & { electronAPI?: { flashFrame?: () => void } }).electronAPI;
  api?.flashFrame?.();
  if (typeof Notification === 'undefined') return;
  const show = () => {
    try {
      const n = new Notification(title, { body, silent: true, tag: 'incoming-call' });
      n.onclick = () => window.focus();
    } catch {
      // Уведомления запрещены политикой — карточка всё равно появится.
    }
  };
  if (Notification.permission === 'granted') show();
  else if (Notification.permission === 'default') void Notification.requestPermission().then((p) => { if (p === 'granted') show(); });
}
