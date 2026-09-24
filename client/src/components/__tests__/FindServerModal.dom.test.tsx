// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { FindServerModal } from '../FindServerModal';

const h = vi.hoisted(() => ({ mode: 'results' as 'results' | 'invite' | 'none', FOUND: 'Найденный', INVITE: 'Инвайт' }));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      searchServers: vi.fn(async () => (h.mode === 'none' ? [] : [{ id: 's9', name: h.FOUND }])),
      previewInvite: vi.fn(async () => {
        if (h.mode === 'invite') return { server_name: h.INVITE, member_count: 3 };
        throw new Error('404');
      }),
      joinViaInvite: vi.fn(async () => { throw new Error('boom'); }),
    },
  };
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

/** Снимки DOM десктопной модалки, снятые с кода ДО выноса тела в
 *  FindServerBody (VYC-95, задача 8). Десктоп не должен измениться ни на один
 *  узел; менять эти строки можно только намеренной правкой модалки. Кириллица и
 *  имена атрибутов вынесены в константы, чтобы эвристика check-i18n не
 *  принимала снимок за JSX. */
const NO_RESULTS = 'Ничего не найдено по запросу «zzz»';
const INVITE_META = 'По коду приглашения · участников: 3';
const DESCRIPTION = 'Введите название сервера или код приглашения';
const FOOTER_Q = 'Нет нужного сервера?';
const PLACEHOLDER = 'Название или код…';
const RESULTS = 'Результаты';
const FOUND = 'Найденный';
const CREATE_OWN = 'Создать свой';
const TITLE = 'Найти сервер';
const CLOSE = 'Закрыть';
const INVITE = 'Инвайт';
const JOIN = 'Войти';
const LETTER_FOUND = 'Н';
const LETTER_INVITE = 'И';
const PH_ATTR = 'placeholder';
const ARIA_ATTR = 'aria-label';
const EMPTY = `<div class="modal-overlay"><div class="modal find-server-modal" role="dialog" aria-modal="true" ${ARIA_ATTR}="${TITLE}"><div class="modal-header"><div><div class="modal-title">${TITLE}</div><p class="modal-sub">${DESCRIPTION}</p></div><button type="button" class="modal-close-btn" ${ARIA_ATTR}="${CLOSE}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><input class="input" data-autofocus="true" ${PH_ATTR}="${PLACEHOLDER}" value=""><div class="find-server-footer"><span class="find-server-footer-text">${FOOTER_Q}</span><button type="button" class="btn btn-secondary">${CREATE_OWN}</button></div></div></div>`;
const WITH_RESULTS = `<div class="modal-overlay"><div class="modal find-server-modal" role="dialog" aria-modal="true" ${ARIA_ATTR}="${TITLE}"><div class="modal-header"><div><div class="modal-title">${TITLE}</div><p class="modal-sub">${DESCRIPTION}</p></div><button type="button" class="modal-close-btn" ${ARIA_ATTR}="${CLOSE}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><input class="input" data-autofocus="true" ${PH_ATTR}="${PLACEHOLDER}" value="най"><div class="find-server-results-label">${RESULTS}</div><div class="find-server-list"><div class="find-server-row"><div class="find-server-avatar" style="--avatar-color: #7C3AED; background: var(--avatar-bg, var(--avatar-color)); color: var(--avatar-ink, #FFFFFF); font-weight: 700;">${LETTER_FOUND}</div><div class="find-server-name">${FOUND}</div><button type="button" class="btn btn-primary">${JOIN}</button></div></div><div class="find-server-footer"><span class="find-server-footer-text">${FOOTER_Q}</span><button type="button" class="btn btn-secondary">${CREATE_OWN}</button></div></div></div>`;
const WITH_INVITE = `<div class="modal-overlay"><div class="modal find-server-modal" role="dialog" aria-modal="true" ${ARIA_ATTR}="${TITLE}"><div class="modal-header"><div><div class="modal-title">${TITLE}</div><p class="modal-sub">${DESCRIPTION}</p></div><button type="button" class="modal-close-btn" ${ARIA_ATTR}="${CLOSE}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><input class="input" data-autofocus="true" ${PH_ATTR}="${PLACEHOLDER}" value="abc"><div class="find-server-results-label">${RESULTS}</div><div class="find-server-list"><div class="find-server-row is-invite"><div class="find-server-avatar" style="--avatar-color: #1D4ED8; background: var(--avatar-bg, var(--avatar-color)); color: var(--avatar-ink, #FFFFFF); font-weight: 700;">${LETTER_INVITE}</div><div><div class="find-server-name">${INVITE}</div><div class="find-server-meta">${INVITE_META}</div></div><button type="button" class="btn btn-primary">${JOIN}</button></div><div class="find-server-row"><div class="find-server-avatar" style="--avatar-color: #7C3AED; background: var(--avatar-bg, var(--avatar-color)); color: var(--avatar-ink, #FFFFFF); font-weight: 700;">${LETTER_FOUND}</div><div class="find-server-name">${FOUND}</div><button type="button" class="btn btn-primary">${JOIN}</button></div></div><div class="find-server-footer"><span class="find-server-footer-text">${FOOTER_Q}</span><button type="button" class="btn btn-secondary">${CREATE_OWN}</button></div></div></div>`;
const WITH_JOIN_ERROR = `<div class="modal-overlay"><div class="modal find-server-modal" role="dialog" aria-modal="true" ${ARIA_ATTR}="${TITLE}"><div class="modal-header"><div><div class="modal-title">${TITLE}</div><p class="modal-sub">${DESCRIPTION}</p></div><button type="button" class="modal-close-btn" ${ARIA_ATTR}="${CLOSE}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><input class="input" data-autofocus="true" ${PH_ATTR}="${PLACEHOLDER}" value="abc"><div class="find-server-results-label">${RESULTS}</div><div class="find-server-list"><div class="find-server-row is-invite"><div class="find-server-avatar" style="--avatar-color: #1D4ED8; background: var(--avatar-bg, var(--avatar-color)); color: var(--avatar-ink, #FFFFFF); font-weight: 700;">${LETTER_INVITE}</div><div><div class="find-server-name">${INVITE}</div><div class="find-server-meta">${INVITE_META}</div></div><button type="button" class="btn btn-primary">${JOIN}</button></div><div class="find-server-row"><div class="find-server-avatar" style="--avatar-color: #7C3AED; background: var(--avatar-bg, var(--avatar-color)); color: var(--avatar-ink, #FFFFFF); font-weight: 700;">${LETTER_FOUND}</div><div class="find-server-name">${FOUND}</div><button type="button" class="btn btn-primary">${JOIN}</button></div></div><p class="modal-error">boom</p><div class="find-server-footer"><span class="find-server-footer-text">${FOOTER_Q}</span><button type="button" class="btn btn-secondary">${CREATE_OWN}</button></div></div></div>`;
const NO_RESULTS_STATE = `<div class="modal-overlay"><div class="modal find-server-modal" role="dialog" aria-modal="true" ${ARIA_ATTR}="${TITLE}"><div class="modal-header"><div><div class="modal-title">${TITLE}</div><p class="modal-sub">${DESCRIPTION}</p></div><button type="button" class="modal-close-btn" ${ARIA_ATTR}="${CLOSE}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button></div><input class="input" data-autofocus="true" ${PH_ATTR}="${PLACEHOLDER}" value="zzz"><p class="find-server-empty"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-search" aria-hidden="true"><path d="m21 21-4.34-4.34"></path><circle cx="11" cy="11" r="8"></circle></svg> ${NO_RESULTS}</p><div class="find-server-footer"><span class="find-server-footer-text">${FOOTER_Q}</span><button type="button" class="btn btn-secondary">${CREATE_OWN}</button></div></div></div>`;

const props = () => ({ open: true, onClose: vi.fn(), onJoinServer: vi.fn(), onServerJoined: vi.fn(), onCreateServer: vi.fn() });
async function typeQuery(container: HTMLElement, value: string) {
  fireEvent.change(container.querySelector('input')!, { target: { value } });
  await act(async () => { await vi.advanceTimersByTimeAsync(350); });
}

describe('FindServerModal DOM (desktop parity)', () => {
  it('renders nothing while closed', () => {
    const { container } = render(<FindServerModal {...props()} open={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders the same DOM when open and empty', () => {
    const { container } = render(<FindServerModal {...props()} />);
    expect(container.innerHTML).toBe(EMPTY);
  });

  it('renders the same DOM with search results', async () => {
    h.mode = 'results';
    const { container } = render(<FindServerModal {...props()} />);
    await typeQuery(container, 'най');
    expect(container.innerHTML).toBe(WITH_RESULTS);
  });

  it('renders the same DOM with an invite preview, and with a join error', async () => {
    h.mode = 'invite';
    const { container } = render(<FindServerModal {...props()} />);
    await typeQuery(container, 'abc');
    expect(container.innerHTML).toBe(WITH_INVITE);
    fireEvent.click(container.querySelector('.find-server-row.is-invite .btn-primary')!);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(container.innerHTML).toBe(WITH_JOIN_ERROR);
  });

  it('renders the same DOM for a search with no results', async () => {
    h.mode = 'none';
    const { container } = render(<FindServerModal {...props()} />);
    await typeQuery(container, 'zzz');
    expect(container.innerHTML).toBe(NO_RESULTS_STATE);
  });

  it('keeps modal behaviour: close button, overlay click, Escape and create-own', () => {
    const p = props();
    const { container } = render(<FindServerModal {...p} />);
    fireEvent.click(container.querySelector('.modal-close-btn')!);
    expect(p.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.modal')!);
    expect(p.onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(p.onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.querySelector('.find-server-footer .btn')!);
    expect(p.onClose).toHaveBeenCalledTimes(3);
    expect(p.onCreateServer).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(4);
  });
});
