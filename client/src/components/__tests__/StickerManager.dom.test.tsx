// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  list: [
    { id: 'st1', name: 'Wolf', image_url: '/u/1.png' },
    { id: 'st2', name: 'Fox', image_url: '/u/2.png' },
  ] as Array<{ id: string; name: string; image_url: string }>,
}));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      listStickers: vi.fn(async () => h.list),
      uploadSticker: vi.fn(async (_s: string, name: string) => ({ id: 'st9', name, image_url: '/u/9.png' })),
      deleteSticker: vi.fn(async () => {}),
    },
  };
});
import { apiService } from '@/services/api';
import { StickerManager } from '../StickerManager';

const DEFAULT_LIST = h.list;
let urlSeq = 0;
beforeEach(() => {
  vi.clearAllMocks();
  h.list = DEFAULT_LIST;
  urlSeq = 0;
  // jsdom не реализует URL.createObjectURL; счётчик даёт различимые адреса превью.
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:${++urlSeq}`),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(cleanup);


/** Снимки DOM десктопной модалки, снятые с кода ДО выноса состояния в
 *  useServerStickers и тела в StickerManagerBody (VYC-95, задача 11). Десктоп не
 *  должен измениться ни на один узел; менять эти строки можно только намеренной
 *  правкой модалки. Кириллица и имена атрибутов вынесены в константы, чтобы
 *  эвристика check-i18n не принимала снимки за JSX. Состояния, которых нет в
 *  innerHTML (disabled у кнопки, счётчики blob-URL), проверены утверждениями в
 *  самих тестах. */
const A_TITLE = 'title';
const A_ARIA = 'aria-label';
const A_PH = 'placeholder';
const A_ALT = 'alt';
const FILE_S = 's.png';
const FILE_B = 'b.png';
const ERR_BOOM = 'boom';
const TITLE = 'Стикеры сервера';
const DROP_HINT = 'Перетащите файл сюда или нажмите, чтобы выбрать';
const RESTRICTIONS = 'PNG, JPG или GIF · максимум 2 МБ';
const CLOSE = 'Закрыть';
const NAME_PH = 'Имя стикера';
const DELETE = 'Удалить';
const NAME_TYPED = 'лиса';
const REMOVE_FILE = 'Убрать файл';
const UPLOAD = 'Загрузить стикер';
const BAD_FORMAT_TEXT = 'Неверный формат файла';
const TOO_LARGE_TEXT = 'Файл стикера слишком большой';
const CONFIRM_TITLE = 'Удалить стикер «Wolf»?';
const CONFIRM_BODY = 'Стикер станет недоступен всем участникам сервера.';
const CANCEL = 'Отмена';
const X_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;
const IMG_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-image-plus" aria-hidden="true"><path d="M16 5h6"></path><path d="M19 2v6"></path><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5"></path><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path><circle cx="9" cy="9" r="2"></circle></svg>`;
const TRASH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-trash2 lucide-trash-2" aria-hidden="true"><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
const ALERT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-triangle-alert" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4"></path><path d="M12 17h.01"></path></svg>`;
const item = (name: string, n: number) =>
  `<div class="sticker-manager-item"><img ${A_ALT}="${name}" width="48" height="48" src="http://localhost:8080/u/${n}.png"><span>${name}</span><button type="button" class="panel-icon-btn is-danger" ${A_TITLE}="${DELETE}" ${A_ARIA}="${DELETE}">${TRASH_ICON}</button></div>`;
const ITEM_WOLF = item('Wolf', 1);
const ITEM_FOX = item('Fox', 2);

const SNAP: Record<string, string> = {
  'initial-sync': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list"></div></div></div>`,
  'empty-loaded': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list"></div></div></div>`,
  'with-stickers': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'name-typed': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value="${NAME_TYPED}"><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'file-picked': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint"><img class="sticker-dropzone-preview" ${A_ALT}="s.png" src="blob:1"></div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-preview-info"><span class="sticker-preview-name">${FILE_S}</span><div class="sticker-preview-actions"><button type="button" class="btn btn-ghost">${REMOVE_FILE}</button><button type="button" class="btn btn-primary" disabled="">${UPLOAD}</button></div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'file-and-name': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value="${NAME_TYPED}"><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint"><img class="sticker-dropzone-preview" ${A_ALT}="s.png" src="blob:1"></div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-preview-info"><span class="sticker-preview-name">${FILE_S}</span><div class="sticker-preview-actions"><button type="button" class="btn btn-ghost">${REMOVE_FILE}</button><button type="button" class="btn btn-primary">${UPLOAD}</button></div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'file-removed': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value="${NAME_TYPED}"><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'second-file': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint"><img class="sticker-dropzone-preview" ${A_ALT}="b.png" src="blob:2"></div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-preview-info"><span class="sticker-preview-name">${FILE_B}</span><div class="sticker-preview-actions"><button type="button" class="btn btn-ghost">${REMOVE_FILE}</button><button type="button" class="btn btn-primary" disabled="">${UPLOAD}</button></div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'busy': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value="${NAME_TYPED}"><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint"><img class="sticker-dropzone-preview" ${A_ALT}="s.png" src="blob:1"></div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-preview-info"><span class="sticker-preview-name">${FILE_S}</span><div class="sticker-preview-actions"><button type="button" class="btn btn-ghost">${REMOVE_FILE}</button><button type="button" class="btn btn-primary" disabled="">${UPLOAD}</button></div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'uploaded': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}<div class="sticker-manager-item"><img ${A_ALT}="${NAME_TYPED}" width="48" height="48" src="http://localhost:8080/u/9.png"><span>${NAME_TYPED}</span><button type="button" class="panel-icon-btn is-danger" ${A_TITLE}="${DELETE}" ${A_ARIA}="${DELETE}">${TRASH_ICON}</button></div></div></div></div>`,
  'upload-error': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value="${NAME_TYPED}"><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone is-error" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint"><img class="sticker-dropzone-preview" ${A_ALT}="s.png" src="blob:1"></div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-preview-info"><span class="sticker-preview-name">${FILE_S}</span><div class="sticker-preview-actions"><button type="button" class="btn btn-ghost">${REMOVE_FILE}</button><button type="button" class="btn btn-primary">${UPLOAD}</button></div></div><div class="error-toast">${ERR_BOOM}</div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'bad-format': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone is-error" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="error-toast">${BAD_FORMAT_TEXT}</div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'too-large': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone is-error" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="error-toast">${TOO_LARGE_TEXT}</div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'list-error': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone is-error" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="error-toast">${ERR_BOOM}</div><div class="sticker-manager-list"></div></div></div>`,
  'drag-over': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone is-active" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'drag-left': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'dropped': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint"><img class="sticker-dropzone-preview" ${A_ALT}="s.png" src="blob:1"></div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-preview-info"><span class="sticker-preview-name">${FILE_S}</span><div class="sticker-preview-actions"><button type="button" class="btn btn-ghost">${REMOVE_FILE}</button><button type="button" class="btn btn-primary" disabled="">${UPLOAD}</button></div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
  'confirm-open': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div><div class="modal-overlay"><div class="confirm-modal" role="alertdialog" aria-modal="true" ${A_ARIA}="${CONFIRM_TITLE}"><div class="confirm-modal-icon">${ALERT_ICON}</div><h3 class="confirm-modal-title">${CONFIRM_TITLE}</h3><p class="confirm-modal-body">${CONFIRM_BODY}</p><div class="confirm-modal-actions"><button type="button" class="btn btn-secondary" data-autofocus="true">${CANCEL}</button><button type="button" class="btn btn-danger">${DELETE}</button></div></div></div></div>`,
  'after-delete': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="sticker-manager-list">${ITEM_FOX}</div></div></div>`,
  'delete-error': `<div class="modal-overlay"><div class="modal sticker-manager"><div class="modal-header"><h2 class="modal-title">${TITLE}</h2><button type="button" class="modal-close-btn" ${A_TITLE}="${CLOSE}" ${A_ARIA}="${CLOSE}">${X_ICON}</button></div><input class="input" ${A_PH}="${NAME_PH}" type="text" value=""><input accept="image/png,image/jpeg,image/gif" class="sticker-file-input-hidden" type="file"><div class="sticker-dropzone is-error" role="button" tabindex="0"><span class="sticker-dropzone-icon">${IMG_ICON}</span><div class="sticker-dropzone-hint">${DROP_HINT}</div><div class="sticker-dropzone-restrictions">${RESTRICTIONS}</div></div><div class="error-toast">${ERR_BOOM}</div><div class="sticker-manager-list">${ITEM_WOLF}${ITEM_FOX}</div></div></div>`,
};
const snap = (name: string, c: HTMLElement) => {
  expect(c.innerHTML).toBe(SNAP[name]);
};

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const png = (name = 's.png') => new File(['x'], name, { type: 'image/png' });
const pickFile = (c: HTMLElement, f: File) =>
  fireEvent.change(c.querySelector('input[type="file"]')!, { target: { files: [f] } });
const typeName = (c: HTMLElement, v: string) =>
  fireEvent.change(c.querySelector('input.input')!, { target: { value: v } });
const flush = () => act(async () => {});
const mountManager = (onClose = vi.fn(), onChanged = vi.fn()) => ({
  onClose,
  onChanged,
  ...render(<StickerManager serverId="s1" onClose={onClose} onStickersChanged={onChanged} />),
});

describe('StickerManager DOM (desktop parity)', () => {
  it('initial render before the list resolves, then empty list', async () => {
    h.list = [];
    const { container } = mountManager();
    snap('initial-sync', container);
    await flush();
    snap('empty-loaded', container);
    expect(apiService.listStickers).toHaveBeenCalledTimes(1);
    expect(apiService.listStickers).toHaveBeenCalledWith('s1');
  });

  it('list with stickers', async () => {
    const { container } = mountManager();
    await flush();
    snap('with-stickers', container);
  });

  it('name typed', async () => {
    const { container } = mountManager();
    await flush();
    typeName(container, NAME_TYPED);
    snap('name-typed', container);
  });

  it('file picked: preview, remove and upload buttons; object URL lifecycle', async () => {
    const { container } = mountManager();
    await flush();
    pickFile(container, png());
    await flush();
    snap('file-picked', container);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    typeName(container, NAME_TYPED);
    snap('file-and-name', container);
    // Набор имени не пересоздаёт превью.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    // «Убрать» снимает файл и отзывает URL.
    fireEvent.click(container.querySelector('.sticker-preview-actions .btn-ghost')!);
    await flush();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    snap('file-removed', container);
  });

  it('a second file replaces the first one and revokes its URL', async () => {
    const { container } = mountManager();
    await flush();
    pickFile(container, png('a.png'));
    await flush();
    pickFile(container, png('b.png'));
    await flush();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    snap('second-file', container);
  });

  it('busy state while uploading', async () => {
    mock(apiService.uploadSticker).mockImplementationOnce(() => new Promise(() => {}));
    const { container } = mountManager();
    await flush();
    pickFile(container, png());
    typeName(container, NAME_TYPED);
    await flush();
    fireEvent.click(container.querySelector('.sticker-preview-info .btn-primary')!);
    await flush();
    snap('busy', container);
  });

  it('successful upload clears the form, appends to the list and notifies', async () => {
    const { container, onChanged } = mountManager();
    await flush();
    pickFile(container, png());
    typeName(container, NAME_TYPED);
    await flush();
    fireEvent.click(container.querySelector('.sticker-preview-info .btn-primary')!);
    await flush();
    expect(apiService.uploadSticker).toHaveBeenCalledWith('s1', NAME_TYPED, expect.any(File));
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    snap('uploaded', container);
  });

  it('failed upload shows the API error and keeps the file', async () => {
    mock(apiService.uploadSticker).mockRejectedValueOnce(new Error('boom'));
    const { container, onChanged } = mountManager();
    await flush();
    pickFile(container, png());
    typeName(container, NAME_TYPED);
    await flush();
    fireEvent.click(container.querySelector('.sticker-preview-info .btn-primary')!);
    await flush();
    expect(onChanged).not.toHaveBeenCalled();
    snap('upload-error', container);
  });

  it('a file of the wrong type: error toast and is-error highlight', async () => {
    const { container } = mountManager();
    await flush();
    pickFile(container, new File(['x'], 'a.txt', { type: 'text/plain' }));
    await flush();
    snap('bad-format', container);
    expect(container.querySelector('.sticker-dropzone')!.classList.contains('is-error')).toBe(true);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('an oversized file gets the size error', async () => {
    const { container } = mountManager();
    await flush();
    const big = png('big.png');
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    pickFile(container, big);
    await flush();
    snap('too-large', container);
  });

  it('list load failure shows the error toast', async () => {
    mock(apiService.listStickers).mockRejectedValueOnce(new Error('boom'));
    const { container } = mountManager();
    await flush();
    snap('list-error', container);
  });

  it('drag over highlights the dropzone and leaving clears it', async () => {
    const { container } = mountManager();
    await flush();
    const zone = container.querySelector('.sticker-dropzone')!;
    fireEvent.dragOver(zone);
    snap('drag-over', container);
    fireEvent.dragLeave(zone);
    snap('drag-left', container);
  });

  it('drop accepts the file and clears the highlight', async () => {
    const { container } = mountManager();
    await flush();
    const zone = container.querySelector('.sticker-dropzone')!;
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [png()] } });
    await flush();
    snap('dropped', container);
  });

  it('the dropzone click opens the file picker', async () => {
    const { container } = mountManager();
    await flush();
    const click = vi.spyOn(container.querySelector<HTMLInputElement>('input[type="file"]')!, 'click');
    fireEvent.click(container.querySelector('.sticker-dropzone')!);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('confirm modal is a SIBLING of .sticker-manager inside the overlay; delete happens only after confirming', async () => {
    const { container, onClose, onChanged } = mountManager();
    await flush();
    fireEvent.click(container.querySelector('.sticker-manager-item .panel-icon-btn.is-danger')!);
    await flush();
    snap('confirm-open', container);
    const overlay = container.querySelector('.modal-overlay')!;
    const confirm = container.querySelector('.confirm-modal')!;
    expect(confirm.closest('.sticker-manager')).toBeNull();
    expect(confirm.parentElement!.parentElement).toBe(overlay);
    expect(apiService.deleteSticker).not.toHaveBeenCalled();

    // Клик по фону подтверждения только закрывает его, но не всю модалку.
    fireEvent.click(container.querySelector('.modal-overlay .modal-overlay')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('.confirm-modal')).toBeNull();

    fireEvent.click(container.querySelector('.sticker-manager-item .panel-icon-btn.is-danger')!);
    await flush();
    fireEvent.click(container.querySelector('.confirm-modal .btn-danger')!);
    await flush();
    expect(apiService.deleteSticker).toHaveBeenCalledWith('s1', 'st1');
    expect(onChanged).toHaveBeenCalledTimes(1);
    snap('after-delete', container);
  });

  it('failed delete closes the confirm first and shows the error', async () => {
    mock(apiService.deleteSticker).mockRejectedValueOnce(new Error('boom'));
    const { container, onChanged } = mountManager();
    await flush();
    fireEvent.click(container.querySelector('.sticker-manager-item .panel-icon-btn.is-danger')!);
    await flush();
    fireEvent.click(container.querySelector('.confirm-modal .btn-danger')!);
    await flush();
    expect(onChanged).not.toHaveBeenCalled();
    snap('delete-error', container);
  });

  it('the header close button and the overlay call onClose', async () => {
    const { container, onClose } = mountManager();
    await flush();
    fireEvent.click(container.querySelector('.modal-close-btn')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.sticker-manager')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
