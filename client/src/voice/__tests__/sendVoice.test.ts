import { describe, it, expect, vi } from 'vitest';
import { sendVoice, retryVoice, discardVoice, type SendVoiceDeps } from '@/voice/sendVoice';
import type { ChatMessage } from '@/stores/messageStore';
import type { Attachment, Message } from '@/types';

const recording = { blob: new Blob(['a'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationMs: 4200, waveform: new Array(64).fill(9) };
const serverAtt = { id: 'att-1', is_voice: true, kind: 'audio', url: '/u' } as Attachment;
const serverMsg = { id: 'msg-1', attachments: [serverAtt] } as Message;

function harness(over: Partial<SendVoiceDeps> = {}) {
  const rows = new Map<string, ChatMessage>();
  const deps: SendVoiceDeps = {
    upload: vi.fn(async () => serverAtt),
    createMessage: vi.fn(async () => serverMsg),
    deleteAttachment: vi.fn(async () => undefined),
    store: {
      add: (m) => rows.set(m.id, m),
      update: (id, p) => { const r = rows.get(id); if (r) rows.set(id, { ...r, ...p }); },
      replace: (id, m) => { rows.delete(id); rows.set(m.id, m); },
      has: (id) => rows.has(id),
    },
    createObjectURL: () => 'blob:1',
    revokeObjectURL: vi.fn(),
    onOrphanFailure: vi.fn(),
    ...over,
  };
  return { deps, rows };
}
const args = { tempId: 'pending-1', channelId: 'ch', userId: 'me', now: '2026-09-30T00:00:00Z', recording };

describe('sendVoice', () => {
  it('строка появляется сразу с локальным пузырём, затем заменяется серверной', async () => {
    const h = harness();
    let seenPending: ChatMessage | undefined;
    h.deps.upload = vi.fn(async () => { seenPending = h.rows.get('pending-1'); return serverAtt; });
    await sendVoice(h.deps, args);
    expect(seenPending?.deliveryState).toBe('sending');
    expect(seenPending?.attachments?.[0]).toMatchObject({ is_voice: true, url: 'blob:1', duration_ms: 4200, user_id: 'me' });
    expect(h.deps.upload).toHaveBeenCalledWith('ch', expect.any(File), { durationMs: 4200, waveform: recording.waveform });
    expect((vi.mocked(h.deps.upload).mock.calls[0][1] as File).name).toBe('voice.weba');
    expect(h.deps.createMessage).toHaveBeenCalledWith('ch', 'att-1');
    expect(h.rows.has('pending-1')).toBe(false);
    expect(h.rows.get('msg-1')).toBe(serverMsg);
    expect(h.deps.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('падение загрузки → failed без attachment', async () => {
    const h = harness({ upload: vi.fn(async () => { throw new Error('net'); }) });
    await sendVoice(h.deps, args);
    const row = h.rows.get('pending-1')!;
    expect(row.deliveryState).toBe('failed');
    expect(row.pendingVoice?.attachment).toBeUndefined();
    expect(h.deps.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('падение создания → failed с сохранённым attachment', async () => {
    const h = harness({ createMessage: vi.fn(async () => { throw new Error('500'); }) });
    await sendVoice(h.deps, args);
    expect(h.rows.get('pending-1')!.pendingVoice?.attachment?.id).toBe('att-1');
  });

  it('строки уже нет (ушли из канала) и упало — onOrphanFailure', async () => {
    const h = harness({ upload: vi.fn(async () => { throw new Error('net'); }) });
    h.deps.store.has = () => false;
    await sendVoice(h.deps, args);
    expect(h.deps.onOrphanFailure).toHaveBeenCalled();
    expect(h.deps.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('строки нет, загрузка прошла, создание упало — сирота удаляется', async () => {
    const h = harness({ createMessage: vi.fn(async () => { throw new Error('500'); }) });
    h.deps.store.has = () => false;
    await sendVoice(h.deps, args);
    expect(h.deps.deleteAttachment).toHaveBeenCalledWith('att-1');
    expect(h.deps.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(h.deps.onOrphanFailure).toHaveBeenCalled();
  });

  it('строки уже нет, но успех — сообщение всё равно создано', async () => {
    const h = harness();
    h.deps.store.has = () => false;
    await sendVoice(h.deps, args);
    expect(h.deps.createMessage).toHaveBeenCalled();
    expect(h.deps.revokeObjectURL).toHaveBeenCalled();
  });
});

describe('retryVoice', () => {
  it('без attachment — загружает заново', async () => {
    const h = harness({ upload: vi.fn(async () => { throw new Error('net'); }) });
    await sendVoice(h.deps, args);
    h.deps.upload = vi.fn(async () => serverAtt);
    await retryVoice(h.deps, h.rows.get('pending-1')!);
    expect(h.deps.upload).toHaveBeenCalledTimes(1);
    expect(h.rows.get('msg-1')).toBe(serverMsg);
  });

  it('с attachment — только createMessage, без повторной загрузки', async () => {
    const h = harness({ createMessage: vi.fn(async () => { throw new Error('500'); }) });
    await sendVoice(h.deps, args);
    const upload = vi.mocked(h.deps.upload);
    upload.mockClear();
    h.deps.createMessage = vi.fn(async () => serverMsg);
    await retryVoice(h.deps, h.rows.get('pending-1')!);
    expect(upload).not.toHaveBeenCalled();
    expect(h.rows.get('msg-1')).toBe(serverMsg);
  });

  it('двойной клик по retry — одна отправка', async () => {
    const h = harness({ upload: vi.fn(async () => { throw new Error('net'); }) });
    await sendVoice(h.deps, args);
    h.deps.upload = vi.fn(async () => serverAtt);
    const row = h.rows.get('pending-1')!;
    await Promise.all([retryVoice(h.deps, row), retryVoice(h.deps, row)]);
    expect(h.deps.upload).toHaveBeenCalledTimes(1);
  });
});

describe('discardVoice', () => {
  it('освобождает URL и удаляет загруженную сироту', () => {
    const deps = { deleteAttachment: vi.fn(async () => undefined), revokeObjectURL: vi.fn() };
    discardVoice(deps, { id: 'p', pendingVoice: { objectUrl: 'blob:1', attachment: serverAtt } } as unknown as ChatMessage);
    expect(deps.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(deps.deleteAttachment).toHaveBeenCalledWith('att-1');
  });
});
