// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { ManageInvitesModal } from '../ManageInvitesModal';

const h = vi.hoisted(() => ({
  list: (async () => []) as () => Promise<unknown[]>,
  create: (async () => ({})) as () => Promise<unknown>,
  revoke: (async () => {}) as () => Promise<void>,
}));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listInvites: vi.fn(() => h.list()),
      createInvite: vi.fn(() => h.create()),
      revokeInvite: vi.fn(() => h.revoke()),
    },
  };
});

const NOW = new Date('2026-01-01T00:00:00Z');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.resolve() }, configurable: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Снимки DOM десктопной модалки, снятые с кода ДО выноса тела в
 *  ManageInvitesBody (VYC-95, задача 10). Десктоп не должен измениться ни на
 *  один узел; менять эти строки можно только намеренной правкой модалки.
 *  Кириллица и имена атрибутов вынесены в константы, чтобы эвристика
 *  check-i18n не принимала снимок за JSX. */
const TITLE = 'Инвайт-ссылки';
const CLOSE = 'Закрыть';
const COPY = 'Копировать';
const COPIED_TXT = 'Скопировано';
const REVOKE = 'Отозвать';
const CREATE = 'Создать ссылку';
const SAVING = 'Сохранение...';
const LOADING_TXT = 'Загрузка...';
const EMPTY_TXT = 'Пока нет ни одной ссылки';
const NO_EXPIRY = 'Ссылка не истекает';
const LIVES = 'Ссылка живёт';
const USES = 'использований';
const DAYS = 'дн.';
const TITLE_ATTR = 'title';
const ARIA_ATTR = 'aria-label';
const CODE_A = 'AAA111';
const CODE_B = 'BBB222';
const BOOM = 'boom';
const ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
const ICON_COPY = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-copy" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
const ICON_TRASH = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash2 lucide-trash-2" aria-hidden="true"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
const ICON_CHECK = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
const LOADING = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${TITLE_ATTR}="${CLOSE}" ${ARIA_ATTR}="${CLOSE}">${ICON_X}</button></div><p class="invites-empty">${LOADING_TXT}</p><div class="modal-actions"><button type="button" class="btn btn-primary">${CREATE}</button></div></div></div>`;
const EMPTY_LIST = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${TITLE_ATTR}="${CLOSE}" ${ARIA_ATTR}="${CLOSE}">${ICON_X}</button></div><p class="invites-empty">${EMPTY_TXT}</p><div class="modal-actions"><button type="button" class="btn btn-primary">${CREATE}</button></div></div></div>`;
const WITH_LIST = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${TITLE_ATTR}="${CLOSE}" ${ARIA_ATTR}="${CLOSE}">${ICON_X}</button></div><ul class="invites-list"><li class="invites-row"><div class="invites-row-main"><span class="invites-code">${CODE_A}</span><span class="invites-meta">${USES}: 3 · ${LIVES} 7 ${DAYS}</span></div><div class="invites-actions"><button type="button" class="panel-icon-btn" ${TITLE_ATTR}="${COPY}" ${ARIA_ATTR}="${COPY}">${ICON_COPY}</button><button type="button" class="panel-icon-btn is-danger" ${TITLE_ATTR}="${REVOKE}" ${ARIA_ATTR}="${REVOKE}">${ICON_TRASH}</button></div></li><li class="invites-row"><div class="invites-row-main"><span class="invites-code">${CODE_B}</span><span class="invites-meta">${USES}: 0 · ${NO_EXPIRY}</span></div><div class="invites-actions"><button type="button" class="panel-icon-btn" ${TITLE_ATTR}="${COPY}" ${ARIA_ATTR}="${COPY}">${ICON_COPY}</button><button type="button" class="panel-icon-btn is-danger" ${TITLE_ATTR}="${REVOKE}" ${ARIA_ATTR}="${REVOKE}">${ICON_TRASH}</button></div></li></ul><div class="modal-actions"><button type="button" class="btn btn-primary">${CREATE}</button></div></div></div>`;
const ROW_COPIED = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${TITLE_ATTR}="${CLOSE}" ${ARIA_ATTR}="${CLOSE}">${ICON_X}</button></div><ul class="invites-list"><li class="invites-row"><div class="invites-row-main"><span class="invites-code">${CODE_A}</span><span class="invites-meta">${USES}: 3 · ${LIVES} 7 ${DAYS}</span></div><div class="invites-actions"><button type="button" class="panel-icon-btn" ${TITLE_ATTR}="${COPIED_TXT}" ${ARIA_ATTR}="${COPY}">${ICON_CHECK}</button><button type="button" class="panel-icon-btn is-danger" ${TITLE_ATTR}="${REVOKE}" ${ARIA_ATTR}="${REVOKE}">${ICON_TRASH}</button></div></li><li class="invites-row"><div class="invites-row-main"><span class="invites-code">${CODE_B}</span><span class="invites-meta">${USES}: 0 · ${NO_EXPIRY}</span></div><div class="invites-actions"><button type="button" class="panel-icon-btn" ${TITLE_ATTR}="${COPY}" ${ARIA_ATTR}="${COPY}">${ICON_COPY}</button><button type="button" class="panel-icon-btn is-danger" ${TITLE_ATTR}="${REVOKE}" ${ARIA_ATTR}="${REVOKE}">${ICON_TRASH}</button></div></li></ul><div class="modal-actions"><button type="button" class="btn btn-primary">${CREATE}</button></div></div></div>`;
const ERROR_WITH_LIST = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${TITLE_ATTR}="${CLOSE}" ${ARIA_ATTR}="${CLOSE}">${ICON_X}</button></div><p class="modal-error">${BOOM}</p><ul class="invites-list"><li class="invites-row"><div class="invites-row-main"><span class="invites-code">${CODE_A}</span><span class="invites-meta">${USES}: 3 · ${LIVES} 7 ${DAYS}</span></div><div class="invites-actions"><button type="button" class="panel-icon-btn" ${TITLE_ATTR}="${COPY}" ${ARIA_ATTR}="${COPY}">${ICON_COPY}</button><button type="button" class="panel-icon-btn is-danger" ${TITLE_ATTR}="${REVOKE}" ${ARIA_ATTR}="${REVOKE}">${ICON_TRASH}</button></div></li><li class="invites-row"><div class="invites-row-main"><span class="invites-code">${CODE_B}</span><span class="invites-meta">${USES}: 0 · ${NO_EXPIRY}</span></div><div class="invites-actions"><button type="button" class="panel-icon-btn" ${TITLE_ATTR}="${COPY}" ${ARIA_ATTR}="${COPY}">${ICON_COPY}</button><button type="button" class="panel-icon-btn is-danger" ${TITLE_ATTR}="${REVOKE}" ${ARIA_ATTR}="${REVOKE}">${ICON_TRASH}</button></div></li></ul><div class="modal-actions"><button type="button" class="btn btn-primary">${CREATE}</button></div></div></div>`;
const LOAD_ERROR = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${TITLE_ATTR}="${CLOSE}" ${ARIA_ATTR}="${CLOSE}">${ICON_X}</button></div><p class="modal-error">${BOOM}</p><p class="invites-empty">${EMPTY_TXT}</p><div class="modal-actions"><button type="button" class="btn btn-primary">${CREATE}</button></div></div></div>`;
const CREATING = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${TITLE_ATTR}="${CLOSE}" ${ARIA_ATTR}="${CLOSE}">${ICON_X}</button></div><ul class="invites-list"><li class="invites-row"><div class="invites-row-main"><span class="invites-code">${CODE_A}</span><span class="invites-meta">${USES}: 3 · ${LIVES} 7 ${DAYS}</span></div><div class="invites-actions"><button type="button" class="panel-icon-btn" ${TITLE_ATTR}="${COPY}" ${ARIA_ATTR}="${COPY}">${ICON_COPY}</button><button type="button" class="panel-icon-btn is-danger" ${TITLE_ATTR}="${REVOKE}" ${ARIA_ATTR}="${REVOKE}">${ICON_TRASH}</button></div></li><li class="invites-row"><div class="invites-row-main"><span class="invites-code">${CODE_B}</span><span class="invites-meta">${USES}: 0 · ${NO_EXPIRY}</span></div><div class="invites-actions"><button type="button" class="panel-icon-btn" ${TITLE_ATTR}="${COPY}" ${ARIA_ATTR}="${COPY}">${ICON_COPY}</button><button type="button" class="panel-icon-btn is-danger" ${TITLE_ATTR}="${REVOKE}" ${ARIA_ATTR}="${REVOKE}">${ICON_TRASH}</button></div></li></ul><div class="modal-actions"><button type="button" class="btn btn-primary" disabled="">${SAVING}</button></div></div></div>`;

const LIST = [
  { code: 'AAA111', server_id: 's1', created_by: 'u1', created_at: '2026-01-01T00:00:00Z', expires_at: '2026-01-08T00:00:00Z', uses: 3 },
  { code: 'BBB222', server_id: 's1', created_by: 'u1', created_at: '2026-01-01T00:00:00Z', uses: 0 },
];
const mount = () => render(<ManageInvitesModal serverId="s1" onClose={vi.fn()} />);

describe('ManageInvitesModal DOM (desktop parity)', () => {
  it('renders the same DOM while loading', () => {
    h.list = () => new Promise(() => {});
    expect(mount().container.innerHTML).toBe(LOADING);
  });

  it('renders the same DOM for an empty list', async () => {
    h.list = async () => [];
    const { container } = mount();
    await act(async () => {});
    expect(container.innerHTML).toBe(EMPTY_LIST);
  });

  it('renders the same DOM for a list with an expiring and a never-expiring invite, the copied state and its 2 s reset', async () => {
    h.list = async () => LIST;
    const { container } = mount();
    await act(async () => {});
    expect(container.innerHTML).toBe(WITH_LIST);
    fireEvent.click(container.querySelector('.invites-actions .panel-icon-btn')!);
    expect(container.innerHTML).toBe(ROW_COPIED);
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
    expect(container.innerHTML).toBe(WITH_LIST);
  });

  it('renders the same DOM with an error over the list, and with a load error', async () => {
    h.list = async () => LIST;
    h.revoke = async () => { throw new Error('boom'); };
    const first = mount();
    await act(async () => {});
    fireEvent.click(first.container.querySelector('.panel-icon-btn.is-danger')!);
    await act(async () => {});
    expect(first.container.innerHTML).toBe(ERROR_WITH_LIST);
    cleanup();
    h.list = async () => { throw new Error('boom'); };
    const second = mount();
    await act(async () => {});
    expect(second.container.innerHTML).toBe(LOAD_ERROR);
  });

  it('renders the same DOM while creating (button label and disabled)', async () => {
    h.list = async () => LIST;
    h.create = () => new Promise(() => {});
    const { container } = mount();
    await act(async () => {});
    fireEvent.click(container.querySelector('.modal-actions .btn')!);
    await act(async () => {});
    expect(container.innerHTML).toBe(CREATING);
  });

  it('keeps modal behaviour: close button; the scrim does NOT close; a click inside does not bubble', async () => {
    h.list = async () => [];
    const onClose = vi.fn();
    const onOverlay = vi.fn();
    const { container } = render(
      <div onClick={onOverlay}><ManageInvitesModal serverId="s1" onClose={onClose} /></div>,
    );
    await act(async () => {});
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(onClose).not.toHaveBeenCalled();
    onOverlay.mockClear();
    fireEvent.click(container.querySelector('.modal')!);
    expect(onOverlay).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.modal-close-btn')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
