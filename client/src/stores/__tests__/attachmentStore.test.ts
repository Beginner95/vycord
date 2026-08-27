import { describe, it, expect, beforeEach } from 'vitest';
import { useAttachmentStore, type DraftAttachment } from '@/stores/attachmentStore';
import type { Attachment } from '@/types';

const noop = () => {};

function draft(localId: string, over: Partial<DraftAttachment> = {}): DraftAttachment {
  return { ...base(localId), ...over };
}

function base(localId: string) {
  return {
    localId,
    file: new File(['x'], `${localId}.bin`),
    status: 'uploading' as const,
    progress: 0,
    abort: noop,
  };
}

describe('attachmentStore', () => {
  beforeEach(() => {
    useAttachmentStore.setState({ drafts: new Map() });
  });

  it('хранит черновики раздельно по каналам', () => {
    useAttachmentStore.getState().add('chan-1', draft('a'));
    useAttachmentStore.getState().add('chan-2', draft('b'));

    expect(useAttachmentStore.getState().getDrafts('chan-1')).toHaveLength(1);
    expect(useAttachmentStore.getState().getDrafts('chan-2')).toHaveLength(1);
    expect(useAttachmentStore.getState().getDrafts('chan-1')[0].localId).toBe('a');
  });

  it('переживает переключение канала — черновик не теряется', () => {
    useAttachmentStore.getState().add('chan-1', draft('a'));

    // «Ушли» в другой канал и вернулись: стор не привязан к жизни компонента.
    expect(useAttachmentStore.getState().getDrafts('chan-2')).toHaveLength(0);
    expect(useAttachmentStore.getState().getDrafts('chan-1')).toHaveLength(1);
  });

  it('обновляет прогресс и статус по localId', () => {
    useAttachmentStore.getState().add('chan-1', draft('a'));

    useAttachmentStore.getState().update('chan-1', 'a', { progress: 60 });
    expect(useAttachmentStore.getState().getDrafts('chan-1')[0].progress).toBe(60);

    const att = { id: 'att-1' } as Attachment;
    useAttachmentStore.getState().update('chan-1', 'a', { status: 'done', attachment: att });
    expect(useAttachmentStore.getState().getDrafts('chan-1')[0].status).toBe('done');
    expect(useAttachmentStore.getState().getDrafts('chan-1')[0].attachment).toBe(att);
  });

  it('удаляет один черновик, не трогая соседние', () => {
    useAttachmentStore.getState().add('chan-1', draft('a'));
    useAttachmentStore.getState().add('chan-1', draft('b'));

    useAttachmentStore.getState().remove('chan-1', 'a');

    const left = useAttachmentStore.getState().getDrafts('chan-1');
    expect(left).toHaveLength(1);
    expect(left[0].localId).toBe('b');
  });

  it('removeSent убирает только отправленное, чипы с ошибкой остаются', () => {
    const sent = { id: 'att-1' } as Attachment;
    useAttachmentStore.getState().add('chan-1', draft('a', { status: 'done', attachment: sent }));
    useAttachmentStore.getState().add('chan-1', draft('b', { status: 'error', errorCode: 'attachment_too_large' }));

    useAttachmentStore.getState().removeSent('chan-1', ['att-1']);

    const left = useAttachmentStore.getState().getDrafts('chan-1');
    expect(left).toHaveLength(1);
    expect(left[0].localId).toBe('b');
  });

  it('clear убирает все черновики канала', () => {
    useAttachmentStore.getState().add('chan-1', draft('a'));
    useAttachmentStore.getState().add('chan-1', draft('b'));

    useAttachmentStore.getState().clear('chan-1');

    expect(useAttachmentStore.getState().getDrafts('chan-1')).toHaveLength(0);
  });

  it('getDrafts для неизвестного канала отдаёт пустой массив, а не undefined', () => {
    expect(useAttachmentStore.getState().getDrafts('nope')).toEqual([]);
  });
});
