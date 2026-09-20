// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import type { Server } from '@/types';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      updateServer: vi.fn(),
      setServerGuestLinks: vi.fn(async (_id: string, enabled: boolean) => ({ guest_links_enabled: enabled })),
      removeServerIcon: vi.fn(),
      uploadServerIcon: vi.fn(),
    },
  };
});
import { apiService } from '@/services/api';
import { EditServerModal } from '../EditServerModal';

afterEach(cleanup);

/** Снимки DOM десктопной модалки, снятые с кода ДО выноса тела в
 *  EditServerBody (VYC-95, задача 9). Десктоп не должен измениться ни на один
 *  узел; менять эти строки можно только намеренной правкой модалки.
 *  Корень модалки — фрагмент: .modal-overlay и, сестрой, окно кропа. Состояния
 *  чекбоксов (свойство checked) в innerHTML не видны — их проверяют отдельные
 *  утверждения ниже. */
// Имена атрибутов вынесены, чтобы эвристика check-i18n не принимала снимки за JSX.
const A_TITLE = 'title';
const A_ARIA = 'aria-label';
const A_ALT = 'alt';
const ERR_TEXT = 'boom';
const TITLE = 'Редактировать сервер';
const CLOSE = 'Закрыть';
const CHANGE_ICON = 'Изменить иконку';
const NAME_LABEL = 'Название сервера';
const PRIVATE = 'Приватный сервер';
const GUEST = 'Гостевые ссылки в звонки';
const GUEST_HINT = 'Участники звонков смогут приглашать людей без аккаунта. Каждого гостя нужно впустить.';
const CANCEL = 'Отмена';
const SAVE = 'Сохранить';
const PRIVATE_HINT = 'Новых участников можно позвать только по инвайт-ссылке — «Пригласить» в меню сервера.';
const REMOVE_ICON = 'Удалить иконку';
const SAVING_LABEL = 'Сохранение...';
const BAD_FORMAT_TEXT = 'Неподдерживаемый формат. Разрешены PNG, JPG, JPEG';
const CROP_TITLE = 'Обрезка иконки сервера';
const ZOOM = 'Масштаб';
const REMOVING_LABEL = 'Удаление...';
const X_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
const CROP_MODAL = `<div class="modal-overlay"><div class="modal avatar-crop-modal"><div class="modal-header"><h2 class="modal-title">${CROP_TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CANCEL}" ${A_ARIA}="${CANCEL}">${X_ICON}</button></div><canvas class="avatar-crop-canvas" width="320" height="320"></canvas><div class="avatar-crop-zoom"><span class="avatar-crop-zoom-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-zoom-in" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" x2="16.65" y1="21" y2="16.65"></line><line x1="11" x2="11" y1="8" y2="14"></line><line x1="8" x2="14" y1="11" y2="11"></line></svg></span><input class="slider-input" ${A_ARIA}="${ZOOM}" min="1" max="4" step="0.05" style="--slider-fill: 0%;" disabled="" type="range" value="1"></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="button" class="btn btn-primary" disabled="">${SAVE}</button></div></div></div>`;
const INITIAL = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><div class="edit-server-icon-preview">P</div><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SAVE}</button></div></form></div></div>`;
const PRIVATE_ON = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><div class="edit-server-icon-preview">P</div><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label><p class="modal-hint">${PRIVATE_HINT}</p></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SAVE}</button></div></form></div></div>`;
const WITH_ICON = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><img ${A_ALT}="Pack" class="edit-server-icon-preview" src="https://cdn.example/i.png"><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button><button type="button" class="btn btn-danger-soft">${REMOVE_ICON}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SAVE}</button></div></form></div></div>`;
const ERROR = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><div class="edit-server-icon-preview">P</div><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack2"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><p class="modal-error">${ERR_TEXT}</p><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SAVE}</button></div></form></div></div>`;
const SAVING = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><div class="edit-server-icon-preview">P</div><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack2"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary" disabled="">${SAVING_LABEL}</button></div></form></div></div>`;
const BAD_FORMAT = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><div class="edit-server-icon-preview">P</div><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><p class="modal-error">${BAD_FORMAT_TEXT}</p><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SAVE}</button></div></form></div></div>`;
const CROP = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><div class="edit-server-icon-preview">P</div><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SAVE}</button></div></form></div></div>${CROP_MODAL}`;
const REMOVING = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><img ${A_ALT}="Pack" class="edit-server-icon-preview" src="https://cdn.example/i.png"><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button><button type="button" class="btn btn-danger-soft" disabled="">${REMOVING_LABEL}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SAVE}</button></div></form></div></div>`;
const GUEST_SAVING = `<div class="modal-overlay"><div class="modal"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><div class="edit-server-icon-block"><div class="edit-server-icon-preview">P</div><div class="edit-server-icon-actions"><button type="button" class="btn btn-secondary">${CHANGE_ICON}</button></div><input accept="image/png,image/jpeg" style="display: none;" type="file"></div><form><div class="form-group"><label for="edit-server-name">${NAME_LABEL}</label><input id="edit-server-name" maxlength="100" required="" type="text" value="Pack"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="form-group form-checkbox"><label><input type="checkbox" checked="" disabled="">${GUEST}</label><p class="modal-hint">${GUEST_HINT}</p></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SAVE}</button></div></form></div></div>`;

beforeAll(() => {
  // jsdom не реализует URL.createObjectURL, а окно кропа зовёт его при монтировании.
  Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
});
beforeEach(() => vi.clearAllMocks());

const base = { id: 's1', name: 'Pack', is_private: false, guest_links_enabled: true, owner_id: 'u1' } as Server;
const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const checkboxes = (c: HTMLElement) => c.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
const submitWith = (c: HTMLElement, name: string) => {
  fireEvent.change(c.querySelector('#edit-server-name')!, { target: { value: name } });
  fireEvent.submit(c.querySelector('form')!);
};
const pick = (c: HTMLElement, file: File) =>
  fireEvent.change(c.querySelector('input[type="file"]')!, { target: { files: [file] } });

describe('EditServerModal DOM (desktop parity)', () => {
  it('initial state, privacy toggle and guest-links toggle', async () => {
    const { container } = render(<EditServerModal server={base} onClose={vi.fn()} />);
    expect(container.innerHTML).toBe(INITIAL);
    expect(checkboxes(container)[0].checked).toBe(false);
    expect(checkboxes(container)[1].checked).toBe(true);

    fireEvent.click(checkboxes(container)[0]);
    expect(container.innerHTML).toBe(PRIVATE_ON);
    expect(checkboxes(container)[0].checked).toBe(true);
    fireEvent.click(checkboxes(container)[0]);
    expect(container.innerHTML).toBe(INITIAL);

    fireEvent.click(checkboxes(container)[1]);
    await act(async () => {});
    expect(apiService.setServerGuestLinks).toHaveBeenCalledWith('s1', false);
    expect(container.innerHTML).toBe(INITIAL);
    expect(checkboxes(container)[1].checked).toBe(false);
  });

  it('server with an icon', () => {
    const { container } = render(
      <EditServerModal server={{ ...base, icon_url: 'https://cdn.example/i.png' }} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe(WITH_ICON);
  });

  it('shows the API error after a failed save', async () => {
    mock(apiService.updateServer).mockRejectedValueOnce(new Error('boom'));
    const { container } = render(<EditServerModal server={base} onClose={vi.fn()} />);
    submitWith(container, 'Pack2');
    await act(async () => {});
    expect(container.innerHTML).toBe(ERROR);
  });

  it('shows the saving label and disables the button while saving', async () => {
    mock(apiService.updateServer).mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(<EditServerModal server={base} onClose={vi.fn()} />);
    submitWith(container, 'Pack2');
    await act(async () => {});
    expect(container.innerHTML).toBe(SAVING);
  });

  it('shows the removing label while the icon is being removed', async () => {
    mock(apiService.removeServerIcon).mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(
      <EditServerModal server={{ ...base, icon_url: 'https://cdn.example/i.png' }} onClose={vi.fn()} />,
    );
    fireEvent.click(container.querySelector('.btn-danger-soft')!);
    await act(async () => {});
    expect(container.innerHTML).toBe(REMOVING);
  });

  it('disables the guest-links checkbox while its request is in flight', async () => {
    mock(apiService.setServerGuestLinks).mockImplementationOnce(() => new Promise(() => {}));
    const { container } = render(<EditServerModal server={base} onClose={vi.fn()} />);
    fireEvent.click(checkboxes(container)[1]);
    await act(async () => {});
    expect(container.innerHTML).toBe(GUEST_SAVING);
  });

  it('rejects a file of the wrong type with the format error', () => {
    const { container } = render(<EditServerModal server={base} onClose={vi.fn()} />);
    pick(container, new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(container.innerHTML).toBe(BAD_FORMAT);
  });

  it('keeps the crop modal a SIBLING of the overlay, not inside .modal', async () => {
    const { container } = render(<EditServerModal server={base} onClose={vi.fn()} />);
    pick(container, new File(['x'], 'a.png', { type: 'image/png' }));
    await act(async () => {});
    expect(container.innerHTML).toBe(CROP);
    expect(container.children).toHaveLength(2);
    expect(container.children[1].querySelector('.avatar-crop-modal')).not.toBeNull();
    expect(container.children[0].querySelector('.avatar-crop-modal')).toBeNull();

    // «Отмена» кропа убирает сестру, оверлей остаётся.
    fireEvent.click(container.children[1].querySelector('.modal-actions .btn-secondary')!);
    expect(container.children).toHaveLength(1);
  });

  it('finishes without a request when nothing changed', async () => {
    const onClose = vi.fn();
    const { container } = render(<EditServerModal server={base} onClose={onClose} />);
    fireEvent.submit(container.querySelector('form')!);
    await act(async () => {});
    expect(apiService.updateServer).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
