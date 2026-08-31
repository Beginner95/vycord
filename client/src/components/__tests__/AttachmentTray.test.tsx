// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AttachmentTray } from '@/components/AttachmentTray';
import { HARD_MAX_BYTES } from '@/hooks/useAttachmentUpload';
import type { DraftAttachment } from '@/stores/attachmentStore';

function draft(over: Partial<DraftAttachment>): DraftAttachment {
  return {
    localId: 'd1',
    file: new File(['x'], 'big.bin'),
    status: 'error',
    progress: 0,
    abort: () => {},
    ...over,
  };
}

describe('AttachmentTray', () => {
  it('подставляет в текст ошибки размер из HARD_MAX_BYTES, а не захардкоженное число', () => {
    // Пункт C ревью I6: текст больше не хранит собственную копию "25 МБ" —
    // число берётся из той же константы, которой сделана проверка размера.
    render(
      <AttachmentTray
        drafts={[draft({ errorCode: 'attachment_too_large' })]}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    // HARD_MAX_BYTES = 25 * 1024 * 1024 — компонентный formatSize даёт "25.0 MB".
    expect(HARD_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(screen.getByText('Файл слишком большой. Максимальный размер — 25.0 MB')).toBeTruthy();
  });

  it('никогда не показывает неподставленный {{maxSize}}, даже если бы код ошибки пришёл с сервера', () => {
    // errorCode тут — ровно тот же код, что уходит и с позднего серверного
    // пути (httperr.CodeAttachmentTooLarge): AttachmentTray не различает
    // источник и всегда подставляет число сам.
    render(
      <AttachmentTray
        drafts={[draft({ localId: 'd2', errorCode: 'attachment_too_large' })]}
        onCancel={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByText(/\{\{maxSize\}\}/)).toBeNull();
  });
});
