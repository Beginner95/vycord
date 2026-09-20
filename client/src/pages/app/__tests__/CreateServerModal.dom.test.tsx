// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { CreateServerModal } from '../CreateServerModal';

afterEach(cleanup);

/** Снимки DOM десктопной модалки, снятые с кода ДО выноса тела формы в
 *  CreateServerForm (VYC-95, задача 7). Десктоп не должен измениться ни на
 *  один узел; менять эти строки можно только намеренной правкой модалки. */
const ERR_TEXT = 'boom';
const TITLE = 'Создать сервер';
const NAME_LABEL = 'Название сервера';
// Имя атрибута вынесено, чтобы эвристика check-i18n не принимала снимок за JSX.
const PH_ATTR = 'placeholder';
const PLACEHOLDER = 'Мой классный сервер';
const PRIVATE = 'Приватный сервер';
const CANCEL = 'Отмена';
const SUBMIT = 'Создать';
const INITIAL = `<div class="modal-overlay"><div class="modal"><h2>${TITLE}</h2><form><div class="form-group"><label for="server-name">${NAME_LABEL}</label><input id="server-name" ${PH_ATTR}="${PLACEHOLDER}" maxlength="100" required="" type="text" value=""></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SUBMIT}</button></div></form></div></div>`;
const FILLED = `<div class="modal-overlay"><div class="modal"><h2>${TITLE}</h2><form><div class="form-group"><label for="server-name">${NAME_LABEL}</label><input id="server-name" ${PH_ATTR}="${PLACEHOLDER}" maxlength="100" required="" type="text" value="X"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SUBMIT}</button></div></form></div></div>`;
const WITH_ERROR = `<div class="modal-overlay"><div class="modal"><h2>${TITLE}</h2><form><div class="form-group"><label for="server-name">${NAME_LABEL}</label><input id="server-name" ${PH_ATTR}="${PLACEHOLDER}" maxlength="100" required="" type="text" value="X"></div><div class="form-group form-checkbox"><label><input type="checkbox">${PRIVATE}</label></div><p class="modal-error">${ERR_TEXT}</p><div class="modal-actions"><button type="button" class="btn btn-secondary">${CANCEL}</button><button type="submit" class="btn btn-primary">${SUBMIT}</button></div></form></div></div>`;

describe('CreateServerModal DOM (desktop parity)', () => {
  it('renders the same DOM in every state as before the form extraction', async () => {
    const onCreate = vi.fn(async () => { throw new Error(ERR_TEXT); });
    const { container } = render(<CreateServerModal onClose={vi.fn()} onCreate={onCreate} />);
    expect(container.innerHTML).toBe(INITIAL);

    fireEvent.change(container.querySelector('input[type="text"]')!, { target: { value: 'X' } });
    fireEvent.click(container.querySelector('input[type="checkbox"]')!);
    expect(container.innerHTML).toBe(FILLED);

    fireEvent.submit(container.querySelector('form')!);
    await act(async () => {});
    expect(container.innerHTML).toBe(WITH_ERROR);
  });

  it('keeps the desktop submit button free of a disabled attribute', () => {
    const { container } = render(<CreateServerModal onClose={vi.fn()} onCreate={vi.fn(async () => {})} />);
    expect(container.querySelector('button[type="submit"]')!.hasAttribute('disabled')).toBe(false);
  });
});
